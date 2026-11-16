//! Remembers the notes folder in `settings.json` in the app data directory.
//! The database never holds it.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::NotesError;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default)]
    notes_folder: Option<PathBuf>,
}

/// The remembered notes folder, shared by the commands.
pub struct NotesSettings {
    file: PathBuf,
    folder: Mutex<Option<PathBuf>>,
}

impl NotesSettings {
    /// Loads the settings file; a missing or unreadable file means no folder.
    pub fn open(file: &Path) -> Self {
        let folder = std::fs::read_to_string(file)
            .ok()
            .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
            .and_then(|settings| settings.notes_folder);

        Self {
            file: file.to_owned(),
            folder: Mutex::new(folder),
        }
    }

    /// The remembered folder, even if it is gone at the moment.
    pub fn remembered(&self) -> Option<PathBuf> {
        self.folder.lock().expect("settings lock").clone()
    }

    /// The folder if it still is a directory.
    pub fn folder(&self) -> Option<PathBuf> {
        self.remembered().filter(|path| path.is_dir())
    }

    /// The folder, or the error every command reports without one.
    pub fn require(&self) -> Result<PathBuf, NotesError> {
        self.folder().ok_or(NotesError::NoFolder)
    }

    pub fn set(&self, folder: Option<PathBuf>) -> Result<(), NotesError> {
        let mut current = self.folder.lock().expect("settings lock");
        // Keep keys that other features may have stored in the same file.
        let mut document = std::fs::read_to_string(&self.file)
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .filter(serde_json::Value::is_object)
            .unwrap_or_else(|| serde_json::json!({}));
        document["notesFolder"] = serde_json::to_value(&folder).expect("path serialises");
        let text = serde_json::to_string_pretty(&document).expect("settings serialise");

        if let Some(parent) = self.file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        super::write_atomic(&self.file, text.as_bytes())?;
        *current = folder;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remembers_the_folder_across_restarts() {
        let dir = tempfile::tempdir().unwrap();
        let notes = tempfile::tempdir().unwrap();
        let file = dir.path().join("settings.json");

        let settings = NotesSettings::open(&file);
        assert_eq!(settings.folder(), None);
        settings.set(Some(notes.path().to_owned())).unwrap();

        let reopened = NotesSettings::open(&file);
        assert_eq!(reopened.folder(), Some(notes.path().to_owned()));

        reopened.set(None).unwrap();
        assert_eq!(NotesSettings::open(&file).remembered(), None);
    }

    #[test]
    fn a_missing_directory_is_no_folder_but_stays_remembered() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("settings.json");
        let gone = dir.path().join("gone");

        let settings = NotesSettings::open(&file);
        settings.set(Some(gone.clone())).unwrap();

        assert_eq!(settings.folder(), None);
        assert_eq!(settings.remembered(), Some(gone));
        assert!(matches!(settings.require(), Err(NotesError::NoFolder)));
    }

    #[test]
    fn a_corrupt_file_means_no_folder() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("settings.json");
        std::fs::write(&file, "{ not json").unwrap();

        assert_eq!(NotesSettings::open(&file).remembered(), None);
    }
}
