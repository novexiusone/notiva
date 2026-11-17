//! The property repository: the typed columns of a database and the options
//! of a select.

use std::collections::{HashMap, HashSet};

use serde_json::Value;
use surrealdb::types::SurrealValue;

use super::databases::PropertyRow;
use super::rows::{Props, is_calendar_date, props_text, read_cell, stored};
use super::{Storage, StorageError};
use crate::domain::{
    CellValue, Page, PageKind, Property, PropertyType, SELECT_COLORS, SelectOption,
};

/// Selects a property with its ids as plain strings.
pub(super) const PROPERTY_FIELDS: &str = "record::id(id) AS id, \
     record::id(database) AS database_id, name, type AS kind, position, options, \
     IF target = NONE { NONE } ELSE { record::id(target) } AS target_id";

/// Writes many cells of the property `$key` in two statements, whatever the
/// number of rows: every `{ id, value, text }` in `$cells` is set, every row
/// in `$emptied` (`{ id, text }`) loses the key. `text` is the row's search
/// text after the write. `UNSET props[$key]` does nothing in SurrealDB 4.0.1;
/// setting the key to NONE removes it. A row deleted in the meantime is not
/// written again.
const WRITE_CELLS: &str = "FOR $cell IN $cells {
         UPDATE type::record('page', $cell.id) SET props[$key] = $cell.value,
             props_text = $cell.text WHERE id != NONE RETURN NONE;
     };
     FOR $row IN $emptied {
         UPDATE type::record('page', $row.id) SET props[$key] = NONE,
             props_text = $row.text WHERE id != NONE RETURN NONE;
     };";

/// Writes the search text of every row in `$texts` (`{ id, text }`), for a
/// change of a property's name or options that leaves the cells as they are.
const WRITE_TEXTS: &str = "FOR $row IN $texts {
         UPDATE type::record('page', $row.id) SET props_text = $row.text
             WHERE id != NONE RETURN NONE;
     };";

/// An option as it is written.
#[derive(SurrealValue)]
struct OptionWrite {
    id: String,
    name: String,
    color: String,
}

impl From<&SelectOption> for OptionWrite {
    fn from(option: &SelectOption) -> Self {
        Self {
            id: option.id.clone(),
            name: option.name.clone(),
            color: option.color.clone(),
        }
    }
}

/// A cell as a bulk write sets it, with the row's search text after it.
#[derive(SurrealValue)]
struct CellWrite {
    id: String,
    value: Value,
    text: String,
}

/// The search text of a row as a bulk write sets it.
#[derive(SurrealValue)]
struct TextWrite {
    id: String,
    text: String,
}

/// A view configuration as a bulk write sets it.
#[derive(SurrealValue)]
struct ViewWrite {
    id: String,
    config: Value,
}

/// What a bulk change writes: cells with a new value and rows whose cell
/// becomes empty, each with the row's search text after the change.
#[derive(Default)]
struct CellWrites {
    cells: Vec<CellWrite>,
    emptied: Vec<TextWrite>,
}

impl CellWrites {
    /// Writes `value` into the cell `key` of `row`, whose other cells are
    /// `props`. `properties` are the properties of the database as they are
    /// after the change.
    fn push(
        &mut self,
        row: String,
        mut props: Props,
        key: &str,
        value: CellValue,
        properties: &[Property],
    ) {
        match stored(value) {
            Some(value) => {
                props.insert(key.to_owned(), value.clone());
                self.cells.push(CellWrite {
                    text: props_text(properties, &props),
                    id: row,
                    value,
                });
            }
            None => {
                props.remove(key);
                self.emptied.push(TextWrite {
                    text: props_text(properties, &props),
                    id: row,
                });
            }
        }
    }
}

/// The properties of a database with one of them as it is after a change.
fn replace(properties: Vec<Property>, updated: Property) -> Vec<Property> {
    properties
        .into_iter()
        .map(|property| {
            if property.id == updated.id {
                updated.clone()
            } else {
                property
            }
        })
        .collect()
}

fn not_found(id: &str) -> StorageError {
    StorageError::NotFound(format!("property {id}"))
}

/// A number written the way JavaScript's `String(number)` writes it, so that
/// a number becomes the same text here as in the fake backend: `1`, `1.5`,
/// `-0.25`, `1000000`, but also `1e+21` and `1e-7`. Both sides write the
/// shortest digits that read back as the same number; this only places the
/// decimal point and the exponent by the rules of ECMAScript's
/// `Number::toString`.
pub(crate) fn number_as_text(number: f64) -> String {
    if number == 0.0 {
        // Negative zero too.
        return "0".into();
    }

    // `{:e}` writes the shortest digits that round-trip, as `d.ddde<exp>`.
    let scientific = format!("{:e}", number.abs());
    let (mantissa, exponent) = scientific
        .split_once('e')
        .expect("a number in scientific notation has an exponent");
    let exponent: i32 = exponent.parse().expect("the exponent is a number");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let count = digits.len() as i32;
    // The position of the decimal point, counted from the first digit.
    let point = exponent + 1;

    let text = if count <= point && point <= 21 {
        format!("{digits}{}", "0".repeat((point - count) as usize))
    } else if 0 < point && point <= 21 {
        let (whole, fraction) = digits.split_at(point as usize);
        format!("{whole}.{fraction}")
    } else if -6 < point && point <= 0 {
        format!("0.{}{digits}", "0".repeat((-point) as usize))
    } else {
        let sign = if exponent < 0 { '-' } else { '+' };
        let (first, rest) = digits.split_at(1);
        let rest = if rest.is_empty() {
            String::new()
        } else {
            format!(".{rest}")
        };
        format!("{first}{rest}e{sign}{}", exponent.abs())
    };

    if number < 0.0 {
        format!("-{text}")
    } else {
        text
    }
}

/// The options a text property gets when it becomes a select: one per
/// distinct text, in the order the texts first appear, with the colours in
/// their order, starting again after the last.
#[derive(Default)]
struct OptionsFromTexts {
    options: Vec<SelectOption>,
    by_name: HashMap<String, usize>,
}

impl OptionsFromTexts {
    /// The id of the option for a text, created when it is the first time.
    fn option_for(&mut self, name: &str) -> String {
        if let Some(&index) = self.by_name.get(name) {
            return self.options[index].id.clone();
        }
        let option = SelectOption {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_owned(),
            color: SELECT_COLORS[self.options.len() % SELECT_COLORS.len()].to_owned(),
        };
        let id = option.id.clone();
        self.by_name.insert(name.to_owned(), self.options.len());
        self.options.push(option);
        id
    }
}

/// What a cell of `from` holds once its property has the type `to`, by the
/// conversion table of the spec. What cannot be converted becomes empty.
fn convert(
    value: CellValue,
    from: &Property,
    to: PropertyType,
    options: &mut OptionsFromTexts,
) -> CellValue {
    match (value, to) {
        (CellValue::Empty, _) => CellValue::Empty,
        (CellValue::Text(text), PropertyType::Text) => CellValue::Text(text),
        (CellValue::Number(number), PropertyType::Text) => CellValue::Text(number_as_text(number)),
        (CellValue::Date(date), PropertyType::Text) => CellValue::Text(date),
        (CellValue::Select(id), PropertyType::Text) => from
            .options
            .iter()
            .find(|option| option.id == id && !option.name.is_empty())
            .map_or(CellValue::Empty, |option| {
                CellValue::Text(option.name.clone())
            }),
        (CellValue::Text(text), PropertyType::Number) => text
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|number| number.is_finite())
            .map_or(CellValue::Empty, CellValue::Number),
        (CellValue::Text(text), PropertyType::Date) => {
            let text = text.trim();
            if is_calendar_date(text) {
                CellValue::Date(text.to_owned())
            } else {
                CellValue::Empty
            }
        }
        (CellValue::Text(text), PropertyType::Select) if !text.is_empty() => {
            CellValue::Select(options.option_for(&text))
        }
        // Any other pair, and an empty text that becomes a select.
        _ => CellValue::Empty,
    }
}

