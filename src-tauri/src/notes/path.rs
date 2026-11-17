//! Turns the relative paths of the frontend into real paths inside the notes
//! folder, and refuses everything else.

use std::path::{Path, PathBuf};

use super::NotesError;

const MAX_NAME_BYTES: usize = 255;
const RESERVED: [&str; 24] = [
    "CON", "CONIN$", "CONOUT$", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5",
    "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8",
    "LPT9",
];

/// Checks one file or folder name, so that it is valid on every platform.
pub fn validate_name(name: &str) -> Result<(), NotesError> {
    let invalid = |why: &str| Err(NotesError::Invalid(format!("\"{name}\" {why}")));

    if name.is_empty() || name == "." || name == ".." {
        return invalid("is not a valid name");
    }
    if name.len() > MAX_NAME_BYTES {
        return invalid("is too long");
    }
    if name
        .chars()
        .any(|c| c.is_control() || "\\/:*?\"<>|".contains(c))
    {
        return invalid("contains a character that is not allowed in file names");
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return invalid("must not end with a dot or a space");
    }
    let stem = name.split('.').next().unwrap_or(name).trim_end();
    if RESERVED.iter().any(|r| r.eq_ignore_ascii_case(stem)) {
        return invalid("is a reserved name");
    }
    Ok(())
}

/// Whether the name ends with `.md` and has a stem.
pub fn is_markdown_name(name: &str) -> bool {
    name.len() > 3 && name.to_ascii_lowercase().ends_with(".md")
}

/// Splits a relative path of the frontend into validated names. The empty
/// path has no names.
pub fn split(relative: &str) -> Result<Vec<&str>, NotesError> {
    if relative.is_empty() {
        return Ok(Vec::new());
    }
    let names: Vec<&str> = relative.split('/').collect();
    for name in &names {
        validate_name(name)?;
    }
    Ok(names)
}

/// The canonical form of the notes folder.
pub fn canonical_root(root: &Path) -> Result<PathBuf, NotesError> {
    root.canonicalize().map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => NotesError::NotFound("the notes folder".into()),
        _ => NotesError::Io(error),
    })
}

fn ensure_inside(root: &Path, path: &Path) -> Result<(), NotesError> {
    if path.starts_with(root) {
        Ok(())
    } else {
        Err(NotesError::Invalid(
            "the path leads outside the notes folder".into(),
        ))
    }
}

/// Resolves a path that must exist (a folder to list, a file to read).
pub fn resolve_existing(root: &Path, relative: &str) -> Result<PathBuf, NotesError> {
    let root = canonical_root(root)?;
    let mut path = root.clone();
    path.extend(split(relative)?);

    let canonical = path.canonicalize().map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => NotesError::NotFound(format!("\"{relative}\"")),
        _ => NotesError::Io(error),
    })?;
    ensure_inside(&root, &canonical)?;
    Ok(canonical)
}

/// Resolves a path whose last part may not exist yet (a file to create or
/// save). The parent must exist and lie inside the folder.
pub fn resolve_file(root: &Path, relative: &str) -> Result<PathBuf, NotesError> {
    let root = canonical_root(root)?;
    let names = split(relative)?;
    let Some((name, parents)) = names.split_last() else {
        return Err(NotesError::Invalid("a file name is required".into()));
    };
    if !is_markdown_name(name) {
        return Err(NotesError::Invalid(
            "only files ending in .md are supported".into(),
        ));
    }

    let mut parent = root.clone();
    parent.extend(parents);
    let parent = parent.canonicalize().map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => NotesError::NotFound("the folder".into()),
        _ => NotesError::Io(error),
    })?;
    ensure_inside(&root, &parent)?;
    if !parent.is_dir() {
        return Err(NotesError::NotFound("the folder".into()));
    }

    let path = parent.join(name);
    // A symbolic link is never written through, not even one that points
    // inside the folder.
    if let Ok(metadata) = std::fs::symlink_metadata(&path)
        && metadata.file_type().is_symlink()
    {
        return Err(NotesError::Invalid(
            "symbolic links are not supported".into(),
        ));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_names_that_are_unsafe_somewhere() {
        for name in [
            "", ".", "..", "a/b", "a\\b", "a:b", "a*b", "a?b", "a\"b", "a<b", "a|b", "a\0b",
            "a\nb", "end.", "end ", "CON", "con.md", "Nul.txt", "COM1.md", "lpt9",
        ] {
            assert!(validate_name(name).is_err(), "{name:?} must be rejected");
        }
        assert!(validate_name(&"a".repeat(256)).is_err());
    }

    #[test]
    fn accepts_ordinary_names() {
        for name in [
            "Note.md",
            "my notes.md",
            "été.md",
            "a.b.md",
            ".hidden.md",
            "CONSOLE.md",
        ] {
            assert!(validate_name(name).is_ok(), "{name:?} must be accepted");
        }
    }

    #[test]
    fn markdown_names_need_a_stem() {
        assert!(is_markdown_name("a.md"));
        assert!(is_markdown_name("A.MD"));
        assert!(!is_markdown_name(".md"));
        assert!(!is_markdown_name("a.txt"));
        assert!(!is_markdown_name("a.md.txt"));
    }

    #[test]
    fn splits_only_plain_relative_paths() {
        assert_eq!(split("").unwrap(), Vec::<&str>::new());
        assert_eq!(split("a/b.md").unwrap(), vec!["a", "b.md"]);
        for path in [
            "/a.md",
            "a//b.md",
            "../a.md",
            "a/../b.md",
            "./a.md",
            "a/",
            "C:/a.md",
            "a\\b.md",
        ] {
            assert!(split(path).is_err(), "{path:?} must be rejected");
        }
    }
}
