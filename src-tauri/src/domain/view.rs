//! Stored views of a database and their configuration.
//!
//! The configuration is plain JSON with `null` instead of missing keys. It is
//! parsed strictly: a shape this version does not know is refused, so that a
//! newer configuration is never silently cut down to what an older one knew.
//! Property and option ids are not checked; a configuration may mention a
//! property that has been deleted, and readers skip such entries.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Number, Value};

/// One stored way of looking at a database. `position` orders the views.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub id: String,
    pub database_id: String,
    pub name: String,
    pub position: f64,
    pub config: ViewConfig,
}

/// The settings of a view, tagged by its type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ViewConfig {
    Table {
        version: ConfigVersion,
        filters: Vec<ViewFilter>,
        sorts: Vec<ViewSort>,
        properties: Vec<ViewProperty>,
        #[serde(deserialize_with = "required")]
        group_by: Option<GroupBy>,
    },
    Kanban {
        version: ConfigVersion,
        filters: Vec<ViewFilter>,
        sorts: Vec<ViewSort>,
        properties: Vec<ViewProperty>,
        #[serde(deserialize_with = "required")]
        group_property_id: Option<String>,
        hidden_groups: Vec<String>,
    },
    Calendar {
        version: ConfigVersion,
        filters: Vec<ViewFilter>,
        sorts: Vec<ViewSort>,
        properties: Vec<ViewProperty>,
        #[serde(deserialize_with = "required")]
        date_property_id: Option<String>,
    },
}

impl ViewConfig {
    /// A table without filters, sorts, grouping or chosen properties: the view
    /// a new database starts with.
    pub fn empty_table() -> Self {
        Self::Table {
            version: ConfigVersion,
            filters: Vec::new(),
            sorts: Vec::new(),
            properties: Vec::new(),
            group_by: None,
        }
    }

    /// Parses a configuration as the frontend sends it.
    pub fn from_json(value: Value) -> Result<Self, serde_json::Error> {
        serde_json::from_value(value)
    }

    /// The configuration as JSON, in the shape the frontend expects.
    pub fn to_json(&self) -> Value {
        serde_json::to_value(self).expect("a view configuration is always valid JSON")
    }
}

/// The version of the configuration format. Only version 1 exists; it is
/// written as the number `1`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ConfigVersion;

impl Serialize for ConfigVersion {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_u64(1)
    }
}

impl<'de> Deserialize<'de> for ConfigVersion {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match u64::deserialize(deserializer)? {
            1 => Ok(Self),
            other => Err(serde::de::Error::custom(format!(
                "unknown view configuration version {other}"
            ))),
        }
    }
}

/// One condition a row has to meet. Conditions are combined with "and".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewFilter {
    pub property_id: String,
    pub operator: FilterOperator,
    /// A date as `yyyy-MM-dd`, a select as the id of an option, a relation as
    /// the id of a row.
    #[serde(deserialize_with = "required")]
    pub value: Option<FilterValue>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterOperator {
    Equals,
    NotEquals,
    Contains,
    NotContains,
    GreaterThan,
    LessThan,
    Before,
    After,
    IsEmpty,
    IsNotEmpty,
}

/// The value a filter compares with: a string or a number. The number is kept
/// as it was written, so `3` stays `3` and does not come back as `3.0`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FilterValue {
    Text(String),
    Number(Number),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewSort {
    pub property_id: String,
    pub direction: SortDirection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortDirection {
    Asc,
    Desc,
}

/// Whether and how wide a property is shown. The order of these entries is
/// the order in which the properties are shown.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewProperty {
    pub property_id: String,
    pub visible: bool,
    #[serde(deserialize_with = "required")]
    pub width: Option<Number>,
}

/// The grouping of a table view. `collapsed` holds the groups that are
/// folded away.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupBy {
    pub property_id: String,
    pub collapsed: Vec<String>,
}

