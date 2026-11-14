//! The row repository: the rows of a database and the values in their cells.
//!
//! A row is a page below its database with `database` set to it. Its cells
//! live in `page.props`, keyed by property id. Titles go through the page
//! repository like the title of any page.

use std::collections::BTreeMap;

use serde_json::Value;
use surrealdb::types::SurrealValue;

use super::databases::PropertyRow;
use super::properties::PROPERTY_FIELDS;
use super::{Storage, StorageError};
use crate::domain::{CellValue, Property, PropertyType, Row};

/// The property id that stands for the title of a row. The title is not a
/// property; it is changed with `rename_page`.
const TITLE: &str = "title";

/// A row as it is stored.
#[derive(SurrealValue)]
struct RowRecord {
    id: String,
    title: String,
    position: f64,
    props: Option<Value>,
}

/// Whether `text` is a day of the calendar written as `yyyy-MM-dd`.
pub(super) fn is_calendar_date(text: &str) -> bool {
    let bytes = text.as_bytes();
    let digits = |range: std::ops::Range<usize>| {
        bytes[range.clone()]
            .iter()
            .all(u8::is_ascii_digit)
            .then(|| {
                bytes[range]
                    .iter()
                    .fold(0_u32, |number, digit| number * 10 + u32::from(digit - b'0'))
            })
    };
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let (Some(year), Some(month), Some(day)) = (digits(0..4), digits(5..7), digits(8..10)) else {
        return false;
    };

    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&day)
}

/// What a cell of the type takes, for the message of a refused value.
fn expected(kind: PropertyType) -> &'static str {
    match kind {
        PropertyType::Text => "a text cell takes a string",
        PropertyType::Number => "a number cell takes a finite number",
        PropertyType::Date => "a date cell takes a day of the calendar as yyyy-MM-dd",
        PropertyType::Select => "a select cell takes the id of one of its options",
        PropertyType::Relation => "relation cells are not supported yet",
    }
}

/// Refuses a value that does not fit the property and returns it otherwise.
fn check(property: &Property, value: CellValue) -> Result<CellValue, StorageError> {
    let fits = match (&value, property.kind) {
        (CellValue::Empty, _) => true,
        (CellValue::Text(_), PropertyType::Text) => true,
        (CellValue::Number(number), PropertyType::Number) => number.is_finite(),
        (CellValue::Date(date), PropertyType::Date) => is_calendar_date(date),
        (CellValue::Select(id), PropertyType::Select) => {
            if !property.options.iter().any(|option| &option.id == id) {
                return Err(StorageError::Invalid(format!(
                    "{id} is not an option of the property {}",
                    property.id
                )));
            }
            true
        }
        // Relation cells are graph edges, delivered with #61.
        _ => false,
    };

    if fits {
        Ok(value)
    } else {
        Err(StorageError::Invalid(expected(property.kind).into()))
    }
}

/// The value a stored cell has for a reader. Anything that no longer fits the
/// property, such as an option that is gone, reads as empty.
fn read_cell(property: &Property, stored: &Value) -> CellValue {
    CellValue::from_json(property.kind, stored)
        .and_then(|value| check(property, value).ok())
        .unwrap_or(CellValue::Empty)
}

/// The cells of a row: the stored values of the existing properties that are
/// not empty. Keys of properties that are gone are skipped.
fn read_cells(properties: &[Property], props: Option<&Value>) -> BTreeMap<String, CellValue> {
    let Some(props) = props.and_then(Value::as_object) else {
        return BTreeMap::new();
    };

    properties
        .iter()
        .filter_map(|property| {
            let value = read_cell(property, props.get(&property.id)?);
            (value != CellValue::Empty).then(|| (property.id.clone(), value))
        })
        .collect()
}

/// How a value is stored in `props`.
fn stored(value: CellValue) -> Option<Value> {
    match value {
        CellValue::Empty => None,
        CellValue::Text(text) | CellValue::Date(text) | CellValue::Select(text) => {
            Some(Value::String(text))
        }
        CellValue::Number(number) => serde_json::Number::from_f64(number).map(Value::Number),
        CellValue::Relation(ids) => {
            Some(Value::Array(ids.into_iter().map(Value::String).collect()))
        }
    }
}

