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
pub async fn set_favorite(
    storage: State<'_, Storage>,
    id: String,
    favorite: bool,
) -> Result<Page, CommandError> {
    Ok(storage.set_favorite(&id, favorite).await?)
}

#[tauri::command]
pub async fn update_appearance(
    storage: State<'_, Storage>,
    id: String,
    icon: Option<String>,
    banner: Option<String>,
) -> Result<Page, CommandError> {
    Ok(storage
        .update_appearance(&id, icon.as_deref(), banner.as_deref())
        .await?)
}

#[tauri::command]
pub async fn set_banner_position(
    storage: State<'_, Storage>,
    id: String,
    position: u8,
) -> Result<Page, CommandError> {
    Ok(storage.set_banner_position(&id, position).await?)
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
    // Deleting moves the page to the trash; `delete_page_permanently` ends it.
    Ok(storage.trash_page(&id).await?)
}