/// Reads an optional value whose key must be present. Without it, serde lets
/// a missing key stand for `null`, and the configuration has no missing keys.
fn required<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::deserialize(deserializer)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn table() -> Value {
        json!({
            "version": 1,
            "type": "table",
            "filters": [
                { "propertyId": "status", "operator": "equals", "value": "open" },
                { "propertyId": "pages", "operator": "greaterThan", "value": 300 },
                { "propertyId": "rating", "operator": "lessThan", "value": 4.5 },
                { "propertyId": "due", "operator": "isEmpty", "value": null },
            ],
            "sorts": [
                { "propertyId": "title", "direction": "asc" },
                { "propertyId": "pages", "direction": "desc" },
            ],
            "properties": [
                { "propertyId": "title", "visible": true, "width": 240 },
                { "propertyId": "pages", "visible": false, "width": null },
            ],
            "groupBy": { "propertyId": "status", "collapsed": ["open", ""] },
        })
    }

    fn kanban() -> Value {
        json!({
            "version": 1,
            "type": "kanban",
            "filters": [{ "propertyId": "title", "operator": "contains", "value": "Dune" }],
            "sorts": [],
            "properties": [{ "propertyId": "author", "visible": true, "width": null }],
            "groupPropertyId": "status",
            "hiddenGroups": ["done"],
        })
    }

    fn calendar() -> Value {
        json!({
            "version": 1,
            "type": "calendar",
            "filters": [{ "propertyId": "due", "operator": "after", "value": "2026-01-31" }],
            "sorts": [{ "propertyId": "due", "direction": "asc" }],
            "properties": [],
            "datePropertyId": null,
        })
    }

    /// `value` with `change` applied to it.
    fn changed(mut value: Value, change: impl FnOnce(&mut Value)) -> Value {
        change(&mut value);
        value
    }

    fn assert_refused(value: Value) {
        assert!(
            ViewConfig::from_json(value.clone()).is_err(),
            "accepted {value}"
        );
    }

    #[test]
    fn every_view_type_round_trips_unchanged() {
        for config in [table(), kanban(), calendar()] {
            let parsed = ViewConfig::from_json(config.clone()).unwrap();
            assert_eq!(parsed.to_json(), config);
        }
    }

    #[test]
    fn the_empty_table_is_the_configuration_of_a_new_database() {
        assert_eq!(
            ViewConfig::empty_table().to_json(),
            json!({
                "version": 1, "type": "table", "filters": [], "sorts": [], "properties": [],
                "groupBy": null
            })
        );
    }

    #[test]
    fn the_parts_are_parsed_into_their_types() {
        let ViewConfig::Table {
            filters,
            sorts,
            group_by,
            ..
        } = ViewConfig::from_json(table()).unwrap()
        else {
            panic!("not a table");
        };

        assert_eq!(filters[0].operator, FilterOperator::Equals);
        assert_eq!(filters[0].value, Some(FilterValue::Text("open".into())));
        assert_eq!(filters[1].value, Some(FilterValue::Number(300.into())));
        assert_eq!(filters[3].value, None);
        assert_eq!(sorts[1].direction, SortDirection::Desc);
        assert_eq!(group_by.unwrap().collapsed, ["open", ""]);
    }

    #[test]
    fn unknown_property_ids_are_accepted() {
        let config = changed(table(), |config| {
            config["filters"][0]["propertyId"] = json!("deleted-long-ago");
            config["groupBy"]["propertyId"] = json!("also-gone");
        });

        assert!(ViewConfig::from_json(config).is_ok());
    }

    #[test]
    fn an_unknown_type_is_refused() {
        assert_refused(changed(table(), |config| config["type"] = json!("gallery")));
        assert_refused(changed(table(), |config| {
            config.as_object_mut().unwrap().remove("type");
        }));
    }

    #[test]
    fn a_wrong_version_is_refused() {
        for version in [json!(2), json!(0), json!("1"), json!(null), json!(1.5)] {
            assert_refused(changed(kanban(), |config| config["version"] = version));
        }
        assert_refused(changed(kanban(), |config| {
            config.as_object_mut().unwrap().remove("version");
        }));
    }

    #[test]
    fn an_unknown_operator_or_direction_is_refused() {
        assert_refused(changed(table(), |config| {
            config["filters"][0]["operator"] = json!("startsWith");
        }));
        assert_refused(changed(table(), |config| {
            config["sorts"][0]["direction"] = json!("up");
        }));
    }

    #[test]
    fn a_missing_key_is_refused() {
        let missing = |config: Value, pointer: &str, key: &str| {
            changed(config, |config| {
                config
                    .pointer_mut(pointer)
                    .unwrap()
                    .as_object_mut()
                    .unwrap()
                    .remove(key)
                    .unwrap();
            })
        };

        for key in ["filters", "sorts", "properties", "groupBy"] {
            assert_refused(missing(table(), "", key));
        }
        assert_refused(missing(kanban(), "", "groupPropertyId"));
        assert_refused(missing(kanban(), "", "hiddenGroups"));
        assert_refused(missing(calendar(), "", "datePropertyId"));
        assert_refused(missing(table(), "/filters/3", "value"));
        assert_refused(missing(table(), "/filters/0", "operator"));
        assert_refused(missing(table(), "/sorts/0", "propertyId"));
        assert_refused(missing(table(), "/properties/1", "width"));
        assert_refused(missing(table(), "/properties/1", "visible"));
        assert_refused(missing(table(), "/groupBy", "collapsed"));
    }

    #[test]
    fn an_unknown_key_is_refused() {
        let extra = |config: Value, pointer: &str| {
            changed(config, |config| {
                config
                    .pointer_mut(pointer)
                    .unwrap()
                    .as_object_mut()
                    .unwrap()
                    .insert("colour".into(), json!("red"));
            })
        };

        assert_refused(extra(table(), ""));
        assert_refused(extra(kanban(), ""));
        assert_refused(extra(calendar(), ""));
        assert_refused(extra(table(), "/filters/0"));
        assert_refused(extra(table(), "/sorts/0"));
        assert_refused(extra(table(), "/properties/0"));
        assert_refused(extra(table(), "/groupBy"));
        // A key of another view type is unknown too.
        assert_refused(changed(table(), |config| {
            config["datePropertyId"] = json!(null);
        }));
    }

    #[test]
    fn a_value_of_the_wrong_type_is_refused() {
        for value in [json!(true), json!(["open"]), json!({ "id": "open" })] {
            assert_refused(changed(table(), |config| {
                config["filters"][0]["value"] = value;
            }));
        }
        assert_refused(changed(table(), |config| {
            config["properties"][0]["width"] = json!("240px");
        }));
        assert_refused(changed(table(), |config| {
            config["properties"][0]["visible"] = json!("yes");
        }));
        assert_refused(changed(table(), |config| config["filters"] = json!({})));
        assert_refused(changed(table(), |config| {
            config["groupBy"] = json!("status")
        }));
        assert_refused(changed(kanban(), |config| {
            config["hiddenGroups"] = json!([1]);
        }));
        assert_refused(changed(calendar(), |config| {
            config["datePropertyId"] = json!(7);
        }));
        assert_refused(json!(null));
        assert_refused(json!("table"));
    }

    #[test]
    fn a_view_is_serialised_as_the_frontend_expects_it() {
        let view = View {
            id: "v".into(),
            database_id: "db".into(),
            name: "Table".into(),
            position: 0.0,
            config: ViewConfig::empty_table(),
        };

        assert_eq!(
            serde_json::to_value(&view).unwrap(),
            json!({
                "id": "v", "databaseId": "db", "name": "Table", "position": 0.0,
                "config": {
                    "version": 1, "type": "table", "filters": [], "sorts": [],
                    "properties": [], "groupBy": null
                }
            })
        );
    }
}
