//! Tests for page locks: which command each level refuses.

use super::tests::run_with_pages;
use super::*;
use crate::domain::{Block, CellValue, Page, PageLock, PropertyType, SelectOption, ViewConfig};

async fn storage() -> Storage {
    Storage::open_in_memory().await.unwrap()
}

fn is_locked<T: std::fmt::Debug>(result: Result<T, StorageError>) -> bool {
    let locked = matches!(result, Err(StorageError::Locked(_)));
    if !locked {
        eprintln!("expected a lock, got {result:?}");
    }
    locked
}

/// A database with one text property and the rows `row_a` and `row_b`.
async fn database(storage: &Storage) -> (Page, String) {
    let database = storage.create_database(None).await.unwrap().page;
    let property = storage
        .create_property(&database.id, "Text", PropertyType::Text, None)
        .await
        .unwrap();
    run_with_pages(
        storage,
        &[("database", &database.id)],
        "CREATE page:row_a SET title = 'A', parent = $database, database = $database, position = 0.0;
         CREATE page:row_b SET title = 'B', parent = $database, database = $database, position = 1.0;",
    )
    .await;
    (database, property.id)
}

fn paragraph(id: &str, text: &str) -> Block {
    Block {
        id: id.into(),
        kind: "paragraph".into(),
        props: Default::default(),
        content: Some(serde_json::json!([{ "type": "text", "text": text, "styles": {} }])),
        children: Vec::new(),
    }
}

/// Everything a refused change must leave alone: every page with its title,
/// icon, cover, position and lock, the blocks of `pages`, and the properties,
/// views and rows (with their cells) of `database`.
async fn snapshot(storage: &Storage, pages: &[&str], database: Option<&str>) -> String {
    let mut blocks = Vec::new();
    for page in pages {
        blocks.push(storage.load_blocks(page).await.unwrap());
    }
    let database = match database {
        Some(id) => Some((
            storage.load_database(id).await.unwrap(),
            storage.list_rows(id).await.unwrap(),
        )),
        None => None,
    };
    format!(
        "{:?}",
        (storage.list_pages().await.unwrap(), blocks, database)
    )
}

async fn view_id(storage: &Storage, database: &str) -> String {
    storage.load_database(database).await.unwrap().views[0]
        .id
        .clone()
}

#[tokio::test]
async fn a_new_page_is_unlocked_and_the_lock_is_stored_and_listed() {
    let storage = storage().await;
    let page = storage.create_page(None).await.unwrap();
    assert_eq!(page.lock, PageLock::None);

    for lock in [PageLock::Content, PageLock::All, PageLock::None] {
        let set = storage.set_lock(&page.id, lock).await.unwrap();
        assert_eq!(set.lock, lock);
        let listed = storage.list_pages().await.unwrap();
        assert_eq!(listed[0].lock, lock);
    }
}

#[tokio::test]
async fn setting_the_lock_does_not_advance_updated_at_and_unknown_pages_are_not_found() {
    let storage = storage().await;
    let page = storage.create_page(None).await.unwrap();

    let locked = storage.set_lock(&page.id, PageLock::All).await.unwrap();

    assert_eq!(locked.updated_at, page.updated_at);
    assert!(matches!(
        storage.set_lock("missing", PageLock::All).await,
        Err(StorageError::NotFound(_))
    ));
}

#[tokio::test]
async fn pages_written_before_the_lock_existed_read_as_unlocked() {
    let storage = storage().await;
    let page = storage.create_page(None).await.unwrap();
    run_with_pages(
        &storage,
        &[("page", &page.id)],
        "UPDATE $page SET lock = NONE;",
    )
    .await;

    assert_eq!(storage.list_pages().await.unwrap()[0].lock, PageLock::None);
}

#[tokio::test]
async fn an_unknown_lock_value_cannot_be_stored() {
    let storage = storage().await;
    let page = storage.create_page(None).await.unwrap();

    let result = storage
        .db
        .query("UPDATE type::record('page', $id) SET lock = 'bogus'")
        .bind(("id", page.id))
        .await
        .unwrap()
        .check();

    assert!(result.is_err());
}

