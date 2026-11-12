use tauri::State;

use super::error::CommandError;
use crate::domain::PageRef;
use crate::storage::Storage;

#[tauri::command]
pub async fn list_backlinks(
    storage: State<'_, Storage>,
    page_id: String,
) -> Result<Vec<PageRef>, CommandError> {
    Ok(storage.list_backlinks(&page_id).await?)
}
