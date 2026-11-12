use tauri::State;

use super::error::CommandError;
use crate::domain::Block;
use crate::storage::Storage;

#[tauri::command]
pub async fn load_blocks(
    storage: State<'_, Storage>,
    page_id: String,
) -> Result<Vec<Block>, CommandError> {
    Ok(storage.load_blocks(&page_id).await?)
}

#[tauri::command]
pub async fn save_blocks(
    storage: State<'_, Storage>,
    page_id: String,
    blocks: Vec<Block>,
) -> Result<(), CommandError> {
    storage.save_blocks(&page_id, &blocks).await?;
    Ok(())
}
