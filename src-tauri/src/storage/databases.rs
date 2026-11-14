//! The database repository.
//!
//! A database is a page of the kind `database`. Its rows are the pages below
//! it, its columns are `property` records. Renaming, moving and deleting the
//! page itself is the page repository's job.

use surrealdb::types::SurrealValue;

use super::{Storage, StorageError};
use crate::domain::{Database, PageKind, Property, PropertyType, SelectOption, ViewConfig};

/// The name of the view a new database starts with.
const FIRST_VIEW_NAME: &str = "Table";

#[derive(SurrealValue)]
struct OptionRow {
    id: String,
    name: String,
    color: String,
}

#[derive(SurrealValue)]
struct PropertyRow {
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
}

#[cfg(test)]
mod tests {
    use super::super::tests::run_with_pages;
    use super::*;

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