impl Storage {
    /// The rows of a database in their manual order, with their cells.
    pub async fn list_rows(&self, database_id: &str) -> Result<Vec<Row>, StorageError> {
        self.require_database(database_id).await?;

        // `$database` is bound with LET so that both reads use their index.
        let mut response = self
            .db
            .query(format!(
                "LET $database = type::record('page', $id);
                 SELECT {PROPERTY_FIELDS} FROM property WHERE database = $database
                     ORDER BY position;
                 SELECT record::id(id) AS id, title, position, props
                     FROM page WHERE database = $database ORDER BY position;"
            ))
            .bind(("id", database_id.to_owned()))
            .await?
            .check()?;
        let properties: Vec<PropertyRow> = response.take(1)?;
        let properties = properties
            .into_iter()
            .map(Property::try_from)
            .collect::<Result<Vec<_>, _>>()?;
        let records: Vec<RowRecord> = response.take(2)?;

        Ok(records
            .into_iter()
            .map(|record| Row {
                cells: read_cells(&properties, record.props.as_ref()),
                id: record.id,
                title: record.title,
                position: record.position,
            })
            .collect())
    }

    /// Adds an untitled row after the last row of the database, without
    /// touching the others.
    pub async fn create_row(&self, database_id: &str) -> Result<Row, StorageError> {
        self.require_database(database_id).await?;

        let record: Option<RowRecord> = self
            .db
            .query(
                "LET $database = type::record('page', $id);
                 LET $last = (SELECT VALUE position FROM page WHERE database = $database
                     ORDER BY position DESC LIMIT 1)[0];
                 CREATE page SET title = '', parent = $database, database = $database,
                     position = ($last ?? -1.0) + 1.0
                     RETURN record::id(id) AS id, title, position, props;",
            )
            .bind(("id", database_id.to_owned()))
            .await?
            .check()?
            .take(2)?;

        let record = record
            .ok_or_else(|| StorageError::Database("the created row was not returned".into()))?;
        Ok(Row {
            id: record.id,
            title: record.title,
            position: record.position,
            cells: BTreeMap::new(),
        })
    }

    /// Writes one cell of a row. [`CellValue::Empty`] empties it.
    pub async fn set_cell(
        &self,
        row_id: &str,
        property_id: &str,
        value: CellValue,
    ) -> Result<(), StorageError> {
        let property = self.cell_property(row_id, property_id).await?;
        let value = stored(check(&property, value)?);

        // `UNSET props[$key]` does nothing in SurrealDB 4.0.1; setting the key
        // to NONE removes it.
        let statement = match value {
            Some(_) => {
                "UPDATE type::record('page', $id) SET props[$key] = $value, updated_at = time::now()"
            }
            None => {
                "UPDATE type::record('page', $id) SET props[$key] = NONE, updated_at = time::now()"
            }
        };
        self.db
            .query(statement)
            .bind(("id", row_id.to_owned()))
            .bind(("key", property.id))
            .bind(("value", value))
            .await?
            .check()?;

        Ok(())
    }

    /// Writes one cell of a row from the JSON the frontend sends: a string, a
    /// number, a list of row ids or `null`. What the JSON means depends on the
    /// type of the property.
    pub async fn set_cell_from_json(
        &self,
        row_id: &str,
        property_id: &str,
        value: &Value,
    ) -> Result<(), StorageError> {
        // The type of the property decides what the JSON means. `set_cell`
        // reads the row and the property again, which keeps one path that
        // checks and writes a cell, for the price of two point reads.
        let property = self.cell_property(row_id, property_id).await?;
        let value = CellValue::from_json(property.kind, value)
            .ok_or_else(|| StorageError::Invalid(expected(property.kind).into()))?;
        self.set_cell(row_id, property_id, value).await
    }

    /// The property of a cell, after checking that the row is one and that
    /// the property belongs to its database.
    async fn cell_property(
        &self,
        row_id: &str,
        property_id: &str,
    ) -> Result<Property, StorageError> {
        let row = self
            .find_page(row_id)
            .await?
            .ok_or_else(|| StorageError::NotFound(format!("page {row_id}")))?;
        let Some(database_id) = row.database_id else {
            return Err(StorageError::Invalid(format!(
                "page {row_id} is not a row of a database"
            )));
        };
        if property_id == TITLE {
            // The title is changed with rename_page.
            return Err(StorageError::NotFound(format!("property {TITLE}")));
        }
        let property = self
            .find_property(property_id)
            .await?
            .ok_or_else(|| StorageError::NotFound(format!("property {property_id}")))?;
        if property.database_id != database_id {
            return Err(StorageError::Invalid(
                "the property does not belong to the database of the row".into(),
            ));
        }
        Ok(property)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Map, json};

