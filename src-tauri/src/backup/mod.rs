//! Backups: one archive file holding a consistent snapshot of the database
//! and every stored image, optionally encrypted with a passphrase. See
//! `docs/en/specs/SPEC-backup.md`.

mod archive;
mod crypto;
mod restore;
mod settings;

#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{DateTime, NaiveDateTime, SecondsFormat, Utc};
use serde::Serialize;
use zeroize::Zeroizing;

use crate::storage::{Storage, StorageError};

pub use restore::{RestoreOutcome, apply_pending_restore, to_folder as restore_to_folder};
pub use settings::{Interval, Settings};

/// The file extension of every backup.
const EXTENSION: &str = "notiva-backup";
const STAMP: &str = "%Y%m%dT%H%M%SZ";
const STAMP_LEN: usize = 16;

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("this file is not a Notiva backup")]
    NotABackup,

    #[error("this backup is encrypted; enter its passphrase")]
    PassphraseRequired,

    #[error("the passphrase is wrong")]
    WrongPassphrase,

    #[error("the backup is damaged: {0}")]
    Corrupt(String),

    #[error(
        "the backup has schema version {found}, but this version of Notiva only supports up to {supported}; update Notiva to restore it"
    )]
    SchemaTooNew { found: u32, supported: u32 },

    #[error("this backup uses a format this version of Notiva does not know: {0}")]
    Unsupported(String),

    #[error("{0}")]
    Invalid(String),

    #[error("{0} was not found")]
    NotFound(String),

    #[error(transparent)]
    Storage(StorageError),

    #[error("could not read or write the backup: {0}")]
    Io(std::io::Error),

    #[error("{0}")]
    Internal(String),
}

impl From<std::io::Error> for BackupError {
    fn from(error: std::io::Error) -> Self {
        use std::io::ErrorKind::{InvalidData, UnexpectedEof};
        match error.kind() {
            InvalidData | UnexpectedEof => Self::Corrupt(error.to_string()),
            _ => Self::Io(error),
        }
    }
}

impl From<StorageError> for BackupError {
    fn from(error: StorageError) -> Self {
        match error {
            StorageError::SchemaTooNew { found, supported } => {
                Self::SchemaTooNew { found, supported }
            }
            other => Self::Storage(other),
        }
    }
}

/// Where a backup came from. It decides the file name, and only `Auto`
/// backups are ever deleted by the app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    /// Made on request.
    Manual,
    /// Made by the schedule; the only kind that is pruned.
    Auto,
    /// Made of the current data right before a restore replaces it.
    PreRestore,
}

impl Kind {
    const ALL: [Kind; 3] = [Kind::Manual, Kind::Auto, Kind::PreRestore];

    fn prefix(self) -> &'static str {
        match self {
            Kind::Manual => "notiva-backup-",
            Kind::Auto => "notiva-auto-",
            Kind::PreRestore => "notiva-pre-restore-",
        }
    }
}

/// A backup file in a backup folder.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    /// RFC 3339, UTC; taken from the file name.
    pub created_at: String,
    pub encrypted: bool,
    pub kind: Kind,
}

/// What the archive says about itself, for showing before a restore.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub app_version: String,
    pub schema_version: u32,
    pub created_at: String,
    pub images: usize,
    /// Whether this version of Notiva can restore it.
    pub restorable: bool,
}

/// What the app shows about the scheduled backups.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub running: bool,
    /// RFC 3339.
    pub last_success_at: Option<String>,
    /// The message of the last failure, until a backup succeeds again.
    pub last_error: Option<String>,
}

/// A passphrase that is wiped from memory when it is dropped. It has no
/// `Debug` and no `Display`, so it cannot end up in a log by accident.
pub struct Passphrase(Zeroizing<String>);

impl Passphrase {
    /// An empty passphrase is refused rather than treated as "none", which
    /// would silently write an unencrypted backup.
    pub fn new(text: String) -> Result<Self, BackupError> {
        let text = Zeroizing::new(text);
        if text.is_empty() {
            return Err(BackupError::Invalid(
                "the passphrase must not be empty".into(),
            ));
        }
        Ok(Self(text))
    }

    fn as_str(&self) -> &str {
        &self.0
    }
}

/// Serialises backups and restores and remembers how the last one went.
#[derive(Default)]
pub struct BackupService {
    gate: tokio::sync::Mutex<()>,
    status: Mutex<Status>,
}

impl BackupService {
    pub fn status(&self) -> Status {
        self.status.lock().expect("status lock").clone()
    }

    fn record<T>(&self, result: &Result<T, BackupError>) {
        let mut status = self.status.lock().expect("status lock");
        match result {
            Ok(_) => {
                status.last_success_at = Some(now().to_rfc3339_opts(SecondsFormat::Secs, true));
                status.last_error = None;
            }
            Err(error) => status.last_error = Some(error.to_string()),
        }
    }