#[tokio::test]
async fn a_locked_page_refuses_changes_to_its_content_at_both_levels() {
    let storage = storage().await;

    for lock in [PageLock::Content, PageLock::All] {
        let page = storage.create_page(None).await.unwrap();
        let other = storage.create_page(None).await.unwrap();
        storage
            .update_appearance(&page.id, None, Some("gallery:aurora"))
            .await
            .unwrap();
        let block = format!("b-{}", page.id);
        storage
            .save_blocks(&page.id, &[paragraph(&block, "kept")])
            .await
            .unwrap();
        storage.set_lock(&page.id, lock).await.unwrap();
        let before = snapshot(&storage, &[&page.id], None).await;

        assert!(is_locked(storage.rename_page(&page.id, "x").await));
        assert!(is_locked(
            storage
                .update_appearance(&page.id, Some("book"), None)
                .await
        ));
        assert!(is_locked(storage.set_banner_position(&page.id, 10).await));
        assert!(is_locked(
            storage
                .save_blocks(&page.id, &[paragraph(&block, "changed")])
                .await
        ));
        assert!(is_locked(storage.move_page(&page.id, None, 0).await));
        assert!(is_locked(storage.delete_page(&page.id).await));
        assert_eq!(snapshot(&storage, &[&page.id], None).await, before);

        // Other pages, favouriting, reading and unlocking still work.
        storage.rename_page(&other.id, "fine").await.unwrap();
        storage.set_favorite(&page.id, true).await.unwrap();
        assert!(storage.load_blocks(&page.id).await.is_ok());
        storage.set_lock(&page.id, PageLock::None).await.unwrap();
        storage.rename_page(&page.id, "unlocked").await.unwrap();
    }
}

#[tokio::test]
async fn a_refused_change_leaves_the_page_as_it_was() {
    let storage = storage().await;
    let page = storage.create_page(None).await.unwrap();
    let page = storage.rename_page(&page.id, "Title").await.unwrap();
    storage.set_lock(&page.id, PageLock::Content).await.unwrap();

    let _ = storage.rename_page(&page.id, "Other").await;

    let after = &storage.list_pages().await.unwrap()[0];
    assert_eq!(after.title, "Title");
    assert_eq!(after.updated_at, page.updated_at);
}

#[tokio::test]
async fn a_page_cannot_be_deleted_while_it_or_a_page_below_it_is_locked() {
    let storage = storage().await;
    let parent = storage.create_page(None).await.unwrap();
    let child = storage.create_page(Some(&parent.id)).await.unwrap();
    let grandchild = storage.create_page(Some(&child.id)).await.unwrap();
    storage
        .set_lock(&grandchild.id, PageLock::Content)
        .await
        .unwrap();

    assert!(is_locked(storage.delete_page(&parent.id).await));
    assert!(is_locked(storage.delete_page(&child.id).await));
    assert_eq!(storage.list_pages().await.unwrap().len(), 3);

    storage
        .set_lock(&grandchild.id, PageLock::None)
        .await
        .unwrap();
    storage.delete_page(&parent.id).await.unwrap();
    assert!(storage.list_pages().await.unwrap().is_empty());
}

#[tokio::test]
async fn a_lock_on_a_sibling_or_a_parent_does_not_block_a_page() {
    let storage = storage().await;
    let parent = storage.create_page(None).await.unwrap();
    let child = storage.create_page(Some(&parent.id)).await.unwrap();
    let sibling = storage.create_page(Some(&parent.id)).await.unwrap();
    storage.set_lock(&parent.id, PageLock::All).await.unwrap();
    storage.set_lock(&sibling.id, PageLock::All).await.unwrap();

    storage.rename_page(&child.id, "free").await.unwrap();
    storage.move_page(&child.id, None, 0).await.unwrap();
    storage.create_page(Some(&parent.id)).await.unwrap();
    storage.delete_page(&child.id).await.unwrap();
}

