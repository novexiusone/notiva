//! Restoring a backup.
//!
//! Live data is never overwritten while the app runs. A restore
//!
//! 1. checks the manifest, then reads the whole archive against its checksums
//!    into `restore-staging/` and builds the database there,
//! 2. takes a safety backup of the current data,
//! 3. writes `pending-restore.json`.
//!
//! The swap happens at the next start, before the database is opened, by
//! [`apply_pending_restore`]: it moves the current `db` and `images` aside
//! and the staged ones into place. Every step can be repeated, so a crash in
//! the middle is finished at the next start instead of leaving a mixed state.

use std::path::{Path, PathBuf};

use serde::Serialize;
use zeroize::Zeroizing;

use super::{BackupError, Kind, Passphrase, archive};
use crate::storage::{self, Storage};

const STAGING: &str = "restore-staging";
const STAGING_NEW: &str = "restore-staging.new";
const STAGING_OLD: &str = "restore-staging.old";
const PREVIOUS: &str = "restore-previous";
const MARKER: &str = "pending-restore.json";
const PARTS: [&str; 2] = ["db", "images"];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOutcome {
    /// The restore is applied when the app starts the next time.
    pub restart_required: bool,
    /// The backup of the data that the restore will replace.
    pub safety_backup: String,
}

/// Checks the archive and builds the restored data in `directory`:
/// `directory/db` and `directory/images`. Returns the manifest.
///
/// `directory` must be empty or not exist. When this fails, nothing it
/// created is left behind.
pub async fn stage(
    archive_path: &Path,
    passphrase: Option<&Passphrase>,
    directory: &Path,
) -> Result<archive::Manifest, BackupError> {
    if directory.exists() && std::fs::read_dir(directory)?.next().is_some() {
        return Err(BackupError::Invalid(
            "the target folder must be empty".into(),
        ));
    }
    let existed = directory.exists();

    let result = stage_into(archive_path, passphrase, directory).await;
    if result.is_err() {
        // Remove what was created, and only that.
        if existed {
            if let Ok(entries) = std::fs::read_dir(directory) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let _ = if path.is_dir() {
                        std::fs::remove_dir_all(path)
                    } else {
                        std::fs::remove_file(path)
                    };
                }
            }
        } else {
            let _ = std::fs::remove_dir_all(directory);
        }
    }
    result
}

async fn stage_into(
    archive_path: &Path,
    passphrase: Option<&Passphrase>,
    directory: &Path,
) -> Result<archive::Manifest, BackupError> {
    std::fs::create_dir_all(directory)?;

    let archive_path = archive_path.to_owned();
    let target = directory.to_owned();
    let passphrase_text =
        passphrase.map(|passphrase| Zeroizing::new(passphrase.as_str().to_owned()));
    let manifest = tokio::task::spawn_blocking(move || {
        archive::extract(
            &archive_path,
            passphrase_text.as_ref().map(|text| text.as_str()),
            Some(&target),
            |manifest| {
                let supported = Storage::supported_schema_version();
                if manifest.schema_version > supported {
                    return Err(BackupError::SchemaTooNew {
                        found: manifest.schema_version,
                        supported,
                    });
                }
                Ok(())
            },
        )
    })
    .await
    .map_err(|error| BackupError::Internal(error.to_string()))??;

    let snapshot = directory.join(archive::SNAPSHOT);
    storage::restore_snapshot(&directory.join("db"), &snapshot).await?;
    std::fs::remove_file(&snapshot)?;
    Ok(manifest)
}

/// Restores into a new folder and leaves the live data alone. The folder
/// then holds a complete data directory (`db` and `images`).
pub async fn to_folder(
    archive_path: &Path,
    passphrase: Option<&Passphrase>,
    data_dir: &Path,
    directory: &Path,
) -> Result<(), BackupError> {
    if !directory.is_absolute()
        || directory.starts_with(data_dir)
        || data_dir.starts_with(directory)
    {
        return Err(BackupError::Invalid(
            "choose a new folder outside the app's own data folder".into(),
        ));
    }
    stage(archive_path, passphrase, directory).await?;
    Ok(())
}

