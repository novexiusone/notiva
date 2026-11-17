//! The backup settings. They live in a JSON file in the app data directory,
//! not in the database, so that a restore never changes them and the
//! scheduler can read them without the database.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::BackupError;

const FILE: &str = "backup-settings.json";
const MAX_KEEP: u32 = 365;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Interval {
    /// No scheduled backups.
    #[default]
    Manual,
    Hourly,
    Daily,
    Weekly,
}

impl Interval {
    /// The time between two scheduled backups.
    pub fn seconds(self) -> Option<i64> {
        match self {
            Interval::Manual => None,
            Interval::Hourly => Some(60 * 60),
            Interval::Daily => Some(24 * 60 * 60),
            Interval::Weekly => Some(7 * 24 * 60 * 60),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub interval: Interval,
    /// How many scheduled backups are kept; at least 1.
    pub keep_last: u32,
    /// An absolute folder; `None` means `<app data>/backups`.
    pub folder: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            interval: Interval::Manual,
            keep_last: 7,
            folder: None,
        }
    }
}

impl Settings {
    pub fn load(data_dir: &Path) -> Result<Self, BackupError> {
        match std::fs::read(data_dir.join(FILE)) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| {
                BackupError::Invalid(format!("the backup settings are not valid: {error}"))
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(error.into()),
        }
    }

    /// Checks the settings and stores them. The folder is created and tried
    /// out, so a folder that cannot be written is refused now rather than at
    /// the first scheduled backup.
    pub fn save(&self, data_dir: &Path) -> Result<(), BackupError> {
        if self.keep_last == 0 || self.keep_last > MAX_KEEP {
            return Err(BackupError::Invalid(format!(
                "keep between 1 and {MAX_KEEP} backups"
            )));
        }
        if self.folder.is_some() {
            let folder = self.folder_or_default(data_dir);
            check_folder(&folder, data_dir)?;
        }

        let temporary = data_dir.join(format!("{FILE}.tmp"));
        let bytes = serde_json::to_vec_pretty(self)
            .map_err(|error| BackupError::Internal(error.to_string()))?;
        std::fs::write(&temporary, bytes)?;
        std::fs::rename(&temporary, data_dir.join(FILE))?;
        Ok(())
    }

    pub fn folder_or_default(&self, data_dir: &Path) -> PathBuf {
        match &self.folder {
            Some(folder) => PathBuf::from(folder),
            None => data_dir.join("backups"),
        }
    }
}

/// A backup folder must be an absolute path that can be written to and must
/// not be a place the app keeps live data in.
fn check_folder(folder: &Path, data_dir: &Path) -> Result<(), BackupError> {
    if !folder.is_absolute() {
        return Err(BackupError::Invalid(
            "the backup folder must be an absolute path".into(),
        ));
    }
    for owned in ["db", "images", "restore-staging", "restore-previous"] {
        if folder.starts_with(data_dir.join(owned)) {
            return Err(BackupError::Invalid(
                "the backup folder cannot be inside the folders the app keeps its data in".into(),
            ));
        }
    }
    // Start-up deletes these, so nothing of the user's may live there.
    if let Ok(relative) = folder.strip_prefix(data_dir)
        && let Some(first) = relative.components().next()
    {
        let first = first.as_os_str().to_string_lossy();
        if first.starts_with("backup-tmp-") || first.starts_with("restore-staging.") {
            return Err(BackupError::Invalid(
                "the backup folder cannot be a scratch folder of the app".into(),
            ));
        }
    }
    std::fs::create_dir_all(folder).map_err(|error| {
        BackupError::Invalid(format!("the backup folder cannot be used: {error}"))
    })?;
    tempfile::tempfile_in(folder).map_err(|error| {
        BackupError::Invalid(format!("the backup folder cannot be written to: {error}"))
    })?;
    Ok(())
}
