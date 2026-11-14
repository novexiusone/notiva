//! The view repository.
//!
//! A view belongs to one database and is ordered by `position`. Its
//! configuration is stored as the JSON the frontend uses and parsed strictly
//! when it is read.

use serde_json::Value;
use surrealdb::types::SurrealValue;

use super::{Storage, StorageError};
use crate::domain::{PageKind, View, ViewConfig};

/// Selects a view with its ids as plain strings.
const VIEW_FIELDS: &str =
    "record::id(id) AS id, record::id(database) AS database_id, name, position, config";

#[derive(SurrealValue)]
struct ViewRow {
    id: String,
    database_id: String,
    name: String,
    position: f64,
    config: Value,
}

impl TryFrom<ViewRow> for View {
    type Error = StorageError;

    fn try_from(row: ViewRow) -> Result<Self, Self::Error> {
        let config = ViewConfig::from_json(row.config).map_err(|error| {
            StorageError::Database(format!(
                "view {} has a configuration that cannot be read: {error}",
                row.id
            ))
        })?;

        Ok(Self {
            id: row.id,
            database_id: row.database_id,
            name: row.name,
            position: row.position,
            config,
        })
    }
}

fn not_found(id: &str) -> StorageError {
    StorageError::NotFound(format!("view {id}"))
}

impl Storage {
    /// Adds a view after the last view of a database. An id that belongs to
    /// an ordinary page is not found.
    pub async fn create_view(
        &self,
        database_id: &str,
        name: &str,
        config: &ViewConfig,
    ) -> Result<View, StorageError> {
        let is_database = self
            .find_page(database_id)
            .await?
            .is_some_and(|page| page.kind == PageKind::Database);
        if !is_database {
            return Err(StorageError::NotFound(format!("database {database_id}")));
        }

        self.insert_view(database_id, name, config).await
    }

    /// Changes the name, the configuration or both. `None` keeps the current
    /// value.
    pub async fn update_view(
        &self,
        id: &str,
        name: Option<&str>,
        config: Option<&ViewConfig>,
    ) -> Result<View, StorageError> {
        let row: Option<ViewRow> = self
            .db
            .query(format!(
                "UPDATE type::record('view', $id) SET name = $name ?? name, config = $config ?? config
                     WHERE id != NONE RETURN {VIEW_FIELDS}"
            ))
            .bind(("id", id.to_owned()))
            .bind(("name", name.map(str::to_owned)))
            .bind(("config", config.map(ViewConfig::to_json)))
            .await?
            .check()?
            .take(0)?;

        row.ok_or_else(|| not_found(id))?.try_into()
    }

    /// Deletes a view. A database keeps at least one view, so its last view
    /// cannot be deleted.
    pub async fn delete_view(&self, id: &str) -> Result<(), StorageError> {
        let mut response = self
            .db
            .query(
                "BEGIN TRANSACTION;
                 LET $view = type::record('view', $id);
                 LET $database = (SELECT VALUE database FROM ONLY $view);
                 LET $count = IF $database = NONE { 0 } ELSE {
                     count(SELECT VALUE id FROM view WHERE database = $database)
                 };
                 IF $count > 1 { DELETE $view; };
                 RETURN { found: $database != NONE, count: $count };
                 COMMIT TRANSACTION;",
            )
            .bind(("id", id.to_owned()))
            .await?
            .check()?;
        let outcome: Option<DeleteOutcome> = response.take(5)?;
        let outcome = outcome
            .ok_or_else(|| StorageError::Database("deleting a view returned nothing".into()))?;

        if !outcome.found {
            Err(not_found(id))
        } else if outcome.count <= 1 {
            Err(StorageError::Invalid(
                "the last view of a database cannot be deleted".into(),
            ))
        } else {
            Ok(())
        }
    }

    /// The views of a database, ordered by position.
    pub(super) async fn list_views(&self, database_id: &str) -> Result<Vec<View>, StorageError> {
        let rows: Vec<ViewRow> = self
            .db
            .query(format!(
                "LET $database = type::record('page', $database_id);
                 SELECT {VIEW_FIELDS} FROM view WHERE database = $database ORDER BY position;"
            ))
            .bind(("database_id", database_id.to_owned()))
            .await?
            .check()?
            .take(1)?;

        rows.into_iter().map(View::try_from).collect()
    }

