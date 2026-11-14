use serde_json::Value;
use tauri::State;

use super::error::CommandError;
use crate::domain::{Database, Property, PropertyType, Row, SelectOption};
use crate::storage::{Storage, StorageError};

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

#[tauri::command]
pub async fn create_property(
    storage: State<'_, Storage>,
    database_id: String,
    name: String,
    r#type: String,
    target_id: Option<String>,
) -> Result<Property, CommandError> {
    let kind = PropertyType::from_name(&r#type)
        .ok_or_else(|| StorageError::Invalid(format!("{} is not a property type", r#type)))?;
    Ok(storage
        .create_property(&database_id, &name, kind, target_id.as_deref())
        .await?)
}

/// `options` arrives as JSON so that a malformed option is refused as
/// `invalid` like every other bad value, not as an argument Tauri cannot read.
#[tauri::command]
pub async fn update_property(
    storage: State<'_, Storage>,
    id: String,
    name: Option<String>,
    options: Option<Value>,
) -> Result<Property, CommandError> {
    let options = options
        .map(serde_json::from_value::<Vec<SelectOption>>)
        .transpose()
        .map_err(|_| StorageError::Invalid("an option needs an id, a name and a colour".into()))?;
    Ok(storage
        .update_property(&id, name.as_deref(), options.as_deref())
        .await?)
}

#[tauri::command]
pub async fn list_rows(
    storage: State<'_, Storage>,
    database_id: String,
) -> Result<Vec<Row>, CommandError> {
    Ok(storage.list_rows(&database_id).await?)
}

#[tauri::command]
pub async fn create_row(
    storage: State<'_, Storage>,
    database_id: String,
) -> Result<Row, CommandError> {
    Ok(storage.create_row(&database_id).await?)
}

/// The value is checked against the type of the property in the repository.
#[tauri::command]
pub async fn set_cell(
    storage: State<'_, Storage>,
    row_id: String,
    property_id: String,
    value: Option<Value>,
) -> Result<(), CommandError> {
    Ok(storage
        .set_cell_from_json(&row_id, &property_id, &value.unwrap_or(Value::Null))
        .await?)
}
