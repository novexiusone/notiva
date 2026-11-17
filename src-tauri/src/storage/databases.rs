//! The database repository.
//!
//! A database is a page of the kind `database`. Its rows are the pages below
//! it, its columns are `property` records. Renaming, moving and deleting the
//! page itself is the page repository's job.

use surrealdb::types::{RecordId, SurrealValue};

use super::{Storage, StorageError};
use crate::domain::{Database, PageKind, Property, PropertyType, SelectOption, ViewConfig};

/// The name of the view a new database starts with.
const FIRST_VIEW_NAME: &str = "Table";

/// How many rows of a database one transaction deletes. The transaction
/// does the cascade with set-based statements (see `CHUNK_DELETE`).
///
/// Measured on disk in the benchmark profile with 10,000 rows, seven
/// properties and three blocks per row, on a machine that was busy with
/// other work (#83): in one transaction 5.3 s, in chunks of 2,500 rows 5.2 s,
/// of 1,000 rows 14 s, of 500 rows 18 s, of 50 rows 47 s. Every chunk costs
/// more than its rows, so small chunks are slow. 2,500 rows stay at about a
/// second per transaction on a quiet machine.
pub(super) const ROW_CHUNK: usize = 2500;

/// Deletes the rows `$rows` of a database. The rows with subpages go through the delete events, which delete
/// the subpages with their own cascade. The others are deleted with the
/// cascade done here for all of them at once, and `$cascade_done` tells the
/// events (migration 11) to do nothing for them. The cascade is that of the
/// event `page_deleted`: blocks, and the links of the pages and of their
/// blocks. A row is no database and no database's target, so it has no
/// properties and no views.
const CHUNK_DELETE: &str = "BEGIN TRANSACTION;
    LET $parents = array::distinct((SELECT VALUE parent FROM page WHERE parent IN $rows));
    LET $plain = array::complement($rows, $parents);
    LET $blocks = (SELECT VALUE id FROM block WHERE page IN $plain);
    DELETE (SELECT VALUE id FROM links_to WHERE block IN $blocks) RETURN NONE;
    DELETE (SELECT VALUE id FROM links_to WHERE in IN $plain) RETURN NONE;
    DELETE (SELECT VALUE id FROM links_to WHERE out IN $plain) RETURN NONE;
    LET $cascade_done = true;
    DELETE $blocks RETURN NONE;
    DELETE $plain RETURN NONE;
    LET $cascade_done = false;
    DELETE $parents RETURN NONE;
    COMMIT TRANSACTION;";

/// A page found while walking down the tree, and whether it is a database.
#[derive(SurrealValue)]
struct TreeNode {
    id: RecordId,
    database: bool,
}

#[derive(SurrealValue)]
struct OptionRow {
    id: String,
    name: String,
    color: String,
}

#[derive(SurrealValue)]
pub(super) struct PropertyRow {
    id: String,
    database_id: String,
    name: String,
    kind: String,
    position: f64,
    options: Vec<OptionRow>,
    target_id: Option<String>,
}

impl TryFrom<PropertyRow> for Property {
    type Error = StorageError;

    fn try_from(row: PropertyRow) -> Result<Self, Self::Error> {
        let kind = PropertyType::from_name(&row.kind).ok_or_else(|| {
            StorageError::Database(format!(
                "property {} has the unknown type {}",
                row.id, row.kind
            ))
        })?;

        Ok(Self {
            id: row.id,
            database_id: row.database_id,
            name: row.name,
            kind,
            position: row.position,
            options: row
                .options
                .into_iter()
                .map(|option| SelectOption {
                    id: option.id,
                    name: option.name,
                    color: option.color,
                })
                .collect(),
            target_id: row.target_id,
        })
    }
}

fn not_found(id: &str) -> StorageError {
    StorageError::NotFound(format!("database {id}"))
}

