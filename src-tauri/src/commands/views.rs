use serde_json::Value;
use tauri::State;

use super::error::CommandError;
use crate::domain::{View, ViewConfig};
use crate::storage::Storage;

/// Reads a view configuration sent by the frontend. It arrives as plain JSON
/// so that a shape this version does not know is reported as `invalid`
/// rather than as an argument Tauri could not read.
fn parse_config(value: Value) -> Result<ViewConfig, CommandError> {
    ViewConfig::from_json(value).map_err(|error| CommandError {
        kind: "invalid",
        message: format!("the view configuration cannot be read: {error}"),
    })
}

#[tauri::command]
pub async fn create_view(
    storage: State<'_, Storage>,
    database_id: String,
    name: String,
    config: Value,
) -> Result<View, CommandError> {
    let config = parse_config(config)?;
    Ok(storage.create_view(&database_id, &name, &config).await?)
}

#[tauri::command]
pub async fn update_view(
    storage: State<'_, Storage>,
    id: String,
    name: Option<String>,
    config: Option<Value>,
) -> Result<View, CommandError> {
    let config = config.map(parse_config).transpose()?;
    Ok(storage
        .update_view(&id, name.as_deref(), config.as_ref())
        .await?)
}

#[tauri::command]
pub async fn delete_view(storage: State<'_, Storage>, id: String) -> Result<(), CommandError> {
    Ok(storage.delete_view(&id).await?)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_known_configuration_is_parsed() {
        let config = parse_config(json!({
            "version": 1, "type": "calendar", "filters": [], "sorts": [], "properties": [],
            "datePropertyId": "due"
        }))
        .unwrap();

        assert!(matches!(config, ViewConfig::Calendar { .. }));
    }

    #[test]
    fn an_unknown_configuration_is_invalid() {
        let base = || {
            json!({
                "version": 1, "type": "table", "filters": [], "sorts": [], "properties": [],
                "groupBy": null
            })
        };
        let mut unknown_type = base();
        unknown_type["type"] = json!("gallery");
        let mut wrong_version = base();
        wrong_version["version"] = json!(2);
        let mut unknown_key = base();
        unknown_key["colour"] = json!("red");
        let mut missing_key = base();
        missing_key.as_object_mut().unwrap().remove("groupBy");
        let mut unknown_operator = base();
        unknown_operator["filters"] =
            json!([{ "propertyId": "title", "operator": "startsWith", "value": "A" }]);
        let mut unknown_direction = base();
        unknown_direction["sorts"] = json!([{ "propertyId": "title", "direction": "up" }]);
        let mut wrong_value = base();
        wrong_value["filters"] =
            json!([{ "propertyId": "done", "operator": "equals", "value": true }]);

        for config in [
            unknown_type,
            wrong_version,
            unknown_key,
            missing_key,
            unknown_operator,
            unknown_direction,
            wrong_value,
            json!("table"),
        ] {
            let error = parse_config(config.clone()).unwrap_err();
            assert_eq!(error.kind, "invalid", "for {config}");
        }
    }
}
