use tauri::State;

use super::error::CommandError;
use crate::domain::Page;
use crate::storage::Storage;

#[tauri::command]
pub async fn list_pages(storage: State<'_, Storage>) -> Result<Vec<Page>, CommandError> {
    Ok(storage.list_pages().await?)
}

#[tauri::command]
pub async fn create_page(
    storage: State<'_, Storage>,
    parent_id: Option<String>,
) -> Result<Page, CommandError> {
    Ok(storage.create_page(parent_id.as_deref()).await?)
}

#[tauri::command]
pub async fn rename_page(
    storage: State<'_, Storage>,
    id: String,
    title: String,
) -> Result<Page, CommandError> {
    Ok(storage.rename_page(&id, &title).await?)
}

#[tauri::command]
pub async fn move_page(
    storage: State<'_, Storage>,
    id: String,
    parent_id: Option<String>,
    index: usize,
) -> Result<(), CommandError> {
    Ok(storage.move_page(&id, parent_id.as_deref(), index).await?)
}

#[tauri::command]
pub async fn delete_page(storage: State<'_, Storage>, id: String) -> Result<(), CommandError> {
    Ok(storage.delete_page(&id).await?)
}
