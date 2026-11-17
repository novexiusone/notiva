//! The archive file: a tar stream, compressed with zstd and optionally
//! encrypted, holding the manifest, the database snapshot and the images.
//!
//! ```text
//! manifest.json   first, so a backup can be judged before anything is read
//! db.surql        the database snapshot
//! images/<name>   one entry per stored image
//! ```

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::BackupError;
use super::crypto::{self, DecryptReader, EncryptWriter};
use crate::media;

pub const MANIFEST: &str = "manifest.json";
pub const SNAPSHOT: &str = "db.surql";
const IMAGES: &str = "images/";
const FORMAT: u32 = 1;
const MAX_MANIFEST_BYTES: u64 = 16 * 1024 * 1024;
/// More than this in one backup is not a backup of a notes app.
const MAX_TOTAL_BYTES: u64 = 256 * 1024 * 1024 * 1024;
const ZSTD_MAGIC: [u8; 4] = [0x28, 0xB5, 0x2F, 0xFD];

/// What a backup says about itself.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: u32,
    pub app_version: String,
    pub schema_version: u32,
    /// RFC 3339, UTC.
    pub created_at: String,
    /// `"auto"` for a backup the schedule made. Only such backups are pruned.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub files: Vec<FileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    /// Lower-case hex SHA-256.
    pub sha256: String,
}

/// How a file on disk starts.
#[derive(Debug, PartialEq, Eq)]
pub enum Kind {
    Plain,
    Encrypted,
}

pub fn sniff(path: &Path) -> Result<Kind, BackupError> {
    let mut head = [0u8; 8];
    let mut file = File::open(path).map_err(not_found_or_io)?;
    let read = read_up_to(&mut file, &mut head)?;
    if read >= 8 && &head == crypto::MAGIC {
        Ok(Kind::Encrypted)
    } else if read >= 4 && head[..4] == ZSTD_MAGIC {
        Ok(Kind::Plain)
    } else {
        Err(BackupError::NotABackup)
    }
}

fn read_up_to(reader: &mut impl Read, buffer: &mut [u8]) -> io::Result<usize> {
    let mut total = 0;
    while total < buffer.len() {
        match reader.read(&mut buffer[total..])? {
            0 => break,
            count => total += count,
        }
    }
    Ok(total)
}

fn not_found_or_io(error: io::Error) -> BackupError {
    if error.kind() == io::ErrorKind::NotFound {
        BackupError::NotFound("the backup file".into())
    } else {
        error.into()
    }
}

pub fn sha256_file(path: &Path) -> io::Result<(String, u64)> {
    let mut file = BufReader::new(File::open(path)?);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];
    let mut size = 0;
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
        size += count as u64;
    }
    Ok((hex(&hasher.finalize()), size))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// What goes into a backup.
pub struct Contents<'a> {
    pub app_version: &'a str,
    pub schema_version: u32,
    pub created_at: &'a str,
    pub kind: Option<&'a str>,
    /// The database snapshot file.
    pub snapshot: &'a Path,
    /// The directory the images are stored in.
    pub images: &'a Path,
}

/// Writes the archive to `destination`, which must not exist yet. The file is
/// complete or absent: it is written under a temporary name and renamed.
pub fn write(
    destination: &Path,
    contents: &Contents,
    passphrase: Option<&str>,
) -> Result<Manifest, BackupError> {
    let manifest = build_manifest(contents)?;
    let partial = destination.with_extension("partial");

    let result = write_file(&partial, contents, &manifest, passphrase).and_then(|()| {
        // Never replace a backup that exists.
        if destination.exists() {
            return Err(BackupError::Invalid(
                "a backup with this name already exists".into(),
            ));
        }
        std::fs::rename(&partial, destination).map_err(BackupError::from)
    });
    if result.is_err() {
        let _ = std::fs::remove_file(&partial);
    }
    result.map(|()| manifest)
}