    /// Writes a view after the last view of a database, which must exist.
    pub(super) async fn insert_view(
        &self,
        database_id: &str,
        name: &str,
        config: &ViewConfig,
    ) -> Result<View, StorageError> {
        let row: Option<ViewRow> = self
            .db
            .query(format!(
                "LET $database = type::record('page', $database_id);
                 LET $last = (SELECT VALUE position FROM view WHERE database = $database
                     ORDER BY position DESC LIMIT 1)[0];
                 CREATE view SET database = $database, name = $name,
                     position = ($last ?? -1.0) + 1.0, config = $config
                     RETURN {VIEW_FIELDS};"
            ))
            .bind(("database_id", database_id.to_owned()))
            .bind(("name", name.to_owned()))
            .bind(("config", config.to_json()))
            .await?
            .check()?
            .take(2)?;

        row.ok_or_else(|| StorageError::Database("the created view was not returned".into()))?
            .try_into()
    }
}

#[derive(SurrealValue)]
struct DeleteOutcome {
    found: bool,
    count: i64,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::tests::run_with_pages;
    use super::*;

    async fn storage() -> Storage {
        Storage::open_in_memory().await.unwrap()
    }

    fn config(value: Value) -> ViewConfig {
        ViewConfig::from_json(value).unwrap()
    }

    fn table() -> Value {
        json!({
            "version": 1,
            "type": "table",
            "filters": [
                { "propertyId": "status", "operator": "equals", "value": "open" },
                { "propertyId": "pages", "operator": "greaterThan", "value": 300 },
                { "propertyId": "rating", "operator": "lessThan", "value": 4.5 },
                { "propertyId": "due", "operator": "isNotEmpty", "value": null },
            ],
            "sorts": [{ "propertyId": "title", "direction": "desc" }],
            "properties": [
                { "propertyId": "title", "visible": true, "width": 240 },
                { "propertyId": "pages", "visible": false, "width": 80.5 },
                { "propertyId": "status", "visible": true, "width": null },
            ],
            "groupBy": { "propertyId": "status", "collapsed": ["open", ""] },
        })
    }

    fn kanban() -> Value {
        json!({
            "version": 1,
            "type": "kanban",
            "filters": [{ "propertyId": "title", "operator": "notContains", "value": "draft" }],
            "sorts": [],
            "properties": [{ "propertyId": "author", "visible": true, "width": null }],
            "groupPropertyId": "status",
            "hiddenGroups": ["done", ""],
        })
    }

    fn calendar() -> Value {
        json!({
            "version": 1,
            "type": "calendar",
            "filters": [{ "propertyId": "due", "operator": "before", "value": "2026-12-24" }],
            "sorts": [{ "propertyId": "due", "direction": "asc" }],
            "properties": [],
            "datePropertyId": null,
        })
    }

    fn empty_table() -> Value {
        json!({
            "version": 1, "type": "table", "filters": [], "sorts": [], "properties": [],
            "groupBy": null
        })
    }

    async fn database(storage: &Storage) -> String {
        storage.create_database(None).await.unwrap().page.id
    }

    async fn views(storage: &Storage, database: &str) -> Vec<View> {
        storage.load_database(database).await.unwrap().views
    }

    fn names(views: &[View]) -> Vec<&str> {
        views.iter().map(|view| view.name.as_str()).collect()
    }

    async fn view_count(storage: &Storage) -> i64 {
        let count: Option<i64> = storage
            .db
            .query("RETURN count(SELECT * FROM view)")
            .await
            .unwrap()
            .take(0)
            .unwrap();
        count.unwrap()
    }

    #[tokio::test]
    async fn a_new_database_has_one_empty_table_view_named_table() {
        let storage = storage().await;

        let created = storage.create_database(None).await.unwrap();
        let loaded = storage.load_database(&created.page.id).await.unwrap();

        assert_eq!(created.views.len(), 1);
        let view = &created.views[0];
        assert_eq!(view.name, "Table");
        assert_eq!(view.database_id, created.page.id);
        assert_eq!(view.config.to_json(), empty_table());
        assert_eq!(loaded.views, created.views);
        assert_eq!(view_count(&storage).await, 1);
    }