#[tokio::test]
async fn a_database_locked_at_content_can_still_be_edited() {
    let storage = storage().await;
    let (database, property) = database(&storage).await;
    storage
        .set_lock(&database.id, PageLock::Content)
        .await
        .unwrap();
    let view = view_id(&storage, &database.id).await;

    // The page itself is read-only.
    assert!(is_locked(storage.rename_page(&database.id, "x").await));
    assert!(is_locked(storage.delete_page(&database.id).await));

    // Rows, cells, properties and views are not.
    let row = storage.create_row(&database.id).await.unwrap();
    storage
        .set_cell(&row.id, &property, CellValue::Text("v".into()))
        .await
        .unwrap();
    storage.rename_page("row_a", "renamed").await.unwrap();
    storage.save_blocks("row_a", &[]).await.unwrap();
    storage
        .update_property(&property, Some("Name"), None)
        .await
        .unwrap();
    storage
        .create_property(&database.id, "More", PropertyType::Number, None)
        .await
        .unwrap();
    storage
        .change_property_type(&property, PropertyType::Number)
        .await
        .unwrap();
    storage
        .update_view(&view, Some("Renamed"), None)
        .await
        .unwrap();
    let second = storage
        .create_view(&database.id, "Second", &ViewConfig::empty_table())
        .await
        .unwrap();
    storage.delete_view(&second.id).await.unwrap();
    storage.delete_property(&property).await.unwrap();
    storage.delete_page("row_b").await.unwrap();
}

#[tokio::test]
async fn a_database_locked_at_everything_refuses_every_change_but_reads() {
    let storage = storage().await;
    let (database, property) = database(&storage).await;
    storage
        .set_cell("row_a", &property, CellValue::Text("kept".into()))
        .await
        .unwrap();
    let view = view_id(&storage, &database.id).await;
    storage
        .save_blocks("row_a", &[paragraph("r1", "kept")])
        .await
        .unwrap();
    storage.set_lock(&database.id, PageLock::All).await.unwrap();
    let before = snapshot(&storage, &["row_a", "row_b"], Some(&database.id)).await;

    assert!(is_locked(storage.create_row(&database.id).await));
    assert!(is_locked(
        storage
            .set_cell("row_a", &property, CellValue::Text("x".into()))
            .await
    ));
    assert!(is_locked(
        storage
            .set_cell_from_json("row_a", &property, &serde_json::json!("x"))
            .await
    ));
    assert!(is_locked(storage.rename_page("row_a", "x").await));
    assert!(is_locked(storage.save_blocks("row_a", &[]).await));
    assert!(is_locked(
        storage.update_appearance("row_a", Some("book"), None).await
    ));
    assert!(is_locked(storage.delete_page("row_a").await));
    assert!(is_locked(
        storage
            .create_property(&database.id, "P", PropertyType::Text, None)
            .await
    ));
    assert!(is_locked(
        storage.update_property(&property, Some("x"), None).await
    ));
    assert!(is_locked(
        storage
            .change_property_type(&property, PropertyType::Number)
            .await
    ));
    assert!(is_locked(storage.delete_property(&property).await));
    assert!(is_locked(storage.update_view(&view, Some("x"), None).await));
    assert!(is_locked(
        storage
            .create_view(&database.id, "V", &ViewConfig::empty_table())
            .await
    ));
    assert!(is_locked(storage.delete_view(&view).await));
    assert!(is_locked(storage.delete_page(&database.id).await));
    assert_eq!(
        snapshot(&storage, &["row_a", "row_b"], Some(&database.id)).await,
        before
    );

    // Reading and unlocking are not changes.
    let loaded = storage.load_database(&database.id).await.unwrap();
    assert_eq!(loaded.properties.len(), 1);
    assert_eq!(storage.list_rows(&database.id).await.unwrap().len(), 2);
    storage
        .set_lock(&database.id, PageLock::None)
        .await
        .unwrap();
    storage.create_row(&database.id).await.unwrap();
}

#[tokio::test]
async fn a_locked_row_keeps_its_cells_at_content_and_loses_them_at_everything() {
    let storage = storage().await;
    let (_, property) = database(&storage).await;

    storage.set_lock("row_a", PageLock::Content).await.unwrap();
    assert!(is_locked(storage.rename_page("row_a", "x").await));
    assert!(is_locked(storage.delete_page("row_a").await));
    storage
        .set_cell("row_a", &property, CellValue::Text("ok".into()))
        .await
        .unwrap();
    storage
        .set_cell("row_b", &property, CellValue::Text("ok".into()))
        .await
        .unwrap();

    storage.set_lock("row_a", PageLock::All).await.unwrap();
    assert!(is_locked(
        storage
            .set_cell("row_a", &property, CellValue::Text("no".into()))
            .await
    ));
    storage
        .set_cell("row_b", &property, CellValue::Text("fine".into()))
        .await
        .unwrap();
}