pub(super) async fn prepare(
    storage: &Storage,
    data_dir: &Path,
    archive_path: &Path,
    passphrase: Option<&Passphrase>,
) -> Result<RestoreOutcome, BackupError> {
    let staging = data_dir.join(STAGING);
    let building = data_dir.join(STAGING_NEW);
    let marker = data_dir.join(MARKER);

    // The new restore is built next to a pending one, which stays valid until
    // the new one is complete: a restore that fails changes nothing.
    remove_dir_if_exists(&building)?;
    stage(archive_path, passphrase, &building).await?;

    // Only now, with a restorable archive in hand, is the current data backed
    // up. It uses the same passphrase, so a backup that was encrypted never
    // leads to an unencrypted copy of the data next to it.
    let settings = super::Settings::load(data_dir)?;
    let folder = settings.folder_or_default(data_dir);
    let safety = super::create(
        storage,
        data_dir,
        &folder,
        Kind::PreRestore,
        passphrase,
        super::now(),
    )
    .await;
    let safety = match safety {
        Ok(info) => info,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&building);
            return Err(error);
        }
    };
    // The data that an earlier restore replaced is not needed any more: the
    // safety backup above is the newer copy. Removing it here, and never while
    // swapping, keeps a swap that was interrupted safe to finish.
    // The pending restore it replaces, if any, is dropped only now.
    // The earlier staging is moved aside, not deleted, until the new one is in
    // place, so a rename that fails keeps the earlier pending restore.
    let old = data_dir.join(STAGING_OLD);
    remove_dir_if_exists(&old)?;
    let had_old = staging.exists();
    if had_old {
        rename_with_retry(&staging, &old)?;
    }
    if let Err(error) = rename_with_retry(&building, &staging) {
        if had_old {
            let _ = std::fs::rename(&old, &staging);
        }
        let _ = std::fs::remove_dir_all(&building);
        return Err(error);
    }
    remove_file_if_exists(&marker)?;
    remove_dir_if_exists(&old)?;
    remove_dir_if_exists(&data_dir.join(PREVIOUS))?;

    let temporary = data_dir.join(format!("{MARKER}.tmp"));
    std::fs::write(&temporary, b"{\"staging\":\"restore-staging\"}")?;
    std::fs::rename(&temporary, &marker)?;

    Ok(RestoreOutcome {
        restart_required: true,
        safety_backup: safety.path,
    })
}

/// Carries out a restore that was scheduled, before the database is opened.
/// Returns the folder the replaced data was moved to, or `None` when nothing
/// was scheduled.
///
/// A failure here must stop the start: opening the app on a half-moved data
/// directory would create a new, empty database.
pub fn apply_pending_restore(data_dir: &Path) -> Result<Option<PathBuf>, BackupError> {
    let staging = data_dir.join(STAGING);
    let marker = data_dir.join(MARKER);
    let previous = data_dir.join(PREVIOUS);

    // Leftovers of work that was interrupted.
    let _ = std::fs::remove_file(data_dir.join(format!("{MARKER}.tmp")));
    let _ = std::fs::remove_dir_all(data_dir.join(STAGING_NEW));
    let _ = std::fs::remove_dir_all(data_dir.join(STAGING_OLD));
    if let Ok(settings) = super::Settings::load(data_dir)
        && let Ok(entries) = std::fs::read_dir(settings.folder_or_default(data_dir))
    {
        for entry in entries.flatten() {
            // Only the exact names `archive::write` makes: the folder is the
            // user's and may hold other files, even ones ending in `.partial`.
            let name = entry.file_name().to_string_lossy().into_owned();
            if let Some(stem) = name.strip_suffix(".partial")
                && super::parse_name(&format!("{stem}.{}", super::EXTENSION)).is_some()
            {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    if let Ok(entries) = std::fs::read_dir(data_dir) {
        for entry in entries.flatten() {
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with("backup-tmp-")
            {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }

    if !marker.exists() {
        // Staged data that was never scheduled is not trusted.
        remove_dir_if_exists(&staging)?;
        return Ok(None);
    }

    for part in PARTS {
        let source = staging.join(part);
        if !source.exists() {
            // Moved before a crash.
            continue;
        }
        let live = data_dir.join(part);
        if live.exists() {
            std::fs::create_dir_all(&previous)?;
            rename_with_retry(&live, &previous.join(part))?;
        }
        rename_with_retry(&source, &live)?;
    }

    remove_file_if_exists(&marker)?;
    remove_dir_if_exists(&staging)?;
    Ok(Some(previous))
}

fn remove_file_if_exists(path: &Path) -> Result<(), BackupError> {
    match std::fs::remove_file(path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.into()),
        _ => Ok(()),
    }
}

fn remove_dir_if_exists(path: &Path) -> Result<(), BackupError> {
    match std::fs::remove_dir_all(path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.into()),
        _ => Ok(()),
    }
}

/// Renames, trying a few times: on some systems another program (a virus
/// scanner, a file indexer) holds a folder for a moment.
fn rename_with_retry(from: &Path, to: &Path) -> Result<(), BackupError> {
    let mut last = None;
    for attempt in 0..5 {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(error) => last = Some(error),
        }
        std::thread::sleep(std::time::Duration::from_millis(200 * (attempt + 1)));
    }
    Err(BackupError::Io(std::io::Error::new(
        last.map_or(std::io::ErrorKind::Other, |e| e.kind()),
        format!(
            "could not move {} to {} while applying the restore; close other programs that use the folder and start Notiva again, the restore will continue",
            from.display(),
            to.display()
        ),
    )))
}