    #[tokio::test]
    async fn every_view_type_round_trips_through_create_load_and_update() {
        let storage = storage().await;
        let database = database(&storage).await;

        for value in [table(), kanban(), calendar()] {
            let created = storage
                .create_view(&database, "View", &config(value.clone()))
                .await
                .unwrap();
            assert_eq!(created.config.to_json(), value, "created");

            let loaded = views(&storage, &database).await;
            let loaded = loaded.iter().find(|view| view.id == created.id).unwrap();
            assert_eq!(loaded.config.to_json(), value, "loaded");

            // Start from another configuration so the update has to write.
            storage
                .update_view(&created.id, None, Some(&ViewConfig::empty_table()))
                .await
                .unwrap();
            let updated = storage
                .update_view(&created.id, None, Some(&config(value.clone())))
                .await
                .unwrap();
            assert_eq!(updated.config.to_json(), value, "updated");

            let loaded = views(&storage, &database).await;
            let loaded = loaded.iter().find(|view| view.id == created.id).unwrap();
            assert_eq!(loaded.config.to_json(), value, "loaded after the update");
        }
    }

    #[tokio::test]
    async fn changing_the_type_leaves_nothing_of_the_old_configuration() {
        let storage = storage().await;
        let database = database(&storage).await;
        let view = storage
            .create_view(&database, "Board", &config(kanban()))
            .await
            .unwrap();

        storage
            .update_view(&view.id, None, Some(&config(calendar())))
            .await
            .unwrap();

        let loaded = views(&storage, &database).await;
        assert_eq!(loaded[1].config.to_json(), calendar());
    }

    #[tokio::test]
    async fn views_come_back_in_the_order_they_were_created() {
        let storage = storage().await;
        let database = database(&storage).await;
        let other = self::database(&storage).await;

        let board = storage
            .create_view(&database, "Board", &config(kanban()))
            .await
            .unwrap();
        let month = storage
            .create_view(&database, "Month", &config(calendar()))
            .await
            .unwrap();
        storage
            .create_view(&other, "Elsewhere", &config(table()))
            .await
            .unwrap();

        let loaded = views(&storage, &database).await;
        assert_eq!(names(&loaded), ["Table", "Board", "Month"]);
        assert!(loaded[0].position < board.position);
        assert!(board.position < month.position);
        assert_eq!(
            names(&views(&storage, &other).await),
            ["Table", "Elsewhere"]
        );
    }

    #[tokio::test]
    async fn views_are_loaded_by_position_and_a_new_one_comes_after_the_last() {
        let storage = storage().await;
        let database = database(&storage).await;
        let board = storage
            .create_view(&database, "Board", &config(kanban()))
            .await
            .unwrap();
        let first = views(&storage, &database).await.remove(0);
        run_with_pages(
            &storage,
            &[],
            &format!(
                "UPDATE view:`{}` SET position = 10.0; UPDATE view:`{}` SET position = -5.0;",
                first.id, board.id
            ),
        )
        .await;
        assert_eq!(names(&views(&storage, &database).await), ["Board", "Table"]);

        let month = storage
            .create_view(&database, "Month", &config(calendar()))
            .await
            .unwrap();

        assert!(month.position > 10.0);
        assert_eq!(
            names(&views(&storage, &database).await),
            ["Board", "Table", "Month"]
        );
    }

    #[tokio::test]
    async fn updating_with_none_keeps_the_name_or_the_configuration() {
        let storage = storage().await;
        let database = database(&storage).await;
        let view = storage
            .create_view(&database, "Board", &config(kanban()))
            .await
            .unwrap();

        let renamed = storage
            .update_view(&view.id, Some("Pipeline"), None)
            .await
            .unwrap();
        assert_eq!(renamed.name, "Pipeline");
        assert_eq!(renamed.config.to_json(), kanban());

        let reconfigured = storage
            .update_view(&view.id, None, Some(&config(table())))
            .await
            .unwrap();
        assert_eq!(reconfigured.name, "Pipeline");
        assert_eq!(reconfigured.config.to_json(), table());

        let untouched = storage.update_view(&view.id, None, None).await.unwrap();
        assert_eq!(untouched, reconfigured);
        assert_eq!(views(&storage, &database).await[1], reconfigured);
        assert_eq!(untouched.position, view.position);
        assert_eq!(untouched.database_id, database);
    }