fn build_manifest(contents: &Contents) -> Result<Manifest, BackupError> {
    let mut files = Vec::new();
    let (sha256, size) = sha256_file(contents.snapshot)?;
    files.push(FileEntry {
        path: SNAPSHOT.into(),
        size,
        sha256,
    });
    for name in image_names(contents.images)? {
        let (sha256, size) = sha256_file(&contents.images.join(&name))?;
        files.push(FileEntry {
            path: format!("{IMAGES}{name}"),
            size,
            sha256,
        });
    }

    Ok(Manifest {
        format: FORMAT,
        app_version: contents.app_version.to_owned(),
        schema_version: contents.schema_version,
        created_at: contents.created_at.to_owned(),
        kind: contents.kind.map(str::to_owned),
        files,
    })
}

fn image_names(directory: &Path) -> Result<Vec<String>, BackupError> {
    let mut names = Vec::new();
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(names),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let entry = entry?;
        if let Some(name) = entry.file_name().to_str()
            && media::is_image_name(name)
            && entry.file_type()?.is_file()
        {
            names.push(name.to_owned());
        }
    }
    names.sort();
    Ok(names)
}

fn write_file(
    path: &Path,
    contents: &Contents,
    manifest: &Manifest,
    passphrase: Option<&str>,
) -> Result<(), BackupError> {
    let file = BufWriter::new(File::create(path)?);
    match passphrase {
        Some(passphrase) => {
            let sealed = EncryptWriter::new(file, passphrase)?;
            let sealed = write_tar(sealed, contents, manifest)?;
            sealed
                .finish()?
                .into_inner()
                .map_err(|e| e.into_error())?
                .sync_all()?;
        }
        None => {
            let file = write_tar(file, contents, manifest)?;
            file.into_inner().map_err(|e| e.into_error())?.sync_all()?;
        }
    }
    Ok(())
}

/// Writes the tar stream through zstd into `sink` and returns the sink.
fn write_tar<W: Write>(
    sink: W,
    contents: &Contents,
    manifest: &Manifest,
) -> Result<W, BackupError> {
    let encoder = zstd::Encoder::new(sink, 6)?;
    let mut tar = tar::Builder::new(encoder);

    let manifest_json = serde_json::to_vec_pretty(manifest)
        .map_err(|error| BackupError::Internal(error.to_string()))?;
    append_bytes(&mut tar, MANIFEST, &manifest_json)?;

    for entry in &manifest.files {
        let source = match entry.path.strip_prefix(IMAGES) {
            Some(name) => contents.images.join(name),
            None => contents.snapshot.to_owned(),
        };
        let mut header = tar::Header::new_gnu();
        header.set_size(entry.size);
        header.set_mode(0o600);
        header.set_mtime(0);
        header.set_cksum();
        // A file that changed after it was hashed would write a backup that
        // fails its own checksums, so a size change is an error here already.
        let mut file = File::open(&source)?;
        if file.metadata()?.len() != entry.size {
            return Err(BackupError::Internal(format!(
                "{} changed while the backup was written",
                entry.path
            )));
        }
        tar.append_data(&mut header, &entry.path, &mut file)?;
    }

    let encoder = tar.into_inner()?;
    Ok(encoder.finish()?)
}

fn append_bytes<W: Write>(
    tar: &mut tar::Builder<W>,
    path: &str,
    bytes: &[u8],
) -> Result<(), BackupError> {
    let mut header = tar::Header::new_gnu();
    header.set_size(bytes.len() as u64);
    header.set_mode(0o600);
    header.set_mtime(0);
    header.set_cksum();
    tar.append_data(&mut header, path, bytes)?;
    Ok(())
}