impl Storage {
    /// Creates an untitled database after the last child of `parent_id`. It
    /// starts without properties: the title column is the title of its rows.
    /// It has one table view, because a database always has at least one.
    pub async fn create_database(&self, parent_id: Option<&str>) -> Result<Database, StorageError> {
        let page = self.insert_page(parent_id, PageKind::Database).await?;
        let view = match self
            .insert_view(&page.id, FIRST_VIEW_NAME, &ViewConfig::empty_table())
            .await
        {
            Ok(view) => view,
            Err(error) => {
                // A database without a view must not stay behind.
                let _ = self.delete_page(&page.id).await;
                return Err(error);
            }
        };

        Ok(Database {
            page,
            properties: Vec::new(),
            views: vec![view],
        })
    }

    /// A database with its properties in column order and its views in
    /// order. An id that belongs to an ordinary page is not found.
    pub async fn load_database(&self, id: &str) -> Result<Database, StorageError> {
        let page = self
            .find_page(id)
            .await?
            .filter(|page| page.kind == PageKind::Database)
            .ok_or_else(|| not_found(id))?;

        let rows: Vec<PropertyRow> = self
            .db
            .query(
                "LET $database = type::record('page', $id);
                 SELECT record::id(id) AS id, record::id(database) AS database_id, name,
                     type AS kind, position, options,
                     IF target = NONE { NONE } ELSE { record::id(target) } AS target_id
                     FROM property WHERE database = $database ORDER BY position;",
            )
            .bind(("id", id.to_owned()))
            .await?
            .check()?
            .take(1)?;
        let properties = rows
            .into_iter()
            .map(Property::try_from)
            .collect::<Result<_, _>>()?;

        Ok(Database {
            page,
            properties,
            views: self.list_views(id).await?,
        })
    }

