//! Relation cells: the rows a cell of a relation property points at.
//!
//! A cell is one `row_link` edge per linked row, from the row that holds the
//! cell to the row it points at. The edge carries the property and the
//! position of the row in the cell. Edges are never stored in `page.props`.

use std::collections::{BTreeMap, HashMap, HashSet};

use surrealdb::types::SurrealValue;

use super::databases::PropertyRow;
use super::properties::PROPERTY_FIELDS;
use super::{Storage, StorageError};
use crate::domain::{CellValue, IncomingRelation, PageRef, Property, PropertyType};

#[derive(SurrealValue)]
struct EdgeRow {
    row: String,
    target: String,
}

#[derive(SurrealValue)]
struct IncomingRow {
    id: String,
    title: String,
    property: String,
    position: f64,
}

impl Storage {
    /// The relation cells of the rows of a database, by row id and property
    /// id: one query per relation property, whatever the number of rows.
    /// Targets keep the order they were added in.
    pub(super) async fn read_relation_cells(
        &self,
        properties: &[Property],
    ) -> Result<HashMap<String, BTreeMap<String, CellValue>>, StorageError> {
        let mut cells: HashMap<String, BTreeMap<String, CellValue>> = HashMap::new();
        for property in properties
            .iter()
            .filter(|property| property.kind == PropertyType::Relation)
        {
            let edges: Vec<EdgeRow> = self
                .db
                .query(
                    "SELECT record::id(in) AS row, record::id(out) AS target FROM row_link
                         WHERE property = type::record('property', $property)
                         ORDER BY position, id;",
                )
                .bind(("property", property.id.clone()))
                .await?
                .check()?
                .take(0)?;

            let mut by_row: HashMap<String, Vec<String>> = HashMap::new();
            for edge in edges {
                by_row.entry(edge.row).or_default().push(edge.target);
            }
            for (row, targets) in by_row {
                cells
                    .entry(row)
                    .or_default()
                    .insert(property.id.clone(), CellValue::Relation(targets));
            }
        }
        Ok(cells)
    }

    /// Replaces the rows a relation cell points at. Every id has to be a row
    /// of the target database and may appear once.
    pub(super) async fn write_relation(
        &self,
        row_id: &str,
        property: &Property,
        targets: &[String],
    ) -> Result<(), StorageError> {
        let Some(target_database) = &property.target_id else {
            return Err(StorageError::Database(format!(
                "relation {} has no target database",
                property.id
            )));
        };
        let mut seen = HashSet::new();
        if !targets.iter().all(|target| seen.insert(target)) {
            return Err(StorageError::Invalid(
                "a relation cell holds a row only once".into(),
            ));
        }

        if !targets.is_empty() {
            let found: Vec<String> = self
                .db
                .query(
                    "LET $records = $ids.map(|$id| type::record('page', $id));
                     SELECT VALUE record::id(id) FROM page
                         WHERE id IN $records AND database = type::record('page', $database);",
                )
                .bind(("database", target_database.clone()))
                .bind(("ids", targets.to_vec()))
                .await?
                .check()?
                .take(1)?;
            if found.len() != targets.len() {
                return Err(StorageError::Invalid(
                    "a relation cell takes rows of the target database".into(),
                ));
            }
        }

        let edges: Vec<serde_json::Value> = targets
            .iter()
            .enumerate()
            .map(|(position, id)| serde_json::json!({ "id": id, "position": position as f64 }))
            .collect();
        self.db
            .query(
                "BEGIN TRANSACTION;
                 {GUARD}
                 LET $row = type::record('page', $row_id);
                 LET $property = type::record('property', $property_id);
                 DELETE row_link WHERE in = $row AND property = $property;
                 FOR $edge IN $edges {
                     RELATE $row->row_link->(type::record('page', $edge.id))
                         SET property = $property, position = <float> $edge.position
                         RETURN NONE;
                 };
                 UPDATE ONLY $row SET updated_at = time::now() RETURN NONE;
                 COMMIT TRANSACTION;"
                    .replace("{GUARD}", super::pages::guard_cells_sql()),
            )
            .bind(("id", row_id.to_owned()))
            .bind(("row_id", row_id.to_owned()))
            .bind(("property_id", property.id.clone()))
            .bind(("edges", edges))
            .await?
            .check()?;
        Ok(())
    }

    /// The rows that point at a row, grouped by relation property in the
    /// order of the properties. Rows are in the manual order of their
    /// database. Groups without rows are left out.
    pub async fn list_incoming_relations(
        &self,
        row_id: &str,
    ) -> Result<Vec<IncomingRelation>, StorageError> {
        let row = self
            .find_page(row_id)
            .await?
            .ok_or_else(|| StorageError::NotFound(format!("page {row_id}")))?;
        if row.database_id.is_none() {
            return Err(StorageError::Invalid(format!(
                "page {row_id} is not a row of a database"
            )));
        }

        let mut incoming: Vec<IncomingRow> = self
            .db
            .query(
                "SELECT record::id(in) AS id, in.title AS title, record::id(property) AS property,
                     in.position AS position
                     FROM row_link WHERE out = type::record('page', $id);",
            )
            .bind(("id", row_id.to_owned()))
            .await?
            .check()?
            .take(0)?;
        // A property belongs to one database, so the position orders each group.
        incoming.sort_by(|a, b| a.position.total_cmp(&b.position));
        if incoming.is_empty() {
            return Ok(Vec::new());
        }

        let ids: Vec<String> = incoming
            .iter()
            .map(|edge| edge.property.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let properties: Vec<PropertyRow> = self
            .db
            .query(format!(
                "SELECT {PROPERTY_FIELDS} FROM property
                     WHERE id IN $ids.map(|$id| type::record('property', $id))
                     ORDER BY position;"
            ))
            .bind(("ids", ids))
            .await?
            .check()?
            .take(0)?;
        let properties = properties
            .into_iter()
            .map(Property::try_from)
            .collect::<Result<Vec<_>, _>>()?;

        Ok(properties
            .into_iter()
            .map(|property| {
                let rows = incoming
                    .iter()
                    .filter(|edge| edge.property == property.id)
                    .map(|edge| PageRef {
                        id: edge.id.clone(),
                        title: edge.title.clone(),
                    })
                    .collect::<Vec<_>>();
                IncomingRelation { property, rows }
            })
            .filter(|group| !group.rows.is_empty())
            .collect())
    }
}
