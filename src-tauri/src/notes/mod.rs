//! A notes folder: plain Markdown files the user keeps in a directory of
//! their choice. They are never imported into the database.
//!
//! Every function takes the notes folder as `root` and a relative path with
//! `/` as separator. Nothing outside `root` is touched; see `path`.

mod path;
mod settings;
#[cfg(test)]
mod tests;

use std::io::{Read, Write};
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

pub use settings::NotesSettings;

/// Notes and the text written to them are limited to this many bytes.
pub const MAX_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum NotesError {
    #[error("no notes folder is chosen")]
    NoFolder,

    #[error("{0} was not found")]
    NotFound(String),

    #[error("{0}")]
    Invalid(String),

    #[error("the note is larger than 5 MiB")]
    TooLarge,

    #[error("the note is not valid UTF-8 text")]
    NotText,

    #[error("a file with this name already exists")]
    Exists,

    #[error("the note changed on disk since it was loaded")]
    Conflict,

    #[error("deleting a note needs a confirmation")]
    NotConfirmed,

    #[error("could not save the app settings: {0}")]
    Settings(std::io::Error),

    #[error("could not access the notes folder: {0}")]
    Io(#[from] std::io::Error),
}

/// A file or a folder in the notes folder.
#[derive(Debug, Serialize, PartialEq)]
pub struct NoteEntry {
    pub name: String,
    /// Relative to the notes folder, `/` separated.
    pub path: String,
    pub kind: EntryKind,
    /// Milliseconds since the epoch.
    pub modified: u64,
    pub size: u64,
}

#[derive(Debug, Serialize, PartialEq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Folder,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Note {
    pub path: String,
    pub content: String,
    pub modified: u64,
}

fn modified_ms(metadata: &std::fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_millis() as u64)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn not_found(error: std::io::Error, what: &str) -> NotesError {
    match error.kind() {
        std::io::ErrorKind::NotFound => NotesError::NotFound(what.to_owned()),
        _ => NotesError::Io(error),
    }
}

/// Writes `bytes` to a temporary file next to `target`, flushes it and renames
/// it over the target. The rename replaces an existing file on every platform.
pub(crate) fn write_atomic(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let directory = target.parent().unwrap_or_else(|| Path::new("."));
    let temporary = directory.join(format!(".notiva-{}.tmp", uuid::Uuid::new_v4().simple()));

    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, target)
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

/// Checks that `path` is a plain file of the notes folder and returns its
/// metadata.
fn file_metadata(path: &Path, relative: &str) -> Result<std::fs::Metadata, NotesError> {
    let metadata = std::fs::metadata(path).map_err(|e| not_found(e, &format!("\"{relative}\"")))?;
    if !metadata.is_file() {
        return Err(NotesError::Invalid("this is not a file".into()));
    }
    Ok(metadata)
}

/// Lists one level: folders first, then `.md` files, each sorted by name.
pub fn list(root: &Path, folder: &str) -> Result<Vec<NoteEntry>, NotesError> {
    let directory = path::resolve_existing(root, folder)?;
    if !directory.is_dir() {
        return Err(NotesError::Invalid("this is not a folder".into()));
    }

    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&directory)? {
        let Ok(entry) = entry else { continue };
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        // Hidden entries include the temporary files of atomic saves.
        if name.starts_with('.') || path::validate_name(&name).is_err() {
            continue;
        }
        // `DirEntry::file_type` does not follow links: symbolic links are
        // left out, whatever they point to.
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let kind = if file_type.is_dir() {
            EntryKind::Folder
        } else if file_type.is_file() && path::is_markdown_name(&name) {
            EntryKind::File
        } else {
            continue;
        };
        let Ok(metadata) = entry.metadata() else {
            continue;
        };

        entries.push(NoteEntry {
            path: if folder.is_empty() {
                name.clone()
            } else {
                format!("{folder}/{name}")
            },
            name,
            kind,
            modified: modified_ms(&metadata),
            size: if file_type.is_dir() {
                0
            } else {
                metadata.len()
            },
        });
    }

    entries.sort_by(|a, b| {
        (a.kind == EntryKind::File)
            .cmp(&(b.kind == EntryKind::File))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(entries)
}

pub fn read(root: &Path, relative: &str) -> Result<Note, NotesError> {
    let target = path::resolve_existing(root, relative)?;
    if !path::is_markdown_name(relative.rsplit('/').next().unwrap_or(relative)) {
        return Err(NotesError::Invalid(
            "only files ending in .md are supported".into(),
        ));
    }
    if !path::is_markdown_name(&file_name(&target)) {
        return Err(NotesError::Invalid(
            "only files ending in .md are supported".into(),
        ));
    }
    let metadata = file_metadata(&target, relative)?;
    if metadata.len() > MAX_BYTES {
        return Err(NotesError::TooLarge);
    }

    let mut bytes = Vec::new();
    std::fs::File::open(&target)?
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(NotesError::TooLarge);
    }
    let content = String::from_utf8(bytes).map_err(|_| NotesError::NotText)?;

    Ok(Note {
        path: relative.to_owned(),
        content,
        modified: modified_ms(&metadata),
    })
}