    #[tokio::test]
    async fn updating_an_unknown_view_fails_without_creating_it() {
        let storage = storage().await;
        let database = database(&storage).await;

        let error = storage
            .update_view("missing", Some("Ghost"), Some(&config(table())))
            .await
            .unwrap_err();

        assert!(matches!(error, StorageError::NotFound(_)));
        assert_eq!(names(&views(&storage, &database).await), ["Table"]);
        assert_eq!(view_count(&storage).await, 1);
    }

    #[tokio::test]
    async fn the_last_view_cannot_be_deleted_but_a_second_one_can() {
        let storage = storage().await;
        let database = database(&storage).await;
        let first = views(&storage, &database).await.remove(0);
        let second = storage
            .create_view(&database, "Board", &config(kanban()))
            .await
            .unwrap();

        storage.delete_view(&first.id).await.unwrap();
        assert_eq!(
            views(&storage, &database).await,
            std::slice::from_ref(&second)
        );

        let error = storage.delete_view(&second.id).await.unwrap_err();
        assert!(matches!(error, StorageError::Invalid(_)));
        assert_eq!(views(&storage, &database).await, [second]);
    }

    #[tokio::test]
    async fn the_views_of_other_databases_do_not_count_as_spare() {
        let storage = storage().await;
        let database = database(&storage).await;
        let other = self::database(&storage).await;
        storage
            .create_view(&other, "Board", &config(kanban()))
            .await
            .unwrap();
        let only = views(&storage, &database).await.remove(0);

        let error = storage.delete_view(&only.id).await.unwrap_err();

        assert!(matches!(error, StorageError::Invalid(_)));
        assert_eq!(views(&storage, &database).await, [only]);
    }

    #[tokio::test]
    async fn deleting_an_unknown_view_fails_with_not_found() {
        let storage = storage().await;

        let error = storage.delete_view("missing").await.unwrap_err();

        assert!(matches!(error, StorageError::NotFound(_)));
    }

    #[tokio::test]
    async fn deleting_the_database_removes_its_views() {
        let storage = storage().await;
        let database = database(&storage).await;
        let other = self::database(&storage).await;
        let board = storage
            .create_view(&database, "Board", &config(kanban()))
            .await
            .unwrap();
        assert_eq!(view_count(&storage).await, 3);

        storage.delete_page(&database).await.unwrap();

        assert_eq!(view_count(&storage).await, 1);
        assert_eq!(names(&views(&storage, &other).await), ["Table"]);
        assert!(matches!(
            storage.update_view(&board.id, Some("Gone"), None).await,
            Err(StorageError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn a_view_cannot_be_created_on_an_ordinary_page_a_row_or_an_unknown_id() {
        let storage = storage().await;
        let page = storage.create_page(None).await.unwrap();
        let database = database(&storage).await;
        run_with_pages(
            &storage,
            &[("database", &database)],
            "CREATE page:row SET title = 'Row', parent = $database, database = $database;",
        )
        .await;

        for id in [page.id.as_str(), "row", "missing"] {
            let error = storage
                .create_view(id, "Table", &config(table()))
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::NotFound(_)), "on {id}");
        }
        assert_eq!(view_count(&storage).await, 1);
    }

    #[tokio::test]
    async fn a_configuration_may_mention_properties_that_do_not_exist() {
        let storage = storage().await;
        let database = database(&storage).await;
        let value = json!({
            "version": 1,
            "type": "kanban",
            "filters": [{ "propertyId": "nowhere", "operator": "equals", "value": "gone" }],
            "sorts": [{ "propertyId": "nothing", "direction": "asc" }],
            "properties": [{ "propertyId": "nobody", "visible": true, "width": 100 }],
            "groupPropertyId": "never",
            "hiddenGroups": ["no-such-option"],
        });

        let view = storage
            .create_view(&database, "Board", &config(value.clone()))
            .await
            .unwrap();

        assert_eq!(view.config.to_json(), value);
        assert_eq!(views(&storage, &database).await[1].config.to_json(), value);
    }

    #[tokio::test]
    async fn a_stored_configuration_that_cannot_be_read_is_a_database_error() {
        let storage = storage().await;
        let database = database(&storage).await;
        run_with_pages(
            &storage,
            &[("database", &database)],
            "CREATE view SET database = $database, name = 'Broken', position = 5.0,
                 config = { version: 2, type: 'table' };",
        )
        .await;

        let error = storage.load_database(&database).await.unwrap_err();

        assert!(matches!(error, StorageError::Database(_)));
    }
}