#[tokio::test]
async fn a_database_cannot_be_deleted_with_a_locked_row() {
    let storage = storage().await;
    let (database, _) = database(&storage).await;
    storage.set_lock("row_b", PageLock::Content).await.unwrap();

    assert!(is_locked(storage.delete_page(&database.id).await));
    assert_eq!(storage.list_rows(&database.id).await.unwrap().len(), 2);
}

#[tokio::test]
async fn unknown_pages_are_still_not_found_before_any_lock_applies() {
    let storage = storage().await;

    assert!(matches!(
        storage.rename_page("missing", "x").await,
        Err(StorageError::NotFound(_))
    ));
    assert!(matches!(
        storage.save_blocks("missing", &[]).await,
        Err(StorageError::NotFound(_))
    ));
    assert!(matches!(
        storage.delete_page("missing").await,
        Err(StorageError::NotFound(_))
    ));
    assert!(matches!(
        storage.update_view("missing", None, None).await,
        Err(StorageError::NotFound(_))
    ));
    assert!(matches!(
        storage.delete_view("missing").await,
        Err(StorageError::NotFound(_))
    ));
}

#[tokio::test]
async fn a_row_locked_at_everything_survives_the_cascades_of_an_unlocked_database() {
    let storage = storage().await;
    let (database, text) = database(&storage).await;
    let status = storage
        .create_property(&database.id, "Status", PropertyType::Select, None)
        .await
        .unwrap();
    let option = SelectOption {
        id: "done".into(),
        name: "Done".into(),
        color: "green".into(),
    };
    storage
        .update_property(&status.id, None, Some(&[option]))
        .await
        .unwrap();
    for row in ["row_a", "row_b"] {
        storage
            .set_cell(row, &text, CellValue::Text("1".into()))
            .await
            .unwrap();
        storage
            .set_cell(row, &status.id, CellValue::Select("done".into()))
            .await
            .unwrap();
    }
    storage.set_lock("row_a", PageLock::All).await.unwrap();
    let before = snapshot(&storage, &["row_a", "row_b"], Some(&database.id)).await;

    assert!(is_locked(storage.delete_property(&text).await));
    assert!(is_locked(
        storage
            .change_property_type(&text, PropertyType::Number)
            .await
    ));
    assert!(is_locked(
        storage.delete_select_option(&status.id, "done").await
    ));
    assert_eq!(
        snapshot(&storage, &["row_a", "row_b"], Some(&database.id)).await,
        before
    );

    // At content the row's cells are still covered by the cascades.
    storage.set_lock("row_a", PageLock::Content).await.unwrap();
    storage
        .delete_select_option(&status.id, "done")
        .await
        .unwrap();
    storage
        .change_property_type(&text, PropertyType::Number)
        .await
        .unwrap();
    storage.delete_property(&text).await.unwrap();
}

#[tokio::test]
async fn moving_a_page_renumbers_locked_siblings_without_refusing() {
    let storage = storage().await;
    let first = storage.create_page(None).await.unwrap();
    let locked = storage.create_page(None).await.unwrap();
    storage.set_lock(&locked.id, PageLock::All).await.unwrap();

    storage.move_page(&first.id, None, 1).await.unwrap();

    let pages = storage.list_pages().await.unwrap();
    assert_eq!(pages[0].id, locked.id);
    assert_eq!(pages[0].lock, PageLock::All);
}

#[tokio::test]
async fn a_relation_cell_of_a_locked_row_is_not_rewritten_or_cascaded_away() {
    let storage = storage().await;
    let (database, _) = database(&storage).await;
    let relation = storage
        .create_property(
            &database.id,
            "Related",
            PropertyType::Relation,
            Some(&database.id),
        )
        .await
        .unwrap();
    storage
        .set_cell(
            "row_a",
            &relation.id,
            CellValue::Relation(vec!["row_b".into()]),
        )
        .await
        .unwrap();
    storage.set_lock("row_a", PageLock::All).await.unwrap();

    assert!(is_locked(
        storage
            .set_cell("row_a", &relation.id, CellValue::Relation(Vec::new()))
            .await
    ));
    assert!(is_locked(storage.delete_property(&relation.id).await));
    let rows = storage.list_rows(&database.id).await.unwrap();
    let row = rows.iter().find(|row| row.id == "row_a").unwrap();
    assert_eq!(
        row.cells.get(&relation.id),
        Some(&CellValue::Relation(vec!["row_b".into()]))
    );
}