    fn set_running(&self, running: bool) {
        self.status.lock().expect("status lock").running = running;
    }

    /// Makes a backup in `folder`. Waits when another one is running.
    pub async fn create(
        &self,
        storage: &Storage,
        data_dir: &Path,
        folder: &Path,
        kind: Kind,
        passphrase: Option<&Passphrase>,
    ) -> Result<BackupInfo, BackupError> {
        let _gate = self.gate.lock().await;
        self.set_running(true);
        let result = create(storage, data_dir, folder, kind, passphrase, now()).await;
        self.set_running(false);
        self.record(&result);
        result
    }

    /// Makes a scheduled backup when one is due and prunes old ones. Does
    /// nothing when the schedule is off or another backup is running.
    pub async fn run_due(
        &self,
        storage: &Storage,
        data_dir: &Path,
    ) -> Result<Option<BackupInfo>, BackupError> {
        let Ok(_gate) = self.gate.try_lock() else {
            return Ok(None);
        };
        let settings = Settings::load(data_dir)?;
        let folder = settings.folder_or_default(data_dir);
        if !is_due(&folder, settings.interval, now()) {
            return Ok(None);
        }

        self.set_running(true);
        let result = async {
            let info = create(storage, data_dir, &folder, Kind::Auto, None, now()).await?;
            prune(&folder, settings.keep_last)?;
            Ok(info)
        }
        .await;
        self.set_running(false);
        self.record(&result);
        result.map(Some)
    }

    /// Prepares a restore: checks the archive, builds the restored data next
    /// to the live data, backs up the live data and schedules the swap for
    /// the next start. Nothing live is changed here.
    pub async fn restore(
        &self,
        storage: &Storage,
        data_dir: &Path,
        archive: &Path,
        passphrase: Option<&Passphrase>,
    ) -> Result<RestoreOutcome, BackupError> {
        let _gate = self.gate.lock().await;
        self.set_running(true);
        let result = restore::prepare(storage, data_dir, archive, passphrase).await;
        self.set_running(false);
        result
    }
}

fn now() -> DateTime<Utc> {
    Utc::now()
}

fn rfc3339(time: DateTime<Utc>) -> String {
    time.to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// Writes a backup of the live data into `folder` and checks it by reading
/// it back. The file appears only when it is complete and checked.
async fn create(
    storage: &Storage,
    data_dir: &Path,
    folder: &Path,
    kind: Kind,
    passphrase: Option<&Passphrase>,
    time: DateTime<Utc>,
) -> Result<BackupInfo, BackupError> {
    std::fs::create_dir_all(folder)?;
    let scratch = tempfile::Builder::new()
        .prefix("backup-tmp-")
        .tempdir_in(data_dir)?;
    let snapshot = scratch.path().join(archive::SNAPSHOT);

    // The images are listed after the snapshot: an image is stored before
    // the block that refers to it is saved, so everything the snapshot
    // refers to exists by then.
    let schema_version = storage.export_to(&snapshot).await?;

    let destination = free_name(folder, kind, time);
    let images = data_dir.join("images");
    let passphrase_text =
        passphrase.map(|passphrase| Zeroizing::new(passphrase.as_str().to_owned()));
    let created_at = rfc3339(time);
    let target = destination.clone();

    tokio::task::spawn_blocking(move || -> Result<(), BackupError> {
        let _scratch = scratch;
        let passphrase = passphrase_text.as_ref().map(|text| text.as_str());
        archive::write(
            &target,
            &archive::Contents {
                app_version: env!("CARGO_PKG_VERSION"),
                schema_version,
                created_at: &created_at,
                kind: (kind == Kind::Auto).then_some("auto"),
                snapshot: &snapshot,
                images: &images,
            },
            passphrase,
        )?;
        // A backup that cannot be read back is worse than none.
        if let Err(error) = archive::extract(&target, passphrase, None, |_| Ok(())) {
            let _ = std::fs::remove_file(&target);
            return Err(error);
        }
        Ok(())
    })
    .await
    .map_err(|error| BackupError::Internal(error.to_string()))??;

    info_of(&destination)
}

/// A file name for a new backup that does not exist yet.
fn free_name(folder: &Path, kind: Kind, time: DateTime<Utc>) -> PathBuf {
    let stamp = time.format(STAMP).to_string();
    let first = folder.join(format!("{}{stamp}.{EXTENSION}", kind.prefix()));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| folder.join(format!("{}{stamp}-{n}.{EXTENSION}", kind.prefix())))
        .find(|path| !path.exists())
        .expect("an unused name exists")
}