/// The name a property type is stored under.
fn type_name(kind: PropertyType) -> &'static str {
    match kind {
        PropertyType::Text => "text",
        PropertyType::Number => "number",
        PropertyType::Date => "date",
        PropertyType::Select => "select",
        PropertyType::Relation => "relation",
    }
}

/// Refuses a list of options that a select cannot hold.
fn check_options(options: &[SelectOption]) -> Result<(), StorageError> {
    let mut ids = HashSet::new();
    for option in options {
        if option.id.is_empty() {
            return Err(StorageError::Invalid("an option needs an id".into()));
        }
        if !ids.insert(option.id.as_str()) {
            return Err(StorageError::Invalid(format!(
                "two options cannot share the id {}",
                option.id
            )));
        }
        if !SELECT_COLORS.contains(&option.color.as_str()) {
            return Err(StorageError::Invalid(format!(
                "{} is not an option colour; use one of {}",
                option.color,
                SELECT_COLORS.join(", ")
            )));
        }
    }
    Ok(())
}

impl Storage {
    /// Adds a property after the last one of the database. Only a relation
    /// has a target, and a relation needs one: a database, which may be the
    /// database the property is added to.
    pub async fn create_property(
        &self,
        database_id: &str,
        name: &str,
        kind: PropertyType,
        target_id: Option<&str>,
    ) -> Result<Property, StorageError> {
        // Writers wait while a page is moved to or from the trash.
        let _write = self.write_gate.read().await;
        self.require_database(database_id).await?;
        match (kind, target_id) {
            (PropertyType::Relation, Some(target)) => {
                self.require_database(target).await?;
            }
            (PropertyType::Relation, None) => {
                return Err(StorageError::Invalid(
                    "a relation needs a target database".into(),
                ));
            }
            (_, Some(_)) => {
                return Err(StorageError::Invalid(
                    "only a relation has a target database".into(),
                ));
            }
            (_, None) => {}
        }

        let row: Option<PropertyRow> = self
            .db
            .query(format!(
                "LET $database = type::record('page', $database_id);
                 LET $last = (SELECT VALUE position FROM property WHERE database = $database
                     ORDER BY position DESC LIMIT 1)[0];
                 CREATE property SET database = $database, name = $name, type = $type,
                     position = ($last ?? -1.0) + 1.0, options = [],
                     target = IF $target_id != NONE {{ type::record('page', $target_id) }}
                     RETURN {PROPERTY_FIELDS};"
            ))
            .bind(("target_id", target_id.map(str::to_owned)))
            .bind(("database_id", database_id.to_owned()))
            .bind(("name", name.to_owned()))
            .bind(("type", type_name(kind)))
            .await?
            .check()?
            .take(2)?;

        row.ok_or_else(|| StorageError::Database("the created property was not returned".into()))?
            .try_into()
    }

    /// Renames a property, replaces the options of a select, or both. `None`
    /// keeps what is there. An option left out of the new list is gone; cells
    /// that held it read as empty.
    pub async fn update_property(
        &self,
        id: &str,
        name: Option<&str>,
        options: Option<&[SelectOption]>,
    ) -> Result<Property, StorageError> {
        // Writers wait while a page is moved to or from the trash.
        let _write = self.write_gate.read().await;
        let property = self.find_property(id).await?.ok_or_else(|| not_found(id))?;
        if let Some(options) = options {
            if property.kind != PropertyType::Select {
                return Err(StorageError::Invalid("only a select has options".into()));
            }
            check_options(options)?;
        }

        // The rows whose search text changes: with a new name, every row
        // that has a text or select value; with new options, the rows that
        // hold an option that was renamed or left out.
        let renamed = name.is_some_and(|name| name != property.name)
            && matches!(property.kind, PropertyType::Text | PropertyType::Select);
        let changed: HashSet<&str> = options.map_or_else(HashSet::new, |options| {
            property
                .options
                .iter()
                .filter(|old| {
                    !options
                        .iter()
                        .any(|new| new.id == old.id && new.name == old.name)
                })
                .map(|old| old.id.as_str())
                .collect()
        });
        let texts: Vec<TextWrite> = if renamed || !changed.is_empty() {
            let (properties, rows) = self
                .read_rows_with(&property.database_id, &property.id)
                .await?;
            let updated = Property {
                name: name.map_or_else(|| property.name.clone(), str::to_owned),
                options: options.map_or_else(|| property.options.clone(), <[_]>::to_vec),
                ..property.clone()
            };
            let properties = replace(properties, updated);
            rows.into_iter()
                .filter(|(_, props)| {
                    renamed
                        || props[&property.id]
                            .as_str()
                            .is_some_and(|id| changed.contains(id))
                })
                .map(|(row, props)| TextWrite {
                    text: props_text(&properties, &props),
                    id: row,
                })
                .collect()
        } else {
            Vec::new()
        };

        let options: Option<Vec<OptionWrite>> =
            options.map(|options| options.iter().map(OptionWrite::from).collect());
        let row: Option<PropertyRow> = self
            .db
            .query(format!(
                "BEGIN TRANSACTION;
                 UPDATE type::record('property', $id)
                     SET name = $name ?? name, options = $options ?? options
                     WHERE id != NONE RETURN {PROPERTY_FIELDS};
                 {WRITE_TEXTS}
                 COMMIT TRANSACTION;"
            ))
            .bind(("id", id.to_owned()))
            .bind(("name", name.map(str::to_owned)))
            .bind(("options", options))
            .bind(("texts", texts))
            .await?
            .check()?
            .take(1)?;

        row.ok_or_else(|| not_found(id))?.try_into()
    }

    /// Deletes a property together with its value in every row of its
    /// database and every mention of it in the database's views, in one
    /// transaction. Relation edges of the property go with it by the
    /// `property_deleted` event.
    pub async fn delete_property(&self, id: &str) -> Result<(), StorageError> {
        // Writers wait while a page is moved to or from the trash.
        let _write = self.write_gate.read().await;
        let property = self.find_property(id).await?.ok_or_else(|| not_found(id))?;

        let (properties, rows) = self
            .read_rows_with(&property.database_id, &property.id)
            .await?;
        let properties: Vec<Property> = properties
            .into_iter()
            .filter(|other| other.id != property.id)
            .collect();
        let mut writes = CellWrites::default();
        for (row, props) in rows {
            writes.push(row, props, &property.id, CellValue::Empty, &properties);
        }
        let views: Vec<ViewWrite> = self
            .list_views(&property.database_id)
            .await?
            .into_iter()
            .filter_map(|view| {
                let config = view.config.clone().without_property(&property.id);
                (config != view.config).then(|| ViewWrite {
                    id: view.id,
                    config: config.to_json(),
                })
            })
            .collect();

        self.db
            .query(format!(
                "BEGIN TRANSACTION;
                 DELETE type::record('property', $id);
                 {WRITE_CELLS}
                 FOR $view IN $views {{
                     UPDATE type::record('view', $view.id) SET config = $view.config
                         WHERE id != NONE RETURN NONE;
                 }};
                 COMMIT TRANSACTION;"
            ))
            .bind(("id", property.id.clone()))
            .bind(("key", property.id))
            .bind(("cells", writes.cells))
            .bind(("emptied", writes.emptied))
            .bind(("views", views))
            .await?
            .check()?;

        Ok(())
    }