    /// Deletes the rows of every database at or below the page `id`, `chunk`
    /// rows per transaction, before the page itself is deleted. Databases
    /// deeper in the tree go first, so that deleting a row never takes a
    /// whole database below it along in one transaction.
    ///
    /// This is not atomic: if it stops half-way, a database is left with
    /// fewer rows, which is still a valid database.
    pub(super) async fn delete_database_rows(
        &self,
        id: &str,
        chunk: usize,
    ) -> Result<(), StorageError> {
        let root: Option<TreeNode> = self
            .db
            .query("SELECT id, kind = 'database' AS database FROM ONLY type::record('page', $id)")
            .bind(("id", id.to_owned()))
            .await?
            .check()?
            .take(0)?;

        // Walk down one level per query through the parent index. A later
        // level is deeper, so the databases end up ordered by depth.
        let mut databases = Vec::new();
        let mut level: Vec<TreeNode> = root.into_iter().collect();
        while !level.is_empty() {
            let mut parents = Vec::with_capacity(level.len());
            for node in level {
                if node.database {
                    databases.push(node.id.clone());
                }
                parents.push(node.id);
            }
            level = self
                .db
                .query(
                    "LET $parents = $ids;
                     SELECT id, kind = 'database' AS database FROM page WHERE parent IN $parents;",
                )
                .bind(("ids", parents))
                .await?
                .check()?
                .take(1)?;
        }

        // The ids of the rows are read once and deleted in slices. Asking for
        // the first rows again after every chunk would read past the entries
        // of the rows just deleted, which makes the delete slower with every
        // chunk. Rows added meanwhile are found by the next pass.
        for database in databases.into_iter().rev() {
            loop {
                let rows: Vec<RecordId> = self
                    .db
                    .query("SELECT VALUE id FROM page WHERE database = $record")
                    .bind(("record", database.clone()))
                    .await?
                    .check()?
                    .take(0)?;
                if rows.is_empty() {
                    break;
                }
                for slice in rows.chunks(chunk.max(1)) {
                    self.db
                        .query(CHUNK_DELETE)
                        .bind(("rows", slice.to_vec()))
                        .await?
                        .check()?;
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::run_with_pages;
    use super::*;
    use crate::domain::{Block, CellValue};

    async fn storage() -> Storage {
        Storage::open_in_memory().await.unwrap()
    }

    #[tokio::test]
    async fn a_new_database_is_an_untitled_page_without_properties() {
        let storage = storage().await;

        let database = storage.create_database(None).await.unwrap();

        assert_eq!(database.page.kind, PageKind::Database);
        assert_eq!(database.page.title, "");
        assert_eq!(database.page.parent_id, None);
        assert_eq!(database.page.database_id, None);
        assert!(database.properties.is_empty());
        assert_eq!(storage.list_pages().await.unwrap(), [database.page]);
    }

    #[tokio::test]
    async fn a_new_database_comes_after_its_last_sibling() {
        let storage = storage().await;
        let parent = storage.create_page(None).await.unwrap();
        let sibling = storage.create_page(Some(&parent.id)).await.unwrap();

        let database = storage.create_database(Some(&parent.id)).await.unwrap();
        let top_level = storage.create_database(None).await.unwrap();

        assert_eq!(database.page.parent_id.as_deref(), Some(parent.id.as_str()));
        assert!(database.page.position > sibling.position);
        assert!(top_level.page.position > parent.position);
    }

    #[tokio::test]
    async fn creating_a_database_below_an_unknown_page_fails() {
        let storage = storage().await;

        let error = storage.create_database(Some("missing")).await.unwrap_err();

        assert!(matches!(error, StorageError::NotFound(_)));
        assert!(storage.list_pages().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_database_cannot_be_created_inside_a_database() {
        let storage = storage().await;
        let outer = storage.create_database(None).await.unwrap().page;

        let error = storage.create_database(Some(&outer.id)).await.unwrap_err();

        assert!(matches!(error, StorageError::Invalid(_)));
        assert_eq!(storage.list_pages().await.unwrap(), [outer]);
    }

    #[tokio::test]
    async fn loading_returns_the_page_and_its_properties_in_column_order() {
        let storage = storage().await;
        let authors = storage.create_database(None).await.unwrap().page;
        let books = storage.create_database(None).await.unwrap().page;
        storage.rename_page(&books.id, "Books").await.unwrap();
        run_with_pages(
            &storage,
            &[("authors", &authors.id), ("books", &books.id)],
            "CREATE property:born SET database = $authors, name = 'Born', type = 'date';
             CREATE property:author SET database = $books, name = 'Author', type = 'relation',
                 position = 2.0, target = $authors;
             CREATE property:status SET database = $books, name = 'Status', type = 'select',
                 position = 0.5, options = [
                     { id: 'open', name: 'Open', color: 'blue' },
                     { id: 'read', name: 'Read', color: 'green' },
                 ];
             CREATE property:pages SET database = $books, name = 'Pages', type = 'number',
                 position = 1.0;",
        )
        .await;

        let loaded = storage.load_database(&books.id).await.unwrap();

        assert_eq!(loaded.page.id, books.id);
        assert_eq!(loaded.page.title, "Books");
        assert_eq!(loaded.page.kind, PageKind::Database);
        assert_eq!(
            loaded.properties,
            [
                Property {
                    id: "status".into(),
                    database_id: books.id.clone(),
                    name: "Status".into(),
                    kind: PropertyType::Select,
                    position: 0.5,
                    options: vec![
                        SelectOption {
                            id: "open".into(),
                            name: "Open".into(),
                            color: "blue".into(),
                        },
                        SelectOption {
                            id: "read".into(),
                            name: "Read".into(),
                            color: "green".into(),
                        },
                    ],
                    target_id: None,
                },
                Property {
                    id: "pages".into(),
                    database_id: books.id.clone(),
                    name: "Pages".into(),
                    kind: PropertyType::Number,
                    position: 1.0,
                    options: Vec::new(),
                    target_id: None,
                },
                Property {
                    id: "author".into(),
                    database_id: books.id.clone(),
                    name: "Author".into(),
                    kind: PropertyType::Relation,
                    position: 2.0,
                    options: Vec::new(),
                    target_id: Some(authors.id.clone()),
                },
            ]
        );
        assert_eq!(loaded.views.len(), 1);
        assert_eq!(
            storage
                .load_database(&authors.id)
                .await
                .unwrap()
                .properties
                .len(),
            1,
            "a database only gets its own properties"
        );
    }

    #[tokio::test]
    async fn loading_an_ordinary_page_as_a_database_fails_with_not_found() {
        let storage = storage().await;
        let page = storage.create_page(None).await.unwrap();

        let error = storage.load_database(&page.id).await.unwrap_err();

        assert!(matches!(error, StorageError::NotFound(_)));
    }

    #[tokio::test]
    async fn loading_an_unknown_database_fails_with_not_found() {
        let storage = storage().await;

        let error = storage.load_database("missing").await.unwrap_err();

        assert!(matches!(error, StorageError::NotFound(_)));
    }

    // Deleting databases.

    async fn count(storage: &Storage, table: &str) -> i64 {
        let count: Option<i64> = storage
            .db
            .query(format!("RETURN count(SELECT * FROM {table})"))
            .await
            .unwrap()
            .take(0)
            .unwrap();
        count.unwrap()
    }

    fn paragraph(id: &str) -> Block {
        Block {
            id: id.into(),
            kind: "paragraph".into(),
            props: serde_json::Map::new(),
            content: Some(serde_json::json!([{ "type": "text", "text": id, "styles": {} }])),
            children: Vec::new(),
        }
    }

    /// A database below `parent` with a text property, a second view and
    /// `rows` rows that each have a cell and a block.
    async fn filled_database(storage: &Storage, parent: Option<&str>, rows: usize) -> Database {
        let database = storage.create_database(parent).await.unwrap();
        let notes = storage
            .create_property(&database.page.id, "Notes", PropertyType::Text, None)
            .await
            .unwrap();
        storage
            .create_view(&database.page.id, "Board", &ViewConfig::empty_table())
            .await
            .unwrap();
        for index in 0..rows {
            let row = storage.create_row(&database.page.id).await.unwrap();
            storage
                .set_cell(&row.id, &notes.id, CellValue::Text(format!("row {index}")))
                .await
                .unwrap();
            storage
                .save_blocks(
                    &row.id,
                    &[paragraph(&format!("{}-{index}", database.page.id))],
                )
                .await
                .unwrap();
        }
        storage.load_database(&database.page.id).await.unwrap()
    }

    async fn page_ids(storage: &Storage) -> Vec<String> {
        let mut ids: Vec<String> = storage
            .list_pages()
            .await
            .unwrap()
            .into_iter()
            .map(|page| page.id)
            .collect();
        ids.sort();
        ids
    }

    #[tokio::test]
    async fn deleting_a_database_removes_its_rows_their_blocks_its_properties_and_views() {
        let storage = storage().await;
        let kept = filled_database(&storage, None, 2).await;
        let database = filled_database(&storage, None, 3).await;
        assert_eq!(count(&storage, "block").await, 5);

        storage.delete_page(&database.page.id).await.unwrap();

        let mut expected = vec![kept.page.id.clone()];
        expected.extend(
            storage
                .list_rows(&kept.page.id)
                .await
                .unwrap()
                .into_iter()
                .map(|row| row.id),
        );
        expected.sort();
        assert_eq!(page_ids(&storage).await, expected);
        assert_eq!(count(&storage, "block").await, 2);
        assert_eq!(count(&storage, "property").await, 1);
        assert_eq!(count(&storage, "view").await, 2);
        assert_eq!(storage.load_database(&kept.page.id).await.unwrap(), kept);
    }

    #[tokio::test]
    async fn deleting_a_page_removes_the_rows_of_databases_anywhere_below_it() {
        let storage = storage().await;
        let top = storage.create_page(None).await.unwrap().id;
        let middle = storage.create_page(Some(&top)).await.unwrap().id;
        filled_database(&storage, Some(&top), 2).await;
        filled_database(&storage, Some(&middle), 3).await;
        let other = storage.create_page(None).await.unwrap().id;

        storage.delete_page(&top).await.unwrap();

        assert_eq!(page_ids(&storage).await, [other]);
        assert_eq!(count(&storage, "block").await, 0);
        assert_eq!(count(&storage, "property").await, 0);
        assert_eq!(count(&storage, "view").await, 0);
    }

    #[tokio::test]
    async fn deleting_a_row_removes_a_database_below_it_with_its_rows() {
        let storage = storage().await;
        let outer = filled_database(&storage, None, 2).await;
        let rows = storage.list_rows(&outer.page.id).await.unwrap();
        let inner = filled_database(&storage, Some(&rows[0].id), 3).await;
        // A database below a page below the row.
        let below_row = storage.create_page(Some(&rows[0].id)).await.unwrap().id;
        filled_database(&storage, Some(&below_row), 2).await;

        storage.delete_page(&rows[0].id).await.unwrap();

        let mut expected = vec![outer.page.id.clone(), rows[1].id.clone()];
        expected.sort();
        assert_eq!(page_ids(&storage).await, expected);
        assert!(storage.load_database(&inner.page.id).await.is_err());
        assert_eq!(count(&storage, "block").await, 1);
        assert_eq!(count(&storage, "property").await, 1);
        assert_eq!(count(&storage, "view").await, 2);
    }

    #[tokio::test]
    async fn rows_are_deleted_in_chunks_and_leave_a_valid_database_between_them() {
        let storage = storage().await;
        let database = filled_database(&storage, None, 5).await;
        let id = &database.page.id;

        // Chunks of two rows: three transactions for five rows.
        storage.delete_database_rows(id, 2).await.unwrap();

        assert!(storage.list_rows(id).await.unwrap().is_empty());
        assert_eq!(page_ids(&storage).await, std::slice::from_ref(id));
        assert_eq!(count(&storage, "block").await, 0);
        let loaded = storage.load_database(id).await.unwrap();
        assert_eq!(loaded.properties, database.properties);
        assert_eq!(loaded.views, database.views);

        storage.delete_page(id).await.unwrap();
        assert!(page_ids(&storage).await.is_empty());
        assert_eq!(count(&storage, "property").await, 0);
        assert_eq!(count(&storage, "view").await, 0);
    }

    #[tokio::test]
    async fn chunks_that_divide_the_rows_evenly_delete_them_all() {
        let storage = storage().await;
        let top = storage.create_page(None).await.unwrap().id;
        let outer = filled_database(&storage, Some(&top), 4).await;
        let row = storage.list_rows(&outer.page.id).await.unwrap().remove(0);
        let inner = filled_database(&storage, Some(&row.id), 6).await;

        storage.delete_database_rows(&top, 2).await.unwrap();

        assert!(storage.list_rows(&outer.page.id).await.unwrap().is_empty());
        // The inner database went with its row, after its own rows were gone.
        assert!(storage.load_database(&inner.page.id).await.is_err());
        let mut expected = vec![top.clone(), outer.page.id.clone()];
        expected.sort();
        assert_eq!(page_ids(&storage).await, expected);
        assert_eq!(count(&storage, "block").await, 0);
    }

    async fn link(storage: &Storage, from: &str, to: &str, block: &str) {
        storage
            .db
            .query(format!(
                "RELATE page:`{from}`->links_to->page:`{to}` SET block = block:`{block}`;"
            ))
            .await
            .unwrap()
            .check()
            .unwrap();
    }

    /// The set-based delete of a chunk does what the delete events do: it
    /// removes the blocks with their children, the links of the rows and of
    /// their blocks, and the subpages of a row, and it keeps what belongs to
    /// other pages. Rows with and without subpages share a chunk.
    #[tokio::test]
    async fn a_chunk_delete_cascades_like_the_events_do() {
        let storage = storage().await;
        let database = filled_database(&storage, None, 5).await;
        let rows = storage.list_rows(&database.page.id).await.unwrap();
        let other = storage.create_page(None).await.unwrap().id;
        let kept = filled_database(&storage, None, 1).await;
        let kept_row = storage.list_rows(&kept.page.id).await.unwrap().remove(0).id;

        // A block with a child block in every row.
        for row in &rows {
            let mut parent = paragraph(&format!("parent-{}", row.id));
            parent.children = vec![paragraph(&format!("child-{}", row.id))];
            let mut blocks = storage.load_blocks(&row.id).await.unwrap();
            blocks.push(parent);
            storage.save_blocks(&row.id, &blocks).await.unwrap();
        }
        // A subpage with a block below the second row.
        let subpage = storage.create_page(Some(&rows[1].id)).await.unwrap().id;
        storage
            .save_blocks(&subpage, &[paragraph("sub")])
            .await
            .unwrap();
        link(&storage, &subpage, &other, "sub").await;
        // Links from the blocks of rows, to a row, and between pages that stay.
        link(
            &storage,
            &rows[0].id,
            &other,
            &format!("child-{}", rows[0].id),
        )
        .await;
        link(
            &storage,
            &other,
            &rows[3].id,
            &format!("{}-0", kept.page.id),
        )
        .await;
        link(&storage, &kept_row, &other, &format!("{}-0", kept.page.id)).await;
        assert_eq!(count(&storage, "links_to").await, 4);
        assert_eq!(count(&storage, "block").await, 5 + 10 + 1 + 1);

        storage
            .delete_database_rows(&database.page.id, 3)
            .await
            .unwrap();

        assert!(
            storage
                .list_rows(&database.page.id)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(count(&storage, "block").await, 1);
        assert_eq!(count(&storage, "links_to").await, 1);
        let mut expected = vec![
            database.page.id.clone(),
            other.clone(),
            kept.page.id.clone(),
            kept_row,
        ];
        expected.sort();
        assert_eq!(page_ids(&storage).await, expected);

        // The events work again afterwards in the same connection.
        let page = storage.create_page(None).await.unwrap().id;
        storage
            .save_blocks(&page, &[paragraph("after")])
            .await
            .unwrap();
        link(&storage, &page, &other, "after").await;
        storage.delete_page(&page).await.unwrap();
        assert_eq!(count(&storage, "block").await, 1);
        assert_eq!(count(&storage, "links_to").await, 1);
    }

    #[tokio::test]
    async fn a_page_without_databases_loses_no_rows_before_it_is_deleted() {
        let storage = storage().await;
        let page = storage.create_page(None).await.unwrap().id;
        storage.create_page(Some(&page)).await.unwrap();
        let elsewhere = filled_database(&storage, None, 2).await;

        storage.delete_database_rows(&page, 1).await.unwrap();

        assert_eq!(page_ids(&storage).await.len(), 5);
        assert_eq!(
            storage.list_rows(&elsewhere.page.id).await.unwrap().len(),
            2
        );
    }

    #[tokio::test]
    async fn loading_a_row_as_a_database_fails_with_not_found() {
        let storage = storage().await;
        let database = storage.create_database(None).await.unwrap().page;
        run_with_pages(
            &storage,
            &[("database", &database.id)],
            "CREATE page:row SET title = 'Row', parent = $database, database = $database;",
        )
        .await;

        let error = storage.load_database("row").await.unwrap_err();

        assert!(matches!(error, StorageError::NotFound(_)));
    }
}
