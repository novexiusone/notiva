use tauri::State;

use super::error::CommandError;
use crate::domain::Database;
use crate::storage::Storage;

#[tauri::command]
pub async fn create_database(
    storage: State<'_, Storage>,
    parent_id: Option<String>,
) -> Result<Database, CommandError> {
    Ok(storage.create_database(parent_id.as_deref()).await?)
}

#[tauri::command]
pub async fn load_database(
    storage: State<'_, Storage>,
    id: String,
) -> Result<Database, CommandError> {
    Ok(storage.load_database(&id).await?)
}
