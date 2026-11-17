use tauri::State;

use super::error::CommandError;
use crate::domain::{Block, Page, PageVersion, PageVersionContent, TrashSettings, TrashedPage};
use crate::storage::Storage;

#[tauri::command]
pub async fn list_trash(storage: State<'_, Storage>) -> Result<Vec<TrashedPage>, CommandError> {
    Ok(storage.list_trash().await?)
}

#[tauri::command]
pub async fn restore_page(storage: State<'_, Storage>, id: String) -> Result<Page, CommandError> {
    Ok(storage.restore_page(&id).await?)
}

#[tauri::command]
pub async fn delete_page_permanently(
    storage: State<'_, Storage>,
    id: String,
) -> Result<(), CommandError> {
    Ok(storage.delete_page_permanently(&id).await?)
}

#[tauri::command]
pub async fn empty_trash(storage: State<'_, Storage>) -> Result<usize, CommandError> {
    Ok(storage.empty_trash().await?)
}

#[tauri::command]
pub async fn get_trash_settings(
    storage: State<'_, Storage>,
) -> Result<TrashSettings, CommandError> {
    Ok(storage.trash_settings().await?)
}

#[tauri::command]
pub async fn set_trash_retention(
    storage: State<'_, Storage>,
    days: Option<u32>,
) -> Result<TrashSettings, CommandError> {
    Ok(storage.set_trash_retention(days).await?)
}

#[tauri::command]
pub async fn list_page_versions(
    storage: State<'_, Storage>,
    page_id: String,
) -> Result<Vec<PageVersion>, CommandError> {
    Ok(storage.list_page_versions(&page_id).await?)
}

#[tauri::command]
pub async fn load_page_version(
    storage: State<'_, Storage>,
    page_id: String,
    version_id: String,
) -> Result<PageVersionContent, CommandError> {
    Ok(storage.load_page_version(&page_id, &version_id).await?)
}

#[tauri::command]
pub async fn restore_page_version(
    storage: State<'_, Storage>,
    page_id: String,
    version_id: String,
) -> Result<Vec<Block>, CommandError> {
    Ok(storage.restore_page_version(&page_id, &version_id).await?)
}
