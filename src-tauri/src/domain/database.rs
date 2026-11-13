use serde::Serialize;

use super::Page;

/// A database: its page, its properties in column order and its views.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Database {
    pub page: Page,
    pub properties: Vec<Property>,
    pub views: Vec<View>,
}

/// A stored view of a database. Views are delivered with the stored views of
/// `database-views` (#58), which replaces this placeholder with the real type;
/// until then the list is always empty.
pub type View = serde_json::Value;

/// The type of the values in a column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PropertyType {
    Text,
    Number,
    Date,
    Select,
    Relation,
}

impl PropertyType {
    /// The type with the given name, as it is stored and sent to the frontend.
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "text" => Some(Self::Text),
            "number" => Some(Self::Number),
            "date" => Some(Self::Date),
            "select" => Some(Self::Select),
            "relation" => Some(Self::Relation),
            _ => None,
        }
    }
}

/// One of the values a select property offers. Cells store the id.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectOption {
    pub id: String,
    pub name: String,
    pub color: String,
}

/// A typed column of a database. `position` orders the columns.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Property {
    pub id: String,
    pub database_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: PropertyType,
    pub position: f64,
    /// Select only, otherwise empty.
    pub options: Vec<SelectOption>,
    /// Relation only: the database whose rows the cells point at.
    pub target_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::domain::PageKind;

    #[test]
    fn a_database_is_serialised_as_the_frontend_expects_it() {
        let database = Database {
            page: Page {
                id: "db".into(),
                title: "Books".into(),
                parent_id: None,
                position: 0.0,
                kind: PageKind::Database,
                database_id: None,
            },
            properties: vec![
                Property {
                    id: "status".into(),
                    database_id: "db".into(),
                    name: "Status".into(),
                    kind: PropertyType::Select,
                    position: 0.0,
                    options: vec![SelectOption {
                        id: "read".into(),
                        name: "Read".into(),
                        color: "green".into(),
                    }],
                    target_id: None,
                },
                Property {
                    id: "author".into(),
                    database_id: "db".into(),
                    name: "Author".into(),
                    kind: PropertyType::Relation,
                    position: 1.0,
                    options: Vec::new(),
                    target_id: Some("authors".into()),
                },
            ],
            views: Vec::new(),
        };

        assert_eq!(
            serde_json::to_value(&database).unwrap(),
            json!({
                "page": {
                    "id": "db", "title": "Books", "parentId": null, "position": 0.0,
                    "kind": "database", "databaseId": null
                },
                "properties": [
                    {
                        "id": "status", "databaseId": "db", "name": "Status", "type": "select",
                        "position": 0.0,
                        "options": [{ "id": "read", "name": "Read", "color": "green" }],
                        "targetId": null
                    },
                    {
                        "id": "author", "databaseId": "db", "name": "Author", "type": "relation",
                        "position": 1.0, "options": [], "targetId": "authors"
                    }
                ],
                "views": []
            })
        );
    }

    #[test]
    fn every_property_type_is_found_by_the_name_it_is_serialised_as() {
        for kind in [
            PropertyType::Text,
            PropertyType::Number,
            PropertyType::Date,
            PropertyType::Select,
            PropertyType::Relation,
        ] {
            let name = serde_json::to_value(kind).unwrap();
            assert_eq!(PropertyType::from_name(name.as_str().unwrap()), Some(kind));
        }
        assert_eq!(PropertyType::from_name("checkbox"), None);
    }
}