    use super::super::tests::run_with_pages;
    use super::*;
    use crate::domain::{Block, PageKind, SelectOption};

    async fn storage() -> Storage {
        Storage::open_in_memory().await.unwrap()
    }

    /// A database with a row for each title, created with `create_row`.
    async fn database_with_rows(storage: &Storage, titles: &[&str]) -> (String, Vec<Row>) {
        let database = storage.create_database(None).await.unwrap().page.id;
        let mut rows = Vec::new();
        for title in titles {
            let row = storage.create_row(&database).await.unwrap();
            storage.rename_page(&row.id, title).await.unwrap();
            rows.push(Row {
                title: (*title).to_owned(),
                ..row
            });
        }
        (database, rows)
    }

    async fn property(storage: &Storage, database: &str, kind: PropertyType) -> Property {
        storage
            .create_property(database, "Property", kind, None)
            .await
            .unwrap()
    }

    /// A select with the options `open` and `done`.
    async fn select(storage: &Storage, database: &str) -> Property {
        let status = property(storage, database, PropertyType::Select).await;
        let options = [
            SelectOption {
                id: "open".into(),
                name: "Open".into(),
                color: "green".into(),
            },
            SelectOption {
                id: "done".into(),
                name: "Done".into(),
                color: "gray".into(),
            },
        ];
        storage
            .update_property(&status.id, None, Some(&options))
            .await
            .unwrap()
    }

    async fn cells(storage: &Storage, database: &str, index: usize) -> BTreeMap<String, CellValue> {
        storage.list_rows(database).await.unwrap()[index]
            .cells
            .clone()
    }

    /// The stored `props` of a page, exactly as they are in the record.
    async fn props(storage: &Storage, id: &str) -> Option<Value> {
        storage
            .db
            .query("SELECT VALUE props FROM ONLY type::record('page', $id)")
            .bind(("id", id.to_owned()))
            .await
            .unwrap()
            .take(0)
            .unwrap()
    }

    async fn updated_at(storage: &Storage, id: &str) -> String {
        let value: Option<String> = storage
            .db
            .query("SELECT VALUE <string> updated_at FROM ONLY type::record('page', $id)")
            .bind(("id", id.to_owned()))
            .await
            .unwrap()
            .take(0)
            .unwrap();
        value.unwrap()
    }

    // Rows.