    /// Removes an option from a select and empties every cell that held it,
    /// in one transaction. The other options and cells stay as they are.
    pub async fn delete_select_option(
        &self,
        property_id: &str,
        option_id: &str,
    ) -> Result<(), StorageError> {
        // Writers wait while a page is moved to or from the trash.
        let _write = self.write_gate.read().await;
        let property = self
            .find_property(property_id)
            .await?
            .ok_or_else(|| not_found(property_id))?;
        if property.kind != PropertyType::Select {
            return Err(StorageError::Invalid("only a select has options".into()));
        }
        if !property.options.iter().any(|option| option.id == option_id) {
            return Err(StorageError::NotFound(format!("option {option_id}")));
        }

        let held = Value::String(option_id.to_owned());
        let (properties, rows) = self
            .read_rows_with(&property.database_id, &property.id)
            .await?;
        let updated = Property {
            options: property
                .options
                .iter()
                .filter(|option| option.id != option_id)
                .cloned()
                .collect(),
            ..property.clone()
        };
        let properties = replace(properties, updated);
        let mut writes = CellWrites::default();
        for (row, props) in rows {
            if props[&property.id] == held {
                writes.push(row, props, &property.id, CellValue::Empty, &properties);
            }
        }

        self.db
            .query(format!(
                "BEGIN TRANSACTION;
                 UPDATE type::record('property', $id) SET options = options[WHERE id != $option]
                     RETURN NONE;
                 {WRITE_CELLS}
                 COMMIT TRANSACTION;"
            ))
            .bind(("id", property.id.clone()))
            .bind(("option", option_id.to_owned()))
            .bind(("key", property.id))
            .bind(("cells", writes.cells))
            .bind(("emptied", writes.emptied))
            .await?
            .check()?;

        Ok(())
    }

    /// Changes the type of a property and converts every cell in one
    /// transaction, by the conversion table of the spec. Values that cannot
    /// be converted become empty. The same type changes nothing. A relation
    /// keeps its type, and nothing becomes a relation.
    pub async fn change_property_type(
        &self,
        id: &str,
        kind: PropertyType,
    ) -> Result<Property, StorageError> {
        // Writers wait while a page is moved to or from the trash.
        let _write = self.write_gate.read().await;
        let property = self.find_property(id).await?.ok_or_else(|| not_found(id))?;
        if property.kind == kind {
            return Ok(property);
        }
        if property.kind == PropertyType::Relation {
            return Err(StorageError::Invalid(
                "a relation cannot change its type; delete it and add a new property".into(),
            ));
        }
        if kind == PropertyType::Relation {
            return Err(StorageError::Invalid(
                "a property cannot become a relation; add a new relation property".into(),
            ));
        }

        // The cells come in the manual order of the rows, so the options a
        // text creates come out in that order.
        let mut options = OptionsFromTexts::default();
        let (properties, rows) = self
            .read_rows_with(&property.database_id, &property.id)
            .await?;
        let converted: Vec<(String, Props, CellValue)> = rows
            .into_iter()
            .map(|(row, props)| {
                let value = convert(
                    read_cell(&property, &props[&property.id]),
                    &property,
                    kind,
                    &mut options,
                );
                (row, props, value)
            })
            .collect();
        // The search text needs the options the conversion created.
        let updated = Property {
            kind,
            options: options.options.clone(),
            ..property.clone()
        };
        let properties = replace(properties, updated);
        let mut writes = CellWrites::default();
        for (row, props, value) in converted {
            writes.push(row, props, &property.id, value, &properties);
        }
        let options: Vec<OptionWrite> = options.options.iter().map(OptionWrite::from).collect();

        // The cells were read with the old type; if the type changed in the
        // meantime, nothing is written.
        let row: Option<PropertyRow> = self
            .db
            .query(format!(
                "BEGIN TRANSACTION;
                 LET $property = type::record('property', $id);
                 IF (SELECT VALUE type FROM ONLY $property) != $from {{
                     THROW 'the property changed while its type was being changed';
                 }};
                 UPDATE $property SET type = $type, options = $options
                     RETURN {PROPERTY_FIELDS};
                 {WRITE_CELLS}
                 COMMIT TRANSACTION;"
            ))
            .bind(("id", property.id.clone()))
            .bind(("from", type_name(property.kind)))
            .bind(("type", type_name(kind)))
            .bind(("options", options))
            .bind(("key", property.id))
            .bind(("cells", writes.cells))
            .bind(("emptied", writes.emptied))
            .await?
            .check()?
            .take(3)?;

        row.ok_or_else(|| not_found(id))?.try_into()
    }

    /// The property with the given id, if there is one.
    pub(super) async fn find_property(&self, id: &str) -> Result<Option<Property>, StorageError> {
        let row: Option<PropertyRow> = self
            .db
            .query(format!(
                "SELECT {PROPERTY_FIELDS} FROM type::record('property', $id)"
            ))
            .bind(("id", id.to_owned()))
            .await?
            .check()?
            .take(0)?;

        row.map(Property::try_from).transpose()
    }