/// Creates an empty file; never overwrites.
pub fn create(root: &Path, relative: &str) -> Result<Note, NotesError> {
    let target = path::resolve_file(root, relative)?;
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::AlreadyExists => NotesError::Exists,
            _ => NotesError::Io(error),
        })?;

    let metadata = file_metadata(&target, relative)?;
    Ok(Note {
        path: relative.to_owned(),
        content: String::new(),
        modified: modified_ms(&metadata),
    })
}

/// Replaces the content atomically. With `expected_modified`, fails with
/// `Conflict` when the file was changed or removed in the meantime.
pub fn save(
    root: &Path,
    relative: &str,
    content: &str,
    expected_modified: Option<u64>,
) -> Result<Note, NotesError> {
    if content.len() as u64 > MAX_BYTES {
        return Err(NotesError::TooLarge);
    }
    let target = path::resolve_file(root, relative)?;

    if let Some(expected) = expected_modified {
        match std::fs::metadata(&target) {
            Ok(metadata) if metadata.is_file() && modified_ms(&metadata) == expected => {}
            Ok(metadata) if !metadata.is_file() => {
                return Err(NotesError::Invalid("this is not a file".into()));
            }
            _ => return Err(NotesError::Conflict),
        }
    }

    write_atomic(&target, content.as_bytes())?;
    let metadata = file_metadata(&target, relative)?;
    Ok(Note {
        path: relative.to_owned(),
        content: content.to_owned(),
        modified: modified_ms(&metadata),
    })
}

/// Whether both paths are the very same file.
fn same_file(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let (Ok(a), Ok(b)) = (std::fs::symlink_metadata(a), std::fs::symlink_metadata(b)) {
            return a.dev() == b.dev() && a.ino() == b.ino();
        }
        false
    }
    #[cfg(not(unix))]
    {
        matches!((a.canonicalize(), b.canonicalize()), (Ok(a), Ok(b)) if a == b)
    }
}

/// Moves `source` to a name that does not exist, and fails instead of
/// replacing a file that appears in the meantime: a hard link refuses an
/// existing target atomically. Where links are not supported, it checks again
/// right before the rename.
fn rename_without_replacing(source: &Path, target: &Path) -> Result<(), NotesError> {
    match std::fs::hard_link(source, target) {
        Ok(()) => {
            std::fs::remove_file(source)?;
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Err(NotesError::Exists),
        Err(_) => {
            if std::fs::symlink_metadata(target).is_ok() {
                return Err(NotesError::Exists);
            }
            Ok(std::fs::rename(source, target)?)
        }
    }
}

/// Renames a file inside its own folder.
pub fn rename(root: &Path, relative: &str, name: &str) -> Result<NoteEntry, NotesError> {
    path::validate_name(name)?;
    if !path::is_markdown_name(name) {
        return Err(NotesError::Invalid(
            "only files ending in .md are supported".into(),
        ));
    }
    let source = path::resolve_file(root, relative)?;
    file_metadata(&source, relative)?;

    let target = source.with_file_name(name);
    if std::fs::symlink_metadata(&target).is_ok() {
        // Only the same file may keep its place: a change of case on a
        // case-insensitive file system. Never compare names for this.
        if !same_file(&source, &target) {
            return Err(NotesError::Exists);
        }
        std::fs::rename(&source, &target)?;
    } else {
        rename_without_replacing(&source, &target)?;
    }

    let metadata = file_metadata(&target, relative)?;
    Ok(NoteEntry {
        name: name.to_owned(),
        path: match relative.rsplit_once('/') {
            Some((folder, _)) => format!("{folder}/{name}"),
            None => name.to_owned(),
        },
        kind: EntryKind::File,
        modified: modified_ms(&metadata),
        size: metadata.len(),
    })
}

/// Permanently removes a file. Needs `confirm`.
pub fn delete(root: &Path, relative: &str, confirm: bool) -> Result<(), NotesError> {
    if !confirm {
        return Err(NotesError::NotConfirmed);
    }
    let target = path::resolve_file(root, relative)?;
    file_metadata(&target, relative)?;
    std::fs::remove_file(&target)?;
    Ok(())
}

/// Checks a directory chosen by the user.
pub fn check_folder(folder: &Path) -> Result<(), NotesError> {
    if !folder.is_absolute() {
        return Err(NotesError::Invalid(
            "the folder must be an absolute path".into(),
        ));
    }
    let metadata = std::fs::metadata(folder).map_err(|e| not_found(e, "the folder"))?;
    if !metadata.is_dir() {
        return Err(NotesError::Invalid("this is not a folder".into()));
    }
    std::fs::read_dir(folder)?;

    let canonical = folder.canonicalize()?;
    let home = ["HOME", "USERPROFILE"]
        .iter()
        .filter_map(std::env::var_os)
        .filter_map(|home| Path::new(&home).canonicalize().ok())
        .any(|home| home == canonical);
    if canonical.parent().is_none() || home {
        return Err(NotesError::Invalid(
            "choose a folder of its own, not a drive root or the home folder".into(),
        ));
    }
    Ok(())
}
