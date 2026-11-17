use std::path::PathBuf;

use tauri::State;

use super::error::CommandError;
use crate::notes::{self, Note, NoteEntry, NotesSettings};

/// The remembered notes folder, or `None` when none is chosen or it is gone.
#[tauri::command]
pub fn get_notes_folder(settings: State<'_, NotesSettings>) -> Option<String> {
    settings
        .folder()
        .map(|path| path.to_string_lossy().into_owned())
}

/// Remembers a directory the user chose as the notes folder.
#[tauri::command]
pub fn set_notes_folder(
    settings: State<'_, NotesSettings>,
    path: String,
) -> Result<String, CommandError> {
    let folder = PathBuf::from(&path);
    notes::check_folder(&folder)?;
    settings.set(Some(folder))?;
    Ok(path)
}

/// Forgets the notes folder. No file is touched.
#[tauri::command]
pub fn clear_notes_folder(settings: State<'_, NotesSettings>) -> Result<(), CommandError> {
    Ok(settings.set(None)?)
}

#[tauri::command]
pub async fn list_notes(
    settings: State<'_, NotesSettings>,
    folder: String,
) -> Result<Vec<NoteEntry>, CommandError> {
    Ok(notes::list(&settings.require()?, &folder)?)
}

#[tauri::command]
pub async fn read_note(
    settings: State<'_, NotesSettings>,
    path: String,
) -> Result<Note, CommandError> {
    Ok(notes::read(&settings.require()?, &path)?)
}

#[tauri::command]
pub async fn create_note(
    settings: State<'_, NotesSettings>,
    path: String,
) -> Result<Note, CommandError> {
    Ok(notes::create(&settings.require()?, &path)?)
}

/// `expected_modified` is the time the editor last saw; a different time on
/// disk fails with the kind `conflict`. `null` saves without the check.
#[tauri::command]
pub async fn save_note(
    settings: State<'_, NotesSettings>,
    path: String,
    content: String,
    expected_modified: Option<u64>,
) -> Result<Note, CommandError> {
    Ok(notes::save(
        &settings.require()?,
        &path,
        &content,
        expected_modified,
    )?)
}

#[tauri::command]
pub async fn rename_note(
    settings: State<'_, NotesSettings>,
    path: String,
    name: String,
) -> Result<NoteEntry, CommandError> {
    Ok(notes::rename(&settings.require()?, &path, &name)?)
}

/// Permanently deletes a note; refuses unless `confirm` is true.
#[tauri::command]
pub async fn delete_note(
    settings: State<'_, NotesSettings>,
    path: String,
    confirm: bool,
) -> Result<(), CommandError> {
    Ok(notes::delete(&settings.require()?, &path, confirm)?)
}