    #[tokio::test]
    async fn rows_are_appended_in_the_order_they_were_created() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["One", "Two", "Three"]).await;

        let listed = storage.list_rows(&database).await.unwrap();

        assert_eq!(listed, rows);
        assert_eq!(
            listed
                .iter()
                .map(|row| row.title.as_str())
                .collect::<Vec<_>>(),
            ["One", "Two", "Three"]
        );
        assert!(listed.iter().all(|row| row.cells.is_empty()));
        assert_eq!(listed[0].position, 0.0);
    }

    #[tokio::test]
    async fn a_new_row_is_untitled_and_empty() {
        let storage = storage().await;
        let database = storage.create_database(None).await.unwrap().page.id;

        let row = storage.create_row(&database).await.unwrap();

        assert_eq!(row.title, "");
        assert!(row.cells.is_empty());
        assert_eq!(storage.list_rows(&database).await.unwrap(), [row]);
    }

    #[tokio::test]
    async fn rows_come_back_in_the_order_of_their_positions() {
        let storage = storage().await;
        let database = storage.create_database(None).await.unwrap().page.id;
        run_with_pages(
            &storage,
            &[("database", &database)],
            "CREATE page:late SET title = 'Late', parent = $database, database = $database,
                 position = 2.5;
             CREATE page:early SET title = 'Early', parent = $database, database = $database,
                 position = 0.25;
             CREATE page:middle SET title = 'Middle', parent = $database, database = $database,
                 position = 1.0;",
        )
        .await;

        let ids: Vec<String> = storage
            .list_rows(&database)
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.id)
            .collect();

        assert_eq!(ids, ["early", "middle", "late"]);
    }

    #[tokio::test]
    async fn a_new_row_comes_after_the_last_one_without_touching_the_others() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["One", "Two", "Three"]).await;
        storage.delete_page(&rows[0].id).await.unwrap();
        // A midpoint, the way a row moved by the table would be stored.
        run_with_pages(
            &storage,
            &[("row", &rows[2].id)],
            "UPDATE $row SET position = 7.5;",
        )
        .await;
        let before = storage.list_rows(&database).await.unwrap();

        let added = storage.create_row(&database).await.unwrap();

        let after = storage.list_rows(&database).await.unwrap();
        assert_eq!(after[..2], before[..]);
        assert_eq!(after[2], added);
        assert_eq!(added.position, 8.5);
    }

    #[tokio::test]
    async fn rows_of_one_database_are_not_rows_of_another() {
        let storage = storage().await;
        let (first, _) = database_with_rows(&storage, &["A", "B"]).await;
        let (second, rows) = database_with_rows(&storage, &["C"]).await;

        assert_eq!(storage.list_rows(&second).await.unwrap(), rows);
        assert_eq!(rows[0].position, 0.0);
        assert_eq!(storage.list_rows(&first).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn rows_need_a_database() {
        let storage = storage().await;
        let page = storage.create_page(None).await.unwrap().id;
        let (_, rows) = database_with_rows(&storage, &["Row"]).await;

        for id in [page.as_str(), rows[0].id.as_str(), "missing"] {
            let listed = storage.list_rows(id).await.unwrap_err();
            let created = storage.create_row(id).await.unwrap_err();
            assert!(matches!(listed, StorageError::NotFound(_)), "{id}");
            assert!(matches!(created, StorageError::NotFound(_)), "{id}");
        }
        assert_eq!(storage.list_pages().await.unwrap().len(), 3);
    }

    #[tokio::test]
    async fn listing_rows_reads_them_through_the_database_index() {
        let storage = storage().await;
        let (database, _) = database_with_rows(&storage, &["Row"]).await;

        let plan: Value = storage
            .db
            .query(
                "LET $database = type::record('page', $id);
                 SELECT record::id(id) AS id, title, position, props
                     FROM page WHERE database = $database ORDER BY position EXPLAIN;",
            )
            .bind(("id", database))
            .await
            .unwrap()
            .take::<Option<Value>>(1)
            .unwrap()
            .unwrap();

        assert!(plan.to_string().contains("page_database"), "{plan}");
    }

    // Rows are pages.

    #[tokio::test]
    async fn a_row_is_listed_as_a_page_of_its_database() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["Row"]).await;

        let pages = storage.list_pages().await.unwrap();
        let row = pages.iter().find(|page| page.id == rows[0].id).unwrap();

        assert_eq!(row.title, "Row");
        assert_eq!(row.kind, PageKind::Page);
        assert_eq!(row.parent_id.as_deref(), Some(database.as_str()));
        assert_eq!(row.database_id.as_deref(), Some(database.as_str()));
        assert_eq!(row.position, rows[0].position);
    }

    #[tokio::test]
    async fn a_row_is_renamed_like_a_page_and_keeps_its_cells() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["Row"]).await;
        let notes = property(&storage, &database, PropertyType::Text).await;
        storage
            .set_cell(&rows[0].id, &notes.id, CellValue::Text("hello".into()))
            .await
            .unwrap();

        let renamed = storage.rename_page(&rows[0].id, "Dune").await.unwrap();

        assert_eq!(renamed.database_id.as_deref(), Some(database.as_str()));
        let listed = &storage.list_rows(&database).await.unwrap()[0];
        assert_eq!(listed.title, "Dune");
        assert_eq!(
            listed.cells,
            BTreeMap::from([(notes.id, CellValue::Text("hello".into()))])
        );
    }

    #[tokio::test]
    async fn a_row_is_deleted_like_a_page_with_its_blocks() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["One", "Two"]).await;
        storage
            .save_blocks(&rows[0].id, &[paragraph("note", "Gone with the row")])
            .await
            .unwrap();

        storage.delete_page(&rows[0].id).await.unwrap();

        assert_eq!(storage.list_rows(&database).await.unwrap(), rows[1..]);
        assert!(storage.load_blocks(&rows[0].id).await.is_err());
        let blocks: Vec<Value> = storage
            .db
            .query("SELECT * FROM block")
            .await
            .unwrap()
            .take(0)
            .unwrap();
        assert!(blocks.is_empty());
    }

    #[tokio::test]
    async fn a_row_has_a_document_like_a_page() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["Row"]).await;
        let document = [paragraph("first", "Notes on the row")];

        assert!(storage.load_blocks(&rows[0].id).await.unwrap().is_empty());
        storage.save_blocks(&rows[0].id, &document).await.unwrap();

        assert_eq!(storage.load_blocks(&rows[0].id).await.unwrap(), document);
        assert_eq!(
            storage.list_rows(&database).await.unwrap(),
            rows,
            "the document does not change the row in the table"
        );
    }

    #[tokio::test]
    async fn deleting_a_database_deletes_its_rows() {
        let storage = storage().await;
        let (database, _) = database_with_rows(&storage, &["One", "Two"]).await;

        storage.delete_page(&database).await.unwrap();

        assert!(storage.list_pages().await.unwrap().is_empty());
    }

    fn paragraph(id: &str, text: &str) -> Block {
        Block {
            id: id.into(),
            kind: "paragraph".into(),
            props: Map::new(),
            content: Some(json!([{ "type": "text", "text": text, "styles": {} }])),
            children: Vec::new(),
        }
    }

    // Cells.

    #[tokio::test]
    async fn every_type_round_trips_through_set_cell_and_list_rows() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["Row"]).await;
        let text = property(&storage, &database, PropertyType::Text).await;
        let number = property(&storage, &database, PropertyType::Number).await;
        let whole = property(&storage, &database, PropertyType::Number).await;
        let date = property(&storage, &database, PropertyType::Date).await;
        let status = select(&storage, &database).await;
        let row = &rows[0].id;

        storage
            .set_cell(row, &text.id, CellValue::Text("hello".into()))
            .await
            .unwrap();
        storage
            .set_cell(row, &number.id, CellValue::Number(-12.5))
            .await
            .unwrap();
        storage
            .set_cell(row, &whole.id, CellValue::Number(3.0))
            .await
            .unwrap();
        storage
            .set_cell(row, &date.id, CellValue::Date("2024-02-29".into()))
            .await
            .unwrap();
        storage
            .set_cell(row, &status.id, CellValue::Select("done".into()))
            .await
            .unwrap();

        assert_eq!(
            cells(&storage, &database, 0).await,
            BTreeMap::from([
                (text.id, CellValue::Text("hello".into())),
                (number.id, CellValue::Number(-12.5)),
                (whole.id, CellValue::Number(3.0)),
                (date.id, CellValue::Date("2024-02-29".into())),
                (status.id, CellValue::Select("done".into())),
            ])
        );
    }

    #[tokio::test]
    async fn json_from_the_frontend_round_trips_for_every_type() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["Row"]).await;
        let text = property(&storage, &database, PropertyType::Text).await;
        let number = property(&storage, &database, PropertyType::Number).await;
        let date = property(&storage, &database, PropertyType::Date).await;
        let status = select(&storage, &database).await;
        let row = &rows[0].id;

        for (property, value) in [
            (&text, json!("hello")),
            (&number, json!(42)),
            (&date, json!("2026-11-13")),
            (&status, json!("open")),
        ] {
            storage
                .set_cell_from_json(row, &property.id, &value)
                .await
                .unwrap();
        }

        let listed = &storage.list_rows(&database).await.unwrap()[0];
        assert_eq!(
            serde_json::to_value(&listed.cells).unwrap(),
            json!({
                text.id.as_str(): "hello",
                number.id.as_str(): 42.0,
                date.id.as_str(): "2026-11-13",
                status.id.as_str(): "open",
            })
        );
    }

    #[tokio::test]
    async fn an_empty_text_is_stored_as_it_is() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["Row"]).await;
        let text = property(&storage, &database, PropertyType::Text).await;

        storage
            .set_cell(&rows[0].id, &text.id, CellValue::Text(String::new()))
            .await
            .unwrap();

        assert_eq!(
            cells(&storage, &database, 0).await,
            BTreeMap::from([(text.id, CellValue::Text(String::new()))])
        );
    }

    #[tokio::test]
    async fn writing_a_cell_replaces_its_value_and_leaves_the_others_alone() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["One", "Two"]).await;
        let text = property(&storage, &database, PropertyType::Text).await;
        let number = property(&storage, &database, PropertyType::Number).await;
        storage
            .set_cell(&rows[0].id, &text.id, CellValue::Text("first".into()))
            .await
            .unwrap();
        storage
            .set_cell(&rows[0].id, &number.id, CellValue::Number(1.0))
            .await
            .unwrap();
        storage
            .set_cell(&rows[1].id, &text.id, CellValue::Text("other row".into()))
            .await
            .unwrap();

        storage
            .set_cell(&rows[0].id, &text.id, CellValue::Text("second".into()))
            .await
            .unwrap();

        assert_eq!(
            cells(&storage, &database, 0).await,
            BTreeMap::from([
                (text.id.clone(), CellValue::Text("second".into())),
                (number.id, CellValue::Number(1.0)),
            ])
        );
        assert_eq!(
            cells(&storage, &database, 1).await,
            BTreeMap::from([(text.id, CellValue::Text("other row".into()))])
        );
    }

    #[tokio::test]
    async fn clearing_a_cell_removes_its_key_from_the_record() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["Row"]).await;
        let text = property(&storage, &database, PropertyType::Text).await;
        let number = property(&storage, &database, PropertyType::Number).await;
        let date = property(&storage, &database, PropertyType::Date).await;
        let status = select(&storage, &database).await;
        let row = &rows[0].id;
        storage
            .set_cell(row, &text.id, CellValue::Text("hello".into()))
            .await
            .unwrap();
        storage
            .set_cell(row, &number.id, CellValue::Number(5.0))
            .await
            .unwrap();
        storage
            .set_cell(row, &date.id, CellValue::Date("2026-11-13".into()))
            .await
            .unwrap();
        storage
            .set_cell(row, &status.id, CellValue::Select("open".into()))
            .await
            .unwrap();

        storage
            .set_cell(row, &text.id, CellValue::Empty)
            .await
            .unwrap();
        storage
            .set_cell_from_json(row, &number.id, &Value::Null)
            .await
            .unwrap();

        let stored = props(&storage, row).await.unwrap();
        let keys: Vec<&String> = stored.as_object().unwrap().keys().collect();
        assert!(!keys.contains(&&text.id), "{stored}");
        assert!(!keys.contains(&&number.id), "{stored}");
        assert_eq!(keys.len(), 2, "{stored}");

        storage
            .set_cell(row, &date.id, CellValue::Empty)
            .await
            .unwrap();
        storage
            .set_cell(row, &status.id, CellValue::Empty)
            .await
            .unwrap();
        assert_eq!(props(&storage, row).await, Some(json!({})));
        assert!(cells(&storage, &database, 0).await.is_empty());
    }

    #[tokio::test]
    async fn clearing_an_empty_cell_changes_nothing() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["Row"]).await;
        let text = property(&storage, &database, PropertyType::Text).await;

        storage
            .set_cell(&rows[0].id, &text.id, CellValue::Empty)
            .await
            .unwrap();

        assert!(cells(&storage, &database, 0).await.is_empty());
    }

    #[tokio::test]
    async fn writing_a_cell_updates_the_row() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["Row"]).await;
        let text = property(&storage, &database, PropertyType::Text).await;
        let before = updated_at(&storage, &rows[0].id).await;
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;

        storage
            .set_cell(&rows[0].id, &text.id, CellValue::Text("hello".into()))
            .await
            .unwrap();

        assert!(updated_at(&storage, &rows[0].id).await > before);
    }

    #[tokio::test]
    async fn a_value_of_the_wrong_type_is_refused_for_every_type() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["Row"]).await;
        let text = property(&storage, &database, PropertyType::Text).await;
        let number = property(&storage, &database, PropertyType::Number).await;
        let date = property(&storage, &database, PropertyType::Date).await;
        let status = select(&storage, &database).await;

        let refused = [
            (&text, json!(5)),
            (&text, json!(["a"])),
            (&text, json!(true)),
            (&number, json!("5")),
            (&number, json!("five")),
            (&number, json!(["1"])),
            (&date, json!(20261113)),
            (&date, json!(["2026-11-13"])),
            (&status, json!(3)),
            (&status, json!(["open"])),
        ];
        for (property, value) in refused {
            let error = storage
                .set_cell_from_json(&rows[0].id, &property.id, &value)
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::Invalid(_)), "{value}");
        }

        // The same through the typed API: a value of another type's variant.
        for (property, value) in [
            (&text, CellValue::Number(1.0)),
            (&number, CellValue::Text("1".into())),
            (&date, CellValue::Text("2026-11-13".into())),
            (&status, CellValue::Text("open".into())),
            (&text, CellValue::Select("open".into())),
            (&text, CellValue::Relation(vec![rows[0].id.clone()])),
        ] {
            let error = storage
                .set_cell(&rows[0].id, &property.id, value.clone())
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::Invalid(_)), "{value:?}");
        }
        assert_eq!(props(&storage, &rows[0].id).await, None);
    }

    #[tokio::test]
    async fn a_number_must_be_finite() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["Row"]).await;
        let number = property(&storage, &database, PropertyType::Number).await;

        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let error = storage
                .set_cell(&rows[0].id, &number.id, CellValue::Number(value))
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::Invalid(_)), "{value}");
        }
        assert_eq!(props(&storage, &rows[0].id).await, None);
    }

    #[tokio::test]
    async fn a_date_must_be_a_day_of_the_calendar() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["Row"]).await;
        let date = property(&storage, &database, PropertyType::Date).await;

        for value in [
            "13.11.2026",
            "2026-13-01",
            "2026-00-10",
            "2026-02-30",
            "2026-02-29",
            "1900-02-29",
            "2026-04-31",
            "2026-11-00",
            "2026-1-1",
            "2026-11-13T10:00",
            " 2026-11-13",
            "2026/11/13",
            "+026-11-13",
            "2026-1a-13",
            "",
        ] {
            let error = storage
                .set_cell(&rows[0].id, &date.id, CellValue::Date(value.into()))
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::Invalid(_)), "{value:?}");
        }
        assert_eq!(props(&storage, &rows[0].id).await, None);
    }

    #[test]
    fn calendar_dates_are_recognised() {
        for date in [
            "2026-11-13",
            "2024-02-29",
            "2000-02-29",
            "0001-01-01",
            "9999-12-31",
        ] {
            assert!(is_calendar_date(date), "{date}");
        }
        for date in [
            "2100-02-29",
            "2026-06-31",
            "2026-12-32",
            "20261113",
            "2026-11-13 ",
        ] {
            assert!(!is_calendar_date(date), "{date}");
        }
    }

    #[tokio::test]
    async fn a_select_takes_only_its_own_options() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["Row"]).await;
        let status = select(&storage, &database).await;
        let priority = property(&storage, &database, PropertyType::Select).await;
        let high = [SelectOption {
            id: "high".into(),
            name: "High".into(),
            color: "red".into(),
        }];
        storage
            .update_property(&priority.id, None, Some(&high))
            .await
            .unwrap();

        // An option of another property, a name instead of an id, nothing.
        for value in ["high", "Open", ""] {
            let error = storage
                .set_cell(&rows[0].id, &status.id, CellValue::Select(value.into()))
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::Invalid(_)), "{value:?}");
        }
        assert_eq!(props(&storage, &rows[0].id).await, None);
    }

    #[tokio::test]
    async fn a_page_that_is_no_row_is_refused_as_invalid() {
        let storage = storage().await;
        let (database, _) = database_with_rows(&storage, &["Row"]).await;
        let text = property(&storage, &database, PropertyType::Text).await;
        let page = storage.create_page(None).await.unwrap().id;

        for id in [page.as_str(), database.as_str()] {
            let error = storage
                .set_cell(id, &text.id, CellValue::Text("a".into()))
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::Invalid(_)), "{id}");
            assert_eq!(props(&storage, id).await, None);
        }
    }

    #[tokio::test]
    async fn a_property_of_another_database_is_refused_as_invalid() {
        let storage = storage().await;
        let (database, _) = database_with_rows(&storage, &["Row"]).await;
        let (_, other_rows) = database_with_rows(&storage, &["Other row"]).await;
        let text = property(&storage, &database, PropertyType::Text).await;

        let error = storage
            .set_cell(&other_rows[0].id, &text.id, CellValue::Text("a".into()))
            .await
            .unwrap_err();

        assert!(matches!(error, StorageError::Invalid(_)));
        assert_eq!(props(&storage, &other_rows[0].id).await, None);
    }

    #[tokio::test]
    async fn unknown_rows_and_properties_and_the_title_are_not_found() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["Row"]).await;
        let text = property(&storage, &database, PropertyType::Text).await;
        let value = || CellValue::Text("a".into());

        let unknown_row = storage.set_cell("missing", &text.id, value()).await;
        let unknown_property = storage.set_cell(&rows[0].id, "missing", value()).await;
        let title = storage.set_cell(&rows[0].id, TITLE, value()).await;
        let title_from_json = storage
            .set_cell_from_json(&rows[0].id, TITLE, &json!("a"))
            .await;

        for result in [unknown_row, unknown_property, title, title_from_json] {
            assert!(
                matches!(result, Err(StorageError::NotFound(_))),
                "{result:?}"
            );
        }
        assert_eq!(storage.list_rows(&database).await.unwrap(), rows);
        assert_eq!(props(&storage, &rows[0].id).await, None);
    }

    #[tokio::test]
    async fn relation_cells_are_refused_until_relations_arrive() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["Row", "Other"]).await;
        run_with_pages(
            &storage,
            &[("database", &database)],
            "CREATE property:link SET database = $database, name = 'Link', type = 'relation',
                 target = $database;",
        )
        .await;

        let error = storage
            .set_cell_from_json(&rows[0].id, "link", &json!([rows[1].id]))
            .await
            .unwrap_err();

        assert!(matches!(error, StorageError::Invalid(_)));
        assert_eq!(props(&storage, &rows[0].id).await, None);
    }

    // Readers.

    #[tokio::test]
    async fn readers_skip_values_of_properties_and_options_that_are_gone() {
        let storage = storage().await;
        let (database, rows) = database_with_rows(&storage, &["Row"]).await;
        let text = property(&storage, &database, PropertyType::Text).await;
        let status = select(&storage, &database).await;
        storage
            .set_cell(&rows[0].id, &status.id, CellValue::Select("done".into()))
            .await
            .unwrap();
        storage
            .set_cell(&rows[0].id, &text.id, CellValue::Text("kept".into()))
            .await
            .unwrap();
        // A key of a property that is gone, and an option removed from the list.
        run_with_pages(
            &storage,
            &[("row", &rows[0].id)],
            "UPDATE $row SET props.deleted = 'left behind';",
        )
        .await;
        let open = [SelectOption {
            id: "open".into(),
            name: "Open".into(),
            color: "green".into(),
        }];
        storage
            .update_property(&status.id, None, Some(&open))
            .await
            .unwrap();

        assert_eq!(
            cells(&storage, &database, 0).await,
            BTreeMap::from([(text.id, CellValue::Text("kept".into()))])
        );
    }

    #[tokio::test]
    async fn readers_skip_stored_values_that_do_not_fit_the_type() {
        let storage = storage().await;
        let database = storage.create_database(None).await.unwrap().page.id;
        run_with_pages(
            &storage,
            &[("database", &database)],
            "CREATE property:notes SET database = $database, name = 'Notes', type = 'text';
             CREATE property:amount SET database = $database, name = 'Amount', type = 'number',
                 position = 1.0;
             CREATE property:due SET database = $database, name = 'Due', type = 'date',
                 position = 2.0;
             CREATE property:link SET database = $database, name = 'Link', type = 'relation',
                 position = 3.0, target = $database;
             CREATE page:row SET title = 'Row', parent = $database, database = $database,
                 props = { notes: 5, amount: 'five', due: '2026-02-30', link: ['row'] };
             CREATE page:fine SET title = 'Fine', parent = $database, database = $database,
                 position = 1.0, props = { notes: 'text', amount: 7, due: '2026-02-28' };",
        )
        .await;

        let rows = storage.list_rows(&database).await.unwrap();

        assert!(rows[0].cells.is_empty(), "{:?}", rows[0].cells);
        assert_eq!(
            rows[1].cells,
            BTreeMap::from([
                ("notes".to_owned(), CellValue::Text("text".into())),
                ("amount".to_owned(), CellValue::Number(7.0)),
                ("due".to_owned(), CellValue::Date("2026-02-28".into())),
            ])
        );
    }
}
