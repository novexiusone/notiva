use std::path::Path;

use tauri::State;

use super::error::CommandError;
use crate::export::{ExportSummary, Scope, export};
use crate::media::ImageStore;
use crate::storage::Storage;

/// Exports a page and its subpages into a new folder inside `directory`.
#[tauri::command]
pub async fn export_page(
    storage: State<'_, Storage>,
    images: State<'_, ImageStore>,
    page_id: String,
    directory: String,
) -> Result<ExportSummary, CommandError> {
    Ok(export(
        &storage,
        &images,
        Scope::Page(&page_id),
        Path::new(&directory),
    )
    .await?)
}

/// Exports every page into a new folder inside `directory`.
#[tauri::command]
pub async fn export_all(
    storage: State<'_, Storage>,
    images: State<'_, ImageStore>,
    directory: String,
) -> Result<ExportSummary, CommandError> {
    Ok(export(&storage, &images, Scope::All, Path::new(&directory)).await?)
}