/// Opens an archive for reading: decrypts it when needed and returns the
/// decompressed tar stream.
fn open_stream(path: &Path, passphrase: Option<&str>) -> Result<Box<dyn Read>, BackupError> {
    let kind = sniff(path)?;
    let file = BufReader::new(File::open(path).map_err(not_found_or_io)?);
    let raw: Box<dyn Read> = match kind {
        Kind::Plain => Box::new(file),
        Kind::Encrypted => {
            let passphrase = passphrase.ok_or(BackupError::PassphraseRequired)?;
            Box::new(DecryptReader::new(file, passphrase)?)
        }
    };
    Ok(Box::new(zstd::Decoder::new(raw).map_err(damaged)?))
}

/// Anything that goes wrong while reading the content of an archive, after
/// the right key was found, is damage.
fn damaged(error: io::Error) -> BackupError {
    BackupError::Corrupt(error.to_string())
}

/// Reads and checks the manifest. Nothing else is read.
pub fn read_manifest(path: &Path, passphrase: Option<&str>) -> Result<Manifest, BackupError> {
    let stream = open_stream(path, passphrase)?;
    let mut tar = tar::Archive::new(stream);
    let mut entries = tar.entries().map_err(damaged)?;
    let mut entry = entries
        .next()
        .ok_or_else(|| BackupError::Corrupt("the archive is empty".into()))?
        .map_err(damaged)?;
    manifest_of(&mut entry)
}

fn manifest_of<R: Read>(entry: &mut tar::Entry<'_, R>) -> Result<Manifest, BackupError> {
    let name = entry
        .path()
        .map_err(damaged)?
        .to_string_lossy()
        .into_owned();
    if name != MANIFEST {
        return Err(BackupError::Corrupt(
            "the archive does not start with its manifest".into(),
        ));
    }
    if entry.size() > MAX_MANIFEST_BYTES {
        return Err(BackupError::Corrupt("the manifest is too large".into()));
    }
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes).map_err(damaged)?;
    let manifest: Manifest = serde_json::from_slice(&bytes)
        .map_err(|error| BackupError::Corrupt(format!("the manifest is not valid: {error}")))?;

    if manifest.format != FORMAT {
        return Err(BackupError::Unsupported(format!(
            "backup format {}",
            manifest.format
        )));
    }
    check_entries(&manifest)?;
    Ok(manifest)
}

/// The manifest is data from a file: only the names this module writes are
/// accepted, once each, so nothing can point outside the target folder.
fn check_entries(manifest: &Manifest) -> Result<(), BackupError> {
    let mut seen = std::collections::BTreeSet::new();
    let mut has_snapshot = false;
    for entry in &manifest.files {
        let known = entry.path == SNAPSHOT
            || entry
                .path
                .strip_prefix(IMAGES)
                .is_some_and(media::is_image_name);
        let hash_ok = entry.sha256.len() == 64
            && entry
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
        if !known || !hash_ok || !seen.insert(entry.path.as_str()) {
            return Err(BackupError::Corrupt(format!(
                "the manifest lists an invalid entry: {}",
                entry.path
            )));
        }
        has_snapshot |= entry.path == SNAPSHOT;
    }
    if !has_snapshot {
        return Err(BackupError::Corrupt(
            "the manifest lists no database".into(),
        ));
    }
    Ok(())
}

