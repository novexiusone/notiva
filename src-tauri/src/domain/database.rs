use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

/// The colours a select option can have, in the order conversions hand them out.
pub const SELECT_COLORS: [&str; 8] = [
    "gray", "brown", "orange", "yellow", "green", "blue", "purple", "red",
];

/// The value of one cell. Each variant belongs to one property type; an empty
/// cell is [`CellValue::Empty`] whatever the type.
///
/// Serialised the way the frontend expects it: a string, a number, a list of
/// row ids, or `null`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum CellValue {
    Empty,
    Text(String),
    Number(f64),
    /// A day as `yyyy-MM-dd`.
    Date(String),
    /// The id of one of the property's options.
    Select(String),
    /// Ids of rows of the target database, in the order they were added.
    Relation(Vec<String>),
}

impl CellValue {
    /// The value a cell of the type `kind` holds when it is given `value` as
    /// JSON, or `None` when the JSON has the wrong shape for that type.
    ///
    /// Only the shape is checked here. Whether a number is finite, a date is a
    /// real day or an option exists is the repository's job.
    pub fn from_json(kind: PropertyType, value: &serde_json::Value) -> Option<Self> {
        use serde_json::Value;

        match (kind, value) {
            (_, Value::Null) => Some(Self::Empty),
            (PropertyType::Text, Value::String(text)) => Some(Self::Text(text.clone())),
            (PropertyType::Number, Value::Number(number)) => number.as_f64().map(Self::Number),
            (PropertyType::Date, Value::String(date)) => Some(Self::Date(date.clone())),
            (PropertyType::Select, Value::String(option)) => Some(Self::Select(option.clone())),
            (PropertyType::Relation, Value::Array(ids)) => {
                let ids = ids
                    .iter()
                    .map(|id| id.as_str().map(str::to_owned))
                    .collect::<Option<Vec<_>>>()?;
                Some(if ids.is_empty() {
                    Self::Empty
                } else {
                    Self::Relation(ids)
                })
            }
            _ => None,
        }
    }
}

/// A row of a database as the table shows it. The row itself is a page;
/// `cells` holds the values of its properties by property id and leaves out
/// the empty ones.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub id: String,
    pub title: String,
    pub position: f64,
    pub cells: BTreeMap<String, CellValue>,
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

    #[test]
    fn a_row_is_serialised_with_plain_cell_values() {
        let row = Row {
            id: "row".into(),
            title: "Dune".into(),
            position: 2.0,
            cells: BTreeMap::from([
                ("notes".into(), CellValue::Text("classic".into())),
                ("pages".into(), CellValue::Number(412.5)),
                ("read".into(), CellValue::Date("2026-11-13".into())),
                ("status".into(), CellValue::Select("open".into())),
                ("author".into(), CellValue::Relation(vec!["herbert".into()])),
                ("empty".into(), CellValue::Empty),
            ]),
        };

        assert_eq!(
            serde_json::to_value(&row).unwrap(),
            json!({
                "id": "row", "title": "Dune", "position": 2.0,
                "cells": {
                    "notes": "classic", "pages": 412.5, "read": "2026-11-13",
                    "status": "open", "author": ["herbert"], "empty": null
                }
            })
        );
    }

    #[test]
    fn json_becomes_the_cell_value_of_the_property_type() {
        use PropertyType::*;

        let cases = [
            (Text, json!("hello"), Some(CellValue::Text("hello".into()))),
            (Text, json!(""), Some(CellValue::Text(String::new()))),
            (Number, json!(12.5), Some(CellValue::Number(12.5))),
            (Number, json!(3), Some(CellValue::Number(3.0))),
            (
                Date,
                json!("2026-11-13"),
                Some(CellValue::Date("2026-11-13".into())),
            ),
            (
                Select,
                json!("open"),
                Some(CellValue::Select("open".into())),
            ),
            (
                Relation,
                json!(["a", "b"]),
                Some(CellValue::Relation(vec!["a".into(), "b".into()])),
            ),
            (Relation, json!([]), Some(CellValue::Empty)),
            (Text, json!(null), Some(CellValue::Empty)),
            (Select, json!(null), Some(CellValue::Empty)),
            (Text, json!(5), None),
            (Text, json!(["a"]), None),
            (Number, json!("5"), None),
            (Number, json!([1]), None),
            (Date, json!(20261113), None),
            (Select, json!(["open"]), None),
            (Relation, json!("a"), None),
            (Relation, json!(["a", 1]), None),
            (Text, json!(true), None),
            (Text, json!({ "text": "a" }), None),
        ];

        for (kind, value, expected) in cases {
            assert_eq!(
                CellValue::from_json(kind, &value),
                expected,
                "{kind:?} {value}"
            );
        }
    }
}
