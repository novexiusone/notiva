use tauri::State;

use super::error::CommandError;
use crate::domain::SearchHit;
use crate::storage::Storage;

#[tauri::command]
pub async fn search(
    storage: State<'_, Storage>,
    query: String,
) -> Result<Vec<SearchHit>, CommandError> {
    Ok(storage.search(&query).await?)
}