/// Reads the whole archive, checks every file against the manifest and writes
/// the files into `target` (`db.surql` and `images/`). With `None` only the
/// checks run. Returns the manifest.
///
/// `check` runs on the manifest before any file is read, so an archive that
/// must be refused is refused without having extracted anything.
pub fn extract(
    path: &Path,
    passphrase: Option<&str>,
    target: Option<&Path>,
    check: impl FnOnce(&Manifest) -> Result<(), BackupError>,
) -> Result<Manifest, BackupError> {
    let stream = open_stream(path, passphrase)?;
    let mut tar = tar::Archive::new(stream);
    let mut entries = tar.entries().map_err(damaged)?;

    let manifest = manifest_of(
        &mut entries
            .next()
            .ok_or_else(|| BackupError::Corrupt("the archive is empty".into()))?
            .map_err(damaged)?,
    )?;
    check(&manifest)?;

    // The sizes in the manifest come from the file, so they are checked
    // before anything is written: against a limit, and against the free
    // space, because the restored data needs the files and the database
    // built from the snapshot.
    let total = manifest
        .files
        .iter()
        .try_fold(0u64, |sum, entry| sum.checked_add(entry.size))
        .filter(|total| *total <= MAX_TOTAL_BYTES)
        .ok_or_else(|| BackupError::Corrupt("the manifest declares an impossible size".into()))?;
    if let Some(target) = target {
        std::fs::create_dir_all(target.join("images"))?;
        if let Some(free) = free_space(target)
            && total.saturating_mul(2) > free
        {
            return Err(BackupError::Invalid(format!(
                "not enough free space to restore: {} MiB needed, {} MiB free",
                total.saturating_mul(2) / (1024 * 1024),
                free / (1024 * 1024)
            )));
        }
    }
    let expected: BTreeMap<&str, &FileEntry> = manifest
        .files
        .iter()
        .map(|entry| (entry.path.as_str(), entry))
        .collect();
    let mut found = std::collections::BTreeSet::new();

    for entry in entries {
        let mut entry = entry.map_err(damaged)?;
        let name = entry
            .path()
            .map_err(damaged)?
            .to_string_lossy()
            .into_owned();
        let listed = expected.get(name.as_str()).ok_or_else(|| {
            BackupError::Corrupt(format!(
                "the archive holds an entry the manifest does not list: {name}"
            ))
        })?;
        if !found.insert(name.clone()) {
            return Err(BackupError::Corrupt(format!("{name} appears twice")));
        }
        if !entry.header().entry_type().is_file() {
            return Err(BackupError::Corrupt(format!("{name} is not a file")));
        }
        if entry.size() != listed.size {
            return Err(BackupError::Corrupt(format!(
                "{name} does not have the size its manifest declares"
            )));
        }

        let mut out = match target {
            Some(target) => Some(BufWriter::new(File::create(target.join(&name))?)),
            None => None,
        };
        let mut hasher = Sha256::new();
        let mut size = 0u64;
        let mut buffer = vec![0u8; 256 * 1024];
        loop {
            let count = entry.read(&mut buffer).map_err(damaged)?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
            size += count as u64;
            if size > listed.size {
                break;
            }
            if let Some(out) = out.as_mut() {
                out.write_all(&buffer[..count])?;
            }
        }
        if let Some(mut out) = out {
            out.flush()?;
            out.into_inner().map_err(|e| e.into_error())?.sync_all()?;
        }
        if size != listed.size || hex(&hasher.finalize()) != listed.sha256 {
            return Err(BackupError::Corrupt(format!(
                "{name} does not match its checksum"
            )));
        }
    }

    if found.len() != expected.len() {
        return Err(BackupError::Corrupt(
            "the archive is missing files its manifest lists".into(),
        ));
    }

    // The tar end marker comes before the end of the file. Reading on to the
    // end is what checks the compression and, for an encrypted archive, that
    // the file was not cut off.
    io::copy(&mut tar.into_inner(), &mut io::sink()).map_err(damaged)?;
    Ok(manifest)
}

/// Free bytes on the volume that holds `path`, when the platform can say.
#[cfg(unix)]
#[allow(clippy::unnecessary_cast)] // the field types differ between platforms
fn free_space(path: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c_path = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut stats = std::mem::MaybeUninit::<libc::statvfs>::zeroed();
    // SAFETY: `c_path` is a valid C string and `stats` is a valid out pointer.
    if unsafe { libc::statvfs(c_path.as_ptr(), stats.as_mut_ptr()) } != 0 {
        return None;
    }
    // SAFETY: statvfs succeeded, so the struct is initialised.
    let stats = unsafe { stats.assume_init() };
    Some((stats.f_bavail as u64).saturating_mul(stats.f_frsize as u64))
}

#[cfg(not(unix))]
fn free_space(_path: &Path) -> Option<u64> {
    None
}
