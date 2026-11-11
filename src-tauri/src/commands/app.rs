use serde::Serialize;

#[derive(Debug, Serialize, PartialEq)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[tauri::command]
pub fn app_info(app: tauri::AppHandle) -> AppInfo {
    let package = app.package_info();
    AppInfo {
        name: package.name.clone(),
        version: package.version.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_serialises_to_the_shape_the_frontend_expects() {
        let info = AppInfo {
            name: "Notiva".into(),
            version: "1.2.3".into(),
        };

        assert_eq!(
            serde_json::to_value(info).unwrap(),
            serde_json::json!({ "name": "Notiva", "version": "1.2.3" })
        );
    }
}