fn info_of(path: &Path) -> Result<BackupInfo, BackupError> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| BackupError::Invalid("the file name is not valid".into()))?;
    let (kind, created) = parse_name(name)
        .ok_or_else(|| BackupError::Invalid("this is not a backup file name of Notiva".into()))?;

    Ok(BackupInfo {
        name: name.to_owned(),
        path: path.to_string_lossy().into_owned(),
        size_bytes: std::fs::metadata(path)?.len(),
        created_at: rfc3339(created),
        encrypted: archive::sniff(path)? == archive::Kind::Encrypted,
        kind,
    })
}

fn parse_name(name: &str) -> Option<(Kind, DateTime<Utc>)> {
    let stem = name.strip_suffix(&format!(".{EXTENSION}"))?;
    Kind::ALL.into_iter().find_map(|kind| {
        let rest = stem.strip_prefix(kind.prefix())?;
        let stamp = rest.get(..STAMP_LEN)?;
        // Anything after the stamp is a "-2" that keeps names apart.
        let suffix = &rest[STAMP_LEN..];
        if !(suffix.is_empty()
            || suffix
                .strip_prefix('-')
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit())))
        {
            return None;
        }
        let time = NaiveDateTime::parse_from_str(stamp, STAMP).ok()?.and_utc();
        Some((kind, time))
    })
}

/// The backups in `folder`, newest first. A missing folder holds none.
pub fn list(folder: &Path) -> Result<Vec<BackupInfo>, BackupError> {
    let entries = match std::fs::read_dir(folder) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };

    let mut backups = Vec::new();
    for entry in entries {
        let path = entry?.path();
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(parse_name)
            .is_none()
        {
            continue;
        }
        // A file with the right name that is not an archive is not listed.
        if let Ok(info) = info_of(&path) {
            backups.push(info);
        }
    }
    backups.sort_by(|a, b| (&b.created_at, &b.name).cmp(&(&a.created_at, &a.name)));
    Ok(backups)
}

/// Deletes the oldest scheduled backups so that `keep_last` remain. Manual
/// backups and the ones made before a restore are never touched. Returns the
/// names that were deleted.
pub fn prune(folder: &Path, keep_last: u32) -> Result<Vec<String>, BackupError> {
    let mut removed = Vec::new();
    for (backup, _) in scheduled(folder, now())?
        .into_iter()
        .skip(keep_last.max(1) as usize)
    {
        std::fs::remove_file(&backup.path)?;
        removed.push(backup.name);
    }
    Ok(removed)
}

/// The backups in `folder` that the schedule made, newest first.
///
/// A file only counts when it is named like one, is not encrypted (scheduled
/// backups never are) and its own manifest says it is a scheduled backup. The
/// order is the one in the manifest, not the file name or the modification
/// time, so a copied or renamed file and a changed clock cannot make the app
/// delete the newest backup or skip a due one.
fn scheduled(
    folder: &Path,
    time: DateTime<Utc>,
) -> Result<Vec<(BackupInfo, DateTime<Utc>)>, BackupError> {
    let mut found = Vec::new();
    for backup in list(folder)? {
        if backup.kind != Kind::Auto || backup.encrypted {
            continue;
        }
        let Ok(manifest) = archive::read_manifest(Path::new(&backup.path), None) else {
            continue;
        };
        let Ok(created) = DateTime::parse_from_rfc3339(&manifest.created_at) else {
            continue;
        };
        // A file from the future (a copy, or a clock that was wrong) is not a
        // backup the schedule made; it must not block the schedule or push
        // real backups out of the keep-last window.
        if created.to_utc() > time + chrono::Duration::minutes(5) {
            continue;
        }
        if manifest.kind.as_deref() == Some("auto") {
            found.push((backup, created.to_utc()));
        }
    }
    found.sort_by(|a, b| (b.1, &b.0.name).cmp(&(a.1, &a.0.name)));
    Ok(found)
}

/// Whether the newest scheduled backup in `folder` is older than `interval`.
fn is_due(folder: &Path, interval: Interval, time: DateTime<Utc>) -> bool {
    let Some(seconds) = interval.seconds() else {
        return false;
    };
    match scheduled(folder, time)
        .ok()
        .and_then(|found| found.into_iter().next())
    {
        None => true,
        Some((_, newest)) => (time - newest).num_seconds() >= seconds,
    }
}

/// Reads the manifest of a backup and says whether it can be restored.
pub fn inspect(path: &Path, passphrase: Option<&Passphrase>) -> Result<BackupSummary, BackupError> {
    let manifest = archive::read_manifest(path, passphrase.map(Passphrase::as_str))?;
    let images = manifest
        .files
        .iter()
        .filter(|file| file.path.starts_with("images/"))
        .count();

    Ok(BackupSummary {
        restorable: manifest.schema_version <= Storage::supported_schema_version(),
        app_version: manifest.app_version,
        schema_version: manifest.schema_version,
        created_at: manifest.created_at,
        images,
    })
}