    /// The page of a database. An ordinary page or a row is not found.
    pub(super) async fn require_database(&self, id: &str) -> Result<Page, StorageError> {
        self.find_page(id)
            .await?
            .filter(|page| page.kind == PageKind::Database)
            .ok_or_else(|| StorageError::NotFound(format!("database {id}")))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;

    use super::super::tests::run_with_pages;
    use super::*;
    use crate::domain::ViewConfig;

    async fn storage() -> Storage {
        Storage::open_in_memory().await.unwrap()
    }

    async fn database(storage: &Storage) -> String {
        storage.create_database(None).await.unwrap().page.id
    }

    fn option(id: &str, name: &str, color: &str) -> SelectOption {
        SelectOption {
            id: id.into(),
            name: name.into(),
            color: color.into(),
        }
    }

    #[tokio::test]
    async fn properties_are_appended_in_the_order_they_were_created() {
        let storage = storage().await;
        let id = database(&storage).await;

        let status = storage
            .create_property(&id, "Status", PropertyType::Select, None)
            .await
            .unwrap();
        let due = storage
            .create_property(&id, "Due", PropertyType::Date, None)
            .await
            .unwrap();
        let notes = storage
            .create_property(&id, "Notes", PropertyType::Text, None)
            .await
            .unwrap();
        let amount = storage
            .create_property(&id, "Amount", PropertyType::Number, None)
            .await
            .unwrap();

        assert_eq!(status.database_id, id);
        assert_eq!(status.name, "Status");
        assert_eq!(status.kind, PropertyType::Select);
        assert!(status.options.is_empty());
        assert_eq!(status.target_id, None);
        assert_eq!(status.position, 0.0);
        assert!(due.position > status.position);
        assert!(notes.position > due.position);
        assert!(amount.position > notes.position);
        assert_eq!(
            storage.load_database(&id).await.unwrap().properties,
            [status, due, notes, amount]
        );
    }

    #[tokio::test]
    async fn a_new_property_comes_after_the_highest_position() {
        let storage = storage().await;
        let id = database(&storage).await;
        run_with_pages(
            &storage,
            &[("database", &id)],
            "CREATE property:late SET database = $database, name = 'Late', type = 'text',
                 position = 7.5;",
        )
        .await;

        let added = storage
            .create_property(&id, "Added", PropertyType::Text, None)
            .await
            .unwrap();

        assert_eq!(added.position, 8.5);
    }

    #[tokio::test]
    async fn properties_of_one_database_do_not_shift_another() {
        let storage = storage().await;
        let first = database(&storage).await;
        let second = database(&storage).await;
        storage
            .create_property(&first, "A", PropertyType::Text, None)
            .await
            .unwrap();
        storage
            .create_property(&first, "B", PropertyType::Text, None)
            .await
            .unwrap();

        let other = storage
            .create_property(&second, "C", PropertyType::Text, None)
            .await
            .unwrap();

        assert_eq!(other.position, 0.0);
        assert_eq!(
            storage.load_database(&second).await.unwrap().properties,
            [other]
        );
    }

    #[tokio::test]
    async fn a_property_needs_a_database() {
        let storage = storage().await;
        let page = storage.create_page(None).await.unwrap().id;

        for id in [page.as_str(), "missing"] {
            let error = storage
                .create_property(id, "Name", PropertyType::Text, None)
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::NotFound(_)), "{id}");
        }
        assert_eq!(count_properties(&storage).await, 0);
    }

    #[tokio::test]
    async fn a_target_on_a_property_that_is_no_relation_is_refused() {
        let storage = storage().await;
        let id = database(&storage).await;

        for kind in [
            PropertyType::Text,
            PropertyType::Number,
            PropertyType::Date,
            PropertyType::Select,
        ] {
            let error = storage
                .create_property(&id, "Name", kind, Some(&id))
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::Invalid(_)), "{kind:?}");
        }
        assert_eq!(count_properties(&storage).await, 0);
    }

    #[tokio::test]
    async fn a_relation_needs_a_target_that_is_a_database() {
        let storage = storage().await;
        let id = database(&storage).await;
        let page = storage.create_page(None).await.unwrap().id;

        let error = storage
            .create_property(&id, "Link", PropertyType::Relation, None)
            .await
            .unwrap_err();
        assert!(matches!(error, StorageError::Invalid(_)), "{error}");
        for target in [page.as_str(), "missing"] {
            let error = storage
                .create_property(&id, "Link", PropertyType::Relation, Some(target))
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::NotFound(_)), "{error}");
        }
        assert_eq!(count_properties(&storage).await, 0);
    }

    #[tokio::test]
    async fn a_relation_points_at_another_database_or_at_its_own() {
        let storage = storage().await;
        let id = database(&storage).await;
        let target = database(&storage).await;

        let other = storage
            .create_property(&id, "Other", PropertyType::Relation, Some(&target))
            .await
            .unwrap();
        let own = storage
            .create_property(&id, "Own", PropertyType::Relation, Some(&id))
            .await
            .unwrap();

        assert_eq!(other.target_id.as_deref(), Some(target.as_str()));
        assert_eq!(own.target_id.as_deref(), Some(id.as_str()));
        assert_eq!(
            storage.load_database(&id).await.unwrap().properties,
            [other, own]
        );
    }

    #[tokio::test]
    async fn renaming_a_property_leaves_its_options_alone() {
        let storage = storage().await;
        let id = database(&storage).await;
        let status = storage
            .create_property(&id, "Status", PropertyType::Select, None)
            .await
            .unwrap();
        let options = [option("open", "Open", "green")];
        storage
            .update_property(&status.id, None, Some(&options))
            .await
            .unwrap();

        let renamed = storage
            .update_property(&status.id, Some("State"), None)
            .await
            .unwrap();

        assert_eq!(
            renamed,
            Property {
                name: "State".into(),
                options: options.to_vec(),
                ..status
            }
        );
        assert_eq!(
            storage.load_database(&id).await.unwrap().properties,
            [renamed]
        );
    }

    #[tokio::test]
    async fn every_type_can_be_renamed() {
        let storage = storage().await;
        let id = database(&storage).await;

        for kind in [
            PropertyType::Text,
            PropertyType::Number,
            PropertyType::Date,
            PropertyType::Select,
        ] {
            let property = storage
                .create_property(&id, "Old", kind, None)
                .await
                .unwrap();
            let renamed = storage
                .update_property(&property.id, Some("New"), None)
                .await
                .unwrap();
            assert_eq!(renamed.name, "New");
            assert_eq!(renamed.kind, kind);
            assert_eq!(renamed.position, property.position);
        }
    }

    #[tokio::test]
    async fn options_are_replaced_as_a_list() {
        let storage = storage().await;
        let id = database(&storage).await;
        let status = storage
            .create_property(&id, "Status", PropertyType::Select, None)
            .await
            .unwrap();
        storage
            .update_property(
                &status.id,
                None,
                Some(&[
                    option("open", "Open", "green"),
                    option("done", "Done", "gray"),
                ]),
            )
            .await
            .unwrap();

        // Rename and recolour `done`, move it first, add `later`.
        let replaced = [
            option("done", "Finished", "blue"),
            option("open", "Open", "green"),
            option("later", "Later", "yellow"),
        ];
        let updated = storage
            .update_property(&status.id, None, Some(&replaced))
            .await
            .unwrap();

        assert_eq!(updated.name, "Status");
        assert_eq!(updated.options, replaced);
        assert_eq!(
            storage.load_database(&id).await.unwrap().properties[0].options,
            replaced
        );

        let emptied = storage
            .update_property(&status.id, None, Some(&[]))
            .await
            .unwrap();
        assert!(emptied.options.is_empty());
    }

    #[tokio::test]
    async fn every_colour_can_be_given_to_an_option() {
        let storage = storage().await;
        let id = database(&storage).await;
        let status = storage
            .create_property(&id, "Status", PropertyType::Select, None)
            .await
            .unwrap();
        let options: Vec<SelectOption> = SELECT_COLORS
            .iter()
            .map(|color| option(color, color, color))
            .collect();

        let updated = storage
            .update_property(&status.id, None, Some(&options))
            .await
            .unwrap();

        assert_eq!(updated.options, options);
    }

    #[tokio::test]
    async fn options_are_refused_on_a_property_that_is_no_select() {
        let storage = storage().await;
        let id = database(&storage).await;

        for kind in [PropertyType::Text, PropertyType::Number, PropertyType::Date] {
            let property = storage
                .create_property(&id, "Name", kind, None)
                .await
                .unwrap();
            let error = storage
                .update_property(&property.id, None, Some(&[option("a", "A", "red")]))
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::Invalid(_)), "{kind:?}");
            // Not even an empty list.
            let error = storage
                .update_property(&property.id, Some("Renamed"), Some(&[]))
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::Invalid(_)), "{kind:?}");
            assert_eq!(
                storage.find_property(&property.id).await.unwrap(),
                Some(property)
            );
        }
    }

    #[tokio::test]
    async fn options_with_an_empty_or_shared_id_or_an_unknown_colour_are_refused() {
        let storage = storage().await;
        let id = database(&storage).await;
        let status = storage
            .create_property(&id, "Status", PropertyType::Select, None)
            .await
            .unwrap();
        let open = option("open", "Open", "green");

        for options in [
            vec![option("", "Nameless", "green")],
            vec![open.clone(), open.clone()],
            vec![open.clone(), option("open", "Other", "red")],
            vec![option("pink", "Pink", "pink")],
            vec![option("loud", "Loud", "#ff0000")],
        ] {
            let error = storage
                .update_property(&status.id, Some("Renamed"), Some(&options))
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::Invalid(_)), "{options:?}");
        }
        assert_eq!(
            storage.find_property(&status.id).await.unwrap(),
            Some(status),
            "a refused update changes nothing, not even the name"
        );
    }

    #[tokio::test]
    async fn updating_an_unknown_property_fails_without_creating_it() {
        let storage = storage().await;

        let error = storage
            .update_property("missing", Some("Name"), None)
            .await
            .unwrap_err();

        assert!(matches!(error, StorageError::NotFound(_)));
        assert_eq!(count_properties(&storage).await, 0);
    }

    // Changing and deleting properties.

    fn text(value: &str) -> CellValue {
        CellValue::Text(value.into())
    }

    fn date(value: &str) -> CellValue {
        CellValue::Date(value.into())
    }

    fn select_value(value: &str) -> CellValue {
        CellValue::Select(value.into())
    }

    /// The options `open` and `done` of the selects in these tests.
    fn open_and_done() -> [SelectOption; 2] {
        [
            option("open", "Open", "green"),
            option("done", "Done", "gray"),
        ]
    }

    /// A database with one row per value and a property of `kind` that holds
    /// the values in that order. A select gets the options `open` and `done`.
    async fn with_values(
        storage: &Storage,
        kind: PropertyType,
        values: &[CellValue],
    ) -> (String, Property, Vec<String>) {
        let database = database(storage).await;
        let mut property = storage
            .create_property(&database, "Values", kind, None)
            .await
            .unwrap();
        if kind == PropertyType::Select {
            property = storage
                .update_property(&property.id, None, Some(&open_and_done()))
                .await
                .unwrap();
        }
        let mut rows = Vec::new();
        for value in values {
            let row = storage.create_row(&database).await.unwrap().id;
            storage
                .set_cell(&row, &property.id, value.clone())
                .await
                .unwrap();
            rows.push(row);
        }
        (database, property, rows)
    }

    /// The values of a property in every row, in the order of the rows, with
    /// `Empty` for a row without one.
    async fn column(storage: &Storage, database: &str, property: &str) -> Vec<CellValue> {
        storage
            .list_rows(database)
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.cells.get(property).cloned().unwrap_or(CellValue::Empty))
            .collect()
    }

    /// The keys of `props` as they are in the stored record of a row.
    async fn stored_keys(storage: &Storage, row: &str) -> Vec<String> {
        let props: Option<Value> = storage
            .db
            .query("SELECT VALUE props FROM ONLY type::record('page', $id)")
            .bind(("id", row.to_owned()))
            .await
            .unwrap()
            .take(0)
            .unwrap();
        let mut keys: Vec<String> = props
            .as_ref()
            .and_then(Value::as_object)
            .map(|props| props.keys().cloned().collect())
            .unwrap_or_default();
        keys.sort();
        keys
    }

    /// Every row of the database holds no key of the property in its record.
    async fn assert_no_row_stores(storage: &Storage, rows: &[String], property: &str) {
        for row in rows {
            let keys = stored_keys(storage, row).await;
            assert!(
                !keys.iter().any(|key| key == property),
                "row {row} still stores {property}: {keys:?}"
            );
        }
    }

    async fn reloaded(storage: &Storage, property: &Property) -> Property {
        storage.find_property(&property.id).await.unwrap().unwrap()
    }

    #[test]
    fn numbers_become_the_text_javascript_writes_for_them() {
        // What `String(n)` gives in JavaScript.
        for (number, written) in [
            (1.0, "1"),
            (1.5, "1.5"),
            (-0.25, "-0.25"),
            (1_000_000.0, "1000000"),
            (12.5, "12.5"),
            (-3.0, "-3"),
            (0.0, "0"),
            (-0.0, "0"),
            (0.1 + 0.2, "0.30000000000000004"),
            (100.0, "100"),
            (123.456, "123.456"),
            (0.000001, "0.000001"),
            (0.0000001, "1e-7"),
            (0.00000123, "0.00000123"),
            (1.5e-10, "1.5e-10"),
            (1e20, "100000000000000000000"),
            (1e21, "1e+21"),
            (1.2345e25, "1.2345e+25"),
            (-1e21, "-1e+21"),
            (9_007_199_254_740_992.0, "9007199254740992"),
            (f64::MAX, "1.7976931348623157e+308"),
            (f64::MIN_POSITIVE, "2.2250738585072014e-308"),
            (5e-324, "5e-324"),
        ] {
            assert_eq!(number_as_text(number), written, "{number:e}");
        }
    }

    #[tokio::test]
    async fn number_to_text_writes_the_number_as_written() {
        let storage = storage().await;
        let values = [1.0, 1.5, -0.25, 1_000_000.0, 12.5, -3.0].map(CellValue::Number);
        let (database, property, rows) = with_values(
            &storage,
            PropertyType::Number,
            &[&values[..], &[CellValue::Empty]].concat(),
        )
        .await;

        let changed = storage
            .change_property_type(&property.id, PropertyType::Text)
            .await
            .unwrap();

        assert_eq!(
            changed,
            Property {
                kind: PropertyType::Text,
                ..property.clone()
            }
        );
        assert_eq!(reloaded(&storage, &property).await, changed);
        assert_eq!(
            column(&storage, &database, &property.id).await,
            [
                text("1"),
                text("1.5"),
                text("-0.25"),
                text("1000000"),
                text("12.5"),
                text("-3"),
                CellValue::Empty
            ]
        );
        assert_no_row_stores(&storage, &rows[6..], &property.id).await;
    }

    #[tokio::test]
    async fn date_to_text_writes_the_date_as_it_is() {
        let storage = storage().await;
        let (database, property, _) = with_values(
            &storage,
            PropertyType::Date,
            &[date("2026-11-13"), CellValue::Empty, date("2024-02-29")],
        )
        .await;

        storage
            .change_property_type(&property.id, PropertyType::Text)
            .await
            .unwrap();

        assert_eq!(
            column(&storage, &database, &property.id).await,
            [text("2026-11-13"), CellValue::Empty, text("2024-02-29")]
        );
    }

    #[tokio::test]
    async fn select_to_text_writes_the_name_of_the_option_and_clears_the_options() {
        let storage = storage().await;
        let (database, property, rows) = with_values(
            &storage,
            PropertyType::Select,
            &[
                select_value("done"),
                select_value("open"),
                CellValue::Empty,
                select_value("open"),
            ],
        )
        .await;

        let changed = storage
            .change_property_type(&property.id, PropertyType::Text)
            .await
            .unwrap();

        assert_eq!(changed.kind, PropertyType::Text);
        assert!(changed.options.is_empty());
        assert_eq!(reloaded(&storage, &property).await, changed);
        assert_eq!(
            column(&storage, &database, &property.id).await,
            [text("Done"), text("Open"), CellValue::Empty, text("Open")]
        );
        assert_no_row_stores(&storage, &rows[2..3], &property.id).await;
    }

    #[tokio::test]
    async fn select_to_text_empties_cells_of_options_that_are_gone_or_have_no_name() {
        let storage = storage().await;
        let (database, property, rows) = with_values(
            &storage,
            PropertyType::Select,
            &[
                select_value("done"),
                select_value("open"),
                select_value("done"),
            ],
        )
        .await;
        // `done` loses its name, `open` is dropped from the list, the way
        // `update_property` leaves cells behind.
        storage
            .update_property(&property.id, None, Some(&[option("done", "", "gray")]))
            .await
            .unwrap();
        storage
            .update_property(
                &property.id,
                None,
                Some(&[option("done", "", "gray"), option("new", "New", "red")]),
            )
            .await
            .unwrap();

        storage
            .change_property_type(&property.id, PropertyType::Text)
            .await
            .unwrap();

        assert_eq!(
            column(&storage, &database, &property.id).await,
            [CellValue::Empty, CellValue::Empty, CellValue::Empty]
        );
        assert_no_row_stores(&storage, &rows, &property.id).await;
    }

    #[tokio::test]
    async fn text_to_number_keeps_what_is_a_number_and_empties_the_rest() {
        let storage = storage().await;
        let texts = [
            "42",
            " -1.5 ",
            "\t7\n",
            "1e3",
            "+.5",
            "12 apples",
            "twelve",
            "",
            "   ",
            "Infinity",
            "inf",
            "NaN",
            "1e400",
            "0x10",
            "1,5",
        ];
        let mut values: Vec<CellValue> = texts.iter().map(|value| text(value)).collect();
        values.push(CellValue::Empty);
        let (database, property, rows) = with_values(&storage, PropertyType::Text, &values).await;

        let changed = storage
            .change_property_type(&property.id, PropertyType::Number)
            .await
            .unwrap();

        assert_eq!(changed.kind, PropertyType::Number);
        assert!(changed.options.is_empty());
        let mut expected: Vec<CellValue> = [42.0, -1.5, 7.0, 1000.0, 0.5]
            .map(CellValue::Number)
            .to_vec();
        expected.resize(values.len(), CellValue::Empty);
        assert_eq!(column(&storage, &database, &property.id).await, expected);
        assert_no_row_stores(&storage, &rows[5..], &property.id).await;
    }

    #[tokio::test]
    async fn text_to_date_keeps_real_calendar_dates_and_empties_the_rest() {
        let storage = storage().await;
        let (database, property, rows) = with_values(
            &storage,
            PropertyType::Text,
            &[
                text("2026-11-13"),
                text(" 2024-02-29 "),
                text("2026-02-30"),
                text("2026-13-01"),
                text("13.11.2026"),
                text("tomorrow"),
                text(""),
                CellValue::Empty,
            ],
        )
        .await;

        let changed = storage
            .change_property_type(&property.id, PropertyType::Date)
            .await
            .unwrap();

        assert_eq!(changed.kind, PropertyType::Date);
        let mut expected = vec![date("2026-11-13"), date("2024-02-29")];
        expected.resize(8, CellValue::Empty);
        assert_eq!(column(&storage, &database, &property.id).await, expected);
        assert_no_row_stores(&storage, &rows[2..], &property.id).await;
    }

    #[tokio::test]
    async fn text_to_select_creates_one_option_per_distinct_text() {
        let storage = storage().await;
        let (database, property, rows) = with_values(
            &storage,
            PropertyType::Text,
            &[
                text("Open"),
                text("Done"),
                text("Open"),
                text(""),
                CellValue::Empty,
                text("open"),
                text(" Open"),
            ],
        )
        .await;

        let changed = storage
            .change_property_type(&property.id, PropertyType::Select)
            .await
            .unwrap();

        assert_eq!(changed.kind, PropertyType::Select);
        let names: Vec<&str> = changed
            .options
            .iter()
            .map(|option| option.name.as_str())
            .collect();
        // Texts are compared exactly as they are, like the fake backend does.
        assert_eq!(names, ["Open", "Done", "open", " Open"]);
        let colors: Vec<&str> = changed
            .options
            .iter()
            .map(|option| option.color.as_str())
            .collect();
        assert_eq!(colors, ["gray", "brown", "orange", "yellow"]);
        let ids: Vec<&str> = changed
            .options
            .iter()
            .map(|option| option.id.as_str())
            .collect();
        assert_eq!(ids.iter().collect::<HashSet<_>>().len(), 4);
        assert!(ids.iter().all(|id| !id.is_empty()));
        assert_eq!(reloaded(&storage, &property).await, changed);
        assert_eq!(
            column(&storage, &database, &property.id).await,
            [
                select_value(ids[0]),
                select_value(ids[1]),
                select_value(ids[0]),
                CellValue::Empty,
                CellValue::Empty,
                select_value(ids[2]),
                select_value(ids[3]),
            ]
        );
        assert_no_row_stores(&storage, &rows[3..5], &property.id).await;
    }

    #[tokio::test]
    async fn text_to_select_starts_the_colours_again_after_the_eighth() {
        let storage = storage().await;
        let names = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
        let values: Vec<CellValue> = names.iter().map(|name| text(name)).collect();
        let (_, property, _) = with_values(&storage, PropertyType::Text, &values).await;

        let changed = storage
            .change_property_type(&property.id, PropertyType::Select)
            .await
            .unwrap();

        let colors: Vec<&str> = changed
            .options
            .iter()
            .map(|option| option.color.as_str())
            .collect();
        assert_eq!(
            colors,
            [
                "gray", "brown", "orange", "yellow", "green", "blue", "purple", "red", "gray",
                "brown"
            ]
        );
    }

    #[tokio::test]
    async fn text_to_select_orders_the_options_by_the_manual_order_of_the_rows() {
        let storage = storage().await;
        let (database, property, rows) = with_values(
            &storage,
            PropertyType::Text,
            &[text("First"), text("Second"), text("Third")],
        )
        .await;
        // The third row was moved to the top of the table.
        run_with_pages(
            &storage,
            &[("row", &rows[2])],
            "UPDATE $row SET position = -1.0;",
        )
        .await;

        let changed = storage
            .change_property_type(&property.id, PropertyType::Select)
            .await
            .unwrap();

        let names: Vec<&str> = changed
            .options
            .iter()
            .map(|option| option.name.as_str())
            .collect();
        assert_eq!(names, ["Third", "First", "Second"]);
        assert_eq!(
            column(&storage, &database, &property.id).await,
            changed
                .options
                .iter()
                .map(|option| select_value(&option.id))
                .collect::<Vec<_>>()
        );
    }

    #[tokio::test]
    async fn every_other_pair_of_types_empties_the_cells() {
        let storage = storage().await;
        use PropertyType::*;

        for (from, value, to) in [
            (Number, CellValue::Number(5.0), Date),
            (Number, CellValue::Number(5.0), Select),
            (Date, date("2026-11-13"), Number),
            (Date, date("2026-11-13"), Select),
            (Select, select_value("open"), Number),
            (Select, select_value("open"), Date),
        ] {
            let (database, property, rows) =
                with_values(&storage, from, &[value, CellValue::Empty]).await;

            let changed = storage
                .change_property_type(&property.id, to)
                .await
                .unwrap();

            assert_eq!(changed.kind, to, "{from:?} → {to:?}");
            assert!(changed.options.is_empty(), "{from:?} → {to:?}");
            assert_eq!(reloaded(&storage, &property).await, changed);
            assert_eq!(
                column(&storage, &database, &property.id).await,
                [CellValue::Empty, CellValue::Empty],
                "{from:?} → {to:?}"
            );
            assert_no_row_stores(&storage, &rows, &property.id).await;
        }
    }

    #[tokio::test]
    async fn leaving_select_clears_the_options_even_without_cells() {
        let storage = storage().await;

        for to in [PropertyType::Text, PropertyType::Number, PropertyType::Date] {
            let (_, property, _) = with_values(&storage, PropertyType::Select, &[]).await;
            assert_eq!(property.options.len(), 2);

            let changed = storage
                .change_property_type(&property.id, to)
                .await
                .unwrap();

            assert!(changed.options.is_empty(), "{to:?}");
            assert!(reloaded(&storage, &property).await.options.is_empty());
        }
    }

    #[tokio::test]
    async fn the_same_type_changes_nothing() {
        let storage = storage().await;
        use PropertyType::*;

        for (kind, value) in [
            (Text, text(" 12 ")),
            (Number, CellValue::Number(5.0)),
            (Date, date("2026-11-13")),
            (Select, select_value("done")),
        ] {
            let (database, property, _) =
                with_values(&storage, kind, std::slice::from_ref(&value)).await;

            let unchanged = storage
                .change_property_type(&property.id, kind)
                .await
                .unwrap();

            assert_eq!(unchanged, property, "{kind:?}");
            assert_eq!(reloaded(&storage, &property).await, property);
            assert_eq!(column(&storage, &database, &property.id).await, [value]);
        }
    }

    #[tokio::test]
    async fn a_relation_cannot_change_its_type_and_nothing_becomes_one() {
        let storage = storage().await;
        let (database, notes, rows) =
            with_values(&storage, PropertyType::Text, &[text("kept")]).await;
        run_with_pages(
            &storage,
            &[("database", &database)],
            "CREATE property:link SET database = $database, name = 'Link', type = 'relation',
                 position = 5.0, target = $database;",
        )
        .await;
        let link = storage.find_property("link").await.unwrap().unwrap();

        for to in [
            PropertyType::Text,
            PropertyType::Number,
            PropertyType::Date,
            PropertyType::Select,
        ] {
            let error = storage.change_property_type("link", to).await.unwrap_err();
            assert!(matches!(error, StorageError::Invalid(_)), "{to:?}");
        }
        for from in [&notes] {
            let error = storage
                .change_property_type(&from.id, PropertyType::Relation)
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::Invalid(_)));
        }

        // A relation that stays a relation is the same type, which changes nothing.
        assert_eq!(
            storage
                .change_property_type("link", PropertyType::Relation)
                .await
                .unwrap(),
            link
        );
        assert_eq!(reloaded(&storage, &link).await, link);
        assert_eq!(reloaded(&storage, &notes).await, notes);
        assert_eq!(
            stored_keys(&storage, &rows[0]).await,
            std::slice::from_ref(&notes.id)
        );
        assert_eq!(column(&storage, &database, &notes.id).await, [text("kept")]);
    }

    #[tokio::test]
    async fn changing_the_type_of_an_unknown_property_is_not_found() {
        let storage = storage().await;

        let error = storage
            .change_property_type("missing", PropertyType::Text)
            .await
            .unwrap_err();

        assert!(matches!(error, StorageError::NotFound(_)));
        assert_eq!(count_properties(&storage).await, 0);
    }

    #[tokio::test]
    async fn changing_a_type_leaves_other_properties_and_databases_alone() {
        let storage = storage().await;
        let (database, property, rows) =
            with_values(&storage, PropertyType::Text, &[text("12"), text("x")]).await;
        let other = storage
            .create_property(&database, "Other", PropertyType::Text, None)
            .await
            .unwrap();
        storage
            .set_cell(&rows[1], &other.id, text("34"))
            .await
            .unwrap();
        let (elsewhere, far, _) = with_values(&storage, PropertyType::Text, &[text("56")]).await;

        storage
            .change_property_type(&property.id, PropertyType::Number)
            .await
            .unwrap();

        let listed = storage.list_rows(&database).await.unwrap();
        assert_eq!(
            listed[0].cells,
            BTreeMap::from([(property.id.clone(), CellValue::Number(12.0))])
        );
        assert_eq!(listed[1].cells, BTreeMap::from([(other.id, text("34"))]));
        assert_eq!(column(&storage, &elsewhere, &far.id).await, [text("56")]);
        assert_eq!(reloaded(&storage, &far).await, far);
    }

    #[tokio::test]
    async fn a_type_change_leaves_the_views_alone() {
        let storage = storage().await;
        let (database, property, _) = with_values(&storage, PropertyType::Text, &[]).await;
        let config = ViewConfig::from_json(json!({
            "version": 1, "type": "table",
            "filters": [{ "propertyId": property.id, "operator": "contains", "value": "a" }],
            "sorts": [{ "propertyId": property.id, "direction": "asc" }],
            "properties": [], "groupBy": null,
        }))
        .unwrap();
        let view = storage
            .create_view(&database, "Mentions", &config)
            .await
            .unwrap();

        storage
            .change_property_type(&property.id, PropertyType::Number)
            .await
            .unwrap();

        let views = storage.load_database(&database).await.unwrap().views;
        assert_eq!(views[1], view);
    }

    #[tokio::test]
    async fn a_conversion_writes_every_row_of_a_large_database_in_bulk() {
        let storage = storage().await;
        let database = database(&storage).await;
        let property = storage
            .create_property(&database, "Amount", PropertyType::Text, None)
            .await
            .unwrap();
        // 3,000 rows: every third holds a number, every third other text,
        // every third nothing.
        run_with_pages(
            &storage,
            &[("database", &database)],
            &format!(
                "FOR $index IN 0..3000 {{
                     LET $props = IF $index % 3 = 0 {{ {{ `{key}`: <string> $index }} }}
                         ELSE IF $index % 3 = 1 {{ {{ `{key}`: 'n/a' }} }}
                         ELSE {{ {{}} }};
                     CREATE page SET title = '', parent = $database, database = $database,
                         position = <float> $index, props = $props;
                 }};",
                key = property.id
            ),
        )
        .await;

        storage
            .change_property_type(&property.id, PropertyType::Number)
            .await
            .unwrap();

        let values = column(&storage, &database, &property.id).await;
        assert_eq!(values.len(), 3000);
        for (index, value) in values.iter().enumerate() {
            let expected = if index % 3 == 0 {
                CellValue::Number(index as f64)
            } else {
                CellValue::Empty
            };
            assert_eq!(value, &expected, "row {index}");
        }
        let keys: i64 = storage
            .db
            .query(
                "LET $database = type::record('page', $id);
                 RETURN count(SELECT VALUE id FROM page WHERE database = $database
                     AND props[$key] != NONE);",
            )
            .bind(("id", database))
            .bind(("key", property.id))
            .await
            .unwrap()
            .take::<Option<i64>>(1)
            .unwrap()
            .unwrap();
        assert_eq!(keys, 1000, "only the rows with a number keep the key");
    }

    #[tokio::test]
    async fn deleting_a_property_removes_its_key_from_every_row_record() {
        let storage = storage().await;
        let (database, notes, rows) = with_values(
            &storage,
            PropertyType::Text,
            &[text("gone"), CellValue::Empty, text("gone too")],
        )
        .await;
        let amount = storage
            .create_property(&database, "Amount", PropertyType::Number, None)
            .await
            .unwrap();
        storage
            .set_cell(&rows[0], &amount.id, CellValue::Number(1.0))
            .await
            .unwrap();
        let (elsewhere, far, far_rows) =
            with_values(&storage, PropertyType::Text, &[text("other database")]).await;

        storage.delete_property(&notes.id).await.unwrap();

        assert_eq!(
            storage.load_database(&database).await.unwrap().properties,
            std::slice::from_ref(&amount)
        );
        assert_no_row_stores(&storage, &rows, &notes.id).await;
        assert_eq!(
            stored_keys(&storage, &rows[0]).await,
            std::slice::from_ref(&amount.id)
        );
        assert_eq!(
            storage
                .list_rows(&database)
                .await
                .unwrap()
                .into_iter()
                .map(|row| row.cells)
                .collect::<Vec<_>>(),
            [
                BTreeMap::from([(amount.id.clone(), CellValue::Number(1.0))]),
                BTreeMap::new(),
                BTreeMap::new(),
            ]
        );
        assert_eq!(
            stored_keys(&storage, &far_rows[0]).await,
            std::slice::from_ref(&far.id)
        );
        assert_eq!(
            column(&storage, &elsewhere, &far.id).await,
            [text("other database")]
        );

        let again = storage.delete_property(&notes.id).await.unwrap_err();
        assert!(matches!(again, StorageError::NotFound(_)));
    }

    #[tokio::test]
    async fn deleting_an_unknown_property_is_not_found() {
        let storage = storage().await;
        let (database, property, _) = with_values(&storage, PropertyType::Text, &[]).await;

        let error = storage.delete_property("missing").await.unwrap_err();

        assert!(matches!(error, StorageError::NotFound(_)));
        assert_eq!(
            storage.load_database(&database).await.unwrap().properties,
            [property]
        );
    }

    #[tokio::test]
    async fn deleting_a_property_removes_every_mention_of_it_from_the_views() {
        let storage = storage().await;
        let (database, gone, _) = with_values(&storage, PropertyType::Select, &[]).await;
        let kept = storage
            .create_property(&database, "Kept", PropertyType::Date, None)
            .await
            .unwrap();
        let (gone, kept) = (gone.id, kept.id);
        let base = |kind: &str| {
            json!({
                "version": 1,
                "type": kind,
                "filters": [
                    { "propertyId": gone, "operator": "equals", "value": "open" },
                    { "propertyId": kept, "operator": "isNotEmpty", "value": null },
                ],
                "sorts": [
                    { "propertyId": gone, "direction": "desc" },
                    { "propertyId": kept, "direction": "asc" },
                ],
                "properties": [
                    { "propertyId": "title", "visible": true, "width": 240 },
                    { "propertyId": gone, "visible": true, "width": null },
                    { "propertyId": kept, "visible": false, "width": 90 },
                ],
            })
        };
        let with = |mut value: Value, extra: Value| {
            value
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            value
        };
        let configs = [
            with(
                base("table"),
                json!({ "groupBy": { "propertyId": gone, "collapsed": ["open"] } }),
            ),
            with(
                base("kanban"),
                json!({ "groupPropertyId": gone, "hiddenGroups": ["done"] }),
            ),
            with(base("calendar"), json!({ "datePropertyId": gone })),
            // Views that use the kept property for grouping and dates.
            with(
                base("table"),
                json!({ "groupBy": { "propertyId": kept, "collapsed": [] } }),
            ),
            with(
                base("kanban"),
                json!({ "groupPropertyId": kept, "hiddenGroups": ["2026-11-13"] }),
            ),
            with(base("calendar"), json!({ "datePropertyId": kept })),
        ];
        for config in &configs {
            storage
                .create_view(
                    &database,
                    "View",
                    &ViewConfig::from_json(config.clone()).unwrap(),
                )
                .await
                .unwrap();
        }

        storage.delete_property(&gone).await.unwrap();

        let views = storage.load_database(&database).await.unwrap().views;
        assert_eq!(views.len(), 7);
        let left = |kind: &str| {
            json!({
                "version": 1,
                "type": kind,
                "filters": [{ "propertyId": kept, "operator": "isNotEmpty", "value": null }],
                "sorts": [{ "propertyId": kept, "direction": "asc" }],
                "properties": [
                    { "propertyId": "title", "visible": true, "width": 240 },
                    { "propertyId": kept, "visible": false, "width": 90 },
                ],
            })
        };
        let expected = [
            with(left("table"), json!({ "groupBy": null })),
            with(
                left("kanban"),
                json!({ "groupPropertyId": null, "hiddenGroups": [] }),
            ),
            with(left("calendar"), json!({ "datePropertyId": null })),
            with(
                left("table"),
                json!({ "groupBy": { "propertyId": kept, "collapsed": [] } }),
            ),
            with(
                left("kanban"),
                json!({ "groupPropertyId": kept, "hiddenGroups": ["2026-11-13"] }),
            ),
            with(left("calendar"), json!({ "datePropertyId": kept })),
        ];
        for (view, expected) in views[1..].iter().zip(expected) {
            assert_eq!(view.config.to_json(), expected);
            assert!(!view.config.to_json().to_string().contains(&gone));
        }
        assert_eq!(views[0].config, ViewConfig::empty_table());
    }

    #[tokio::test]
    async fn deleting_a_relation_property_removes_its_edges() {
        let storage = storage().await;
        let database = database(&storage).await;
        run_with_pages(
            &storage,
            &[("database", &database)],
            "CREATE page:a SET title = 'A', parent = $database, database = $database;
             CREATE page:b SET title = 'B', parent = $database, database = $database,
                 position = 1.0;
             CREATE property:link SET database = $database, name = 'Link', type = 'relation',
                 target = $database;
             RELATE page:a->row_link->page:b SET property = property:link;",
        )
        .await;

        storage.delete_property("link").await.unwrap();

        let edges: Option<i64> = storage
            .db
            .query("RETURN count(SELECT * FROM row_link)")
            .await
            .unwrap()
            .take(0)
            .unwrap();
        assert_eq!(edges, Some(0));
        assert_eq!(count_properties(&storage).await, 0);
    }

    #[tokio::test]
    async fn deleting_an_option_empties_exactly_the_cells_that_held_it() {
        let storage = storage().await;
        let (database, status, rows) = with_values(
            &storage,
            PropertyType::Select,
            &[
                select_value("open"),
                select_value("done"),
                CellValue::Empty,
                select_value("open"),
            ],
        )
        .await;
        let notes = storage
            .create_property(&database, "Notes", PropertyType::Text, None)
            .await
            .unwrap();
        // A text cell that happens to hold the option id stays.
        storage
            .set_cell(&rows[0], &notes.id, text("open"))
            .await
            .unwrap();
        let (elsewhere, other_status, _) =
            with_values(&storage, PropertyType::Select, &[select_value("open")]).await;

        storage
            .delete_select_option(&status.id, "open")
            .await
            .unwrap();

        let [_, done] = open_and_done();
        assert_eq!(reloaded(&storage, &status).await.options, [done]);
        assert_eq!(
            column(&storage, &database, &status.id).await,
            [
                CellValue::Empty,
                select_value("done"),
                CellValue::Empty,
                CellValue::Empty
            ]
        );
        assert_no_row_stores(&storage, &[rows[0].clone(), rows[3].clone()], &status.id).await;
        assert_eq!(
            stored_keys(&storage, &rows[0]).await,
            std::slice::from_ref(&notes.id)
        );
        assert_eq!(
            column(&storage, &database, &notes.id).await[0],
            text("open")
        );
        assert_eq!(
            column(&storage, &elsewhere, &other_status.id).await,
            [select_value("open")],
            "the same option id in another property is left alone"
        );
        let refused = storage
            .set_cell(&rows[0], &status.id, select_value("open"))
            .await
            .unwrap_err();
        assert!(matches!(refused, StorageError::Invalid(_)));
    }

    #[tokio::test]
    async fn deleting_an_option_refuses_unknown_ids_and_properties_without_options() {
        let storage = storage().await;
        let (database, status, _) =
            with_values(&storage, PropertyType::Select, &[select_value("open")]).await;
        let notes = storage
            .create_property(&database, "Notes", PropertyType::Text, None)
            .await
            .unwrap();

        let unknown_option = storage.delete_select_option(&status.id, "missing").await;
        let no_select = storage.delete_select_option(&notes.id, "open").await;
        let unknown_property = storage.delete_select_option("missing", "open").await;

        assert!(matches!(unknown_option, Err(StorageError::NotFound(_))));
        assert!(matches!(no_select, Err(StorageError::Invalid(_))));
        assert!(matches!(unknown_property, Err(StorageError::NotFound(_))));
        assert_eq!(reloaded(&storage, &status).await, status);
        assert_eq!(
            column(&storage, &database, &status.id).await,
            [select_value("open")]
        );
    }

    async fn count_properties(storage: &Storage) -> i64 {
        let count: Option<i64> = storage
            .db
            .query("RETURN count(SELECT * FROM property)")
            .await
            .unwrap()
            .take(0)
            .unwrap();
        count.unwrap()
    }
}
