use serde_json::{Map, json};

use super::super::tests::run_with_pages;
use super::*;
use crate::domain::{Block, CellValue, PropertyType};

async fn storage() -> Storage {
    Storage::open_in_memory().await.unwrap()
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

fn link_to(id: &str, page_id: &str) -> Block {
    Block {
        id: id.into(),
        kind: "paragraph".into(),
        props: Map::new(),
        content: Some(json!([{ "type": "pageLink", "props": { "pageId": page_id } }])),
        children: Vec::new(),
    }
}

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

async fn ids(storage: &Storage) -> Vec<String> {
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
async fn a_trashed_page_leaves_every_read_path() {
    let storage = storage().await;
    let keep = storage.create_page(None).await.unwrap();
    let gone = storage.create_page(None).await.unwrap();
    let child = storage.create_page(Some(&gone.id)).await.unwrap();
    storage.rename_page(&gone.id, "Zebra plan").await.unwrap();
    storage
        .save_blocks(&gone.id, &[paragraph("g1", "zebra stripes")])
        .await
        .unwrap();
    storage
        .save_blocks(&keep.id, &[link_to("k1", &gone.id)])
        .await
        .unwrap();
    storage.set_favorite(&gone.id, true).await.unwrap();
    assert_eq!(storage.search("zebra").await.unwrap().len(), 1);

    storage.trash_page(&gone.id).await.unwrap();

    assert_eq!(ids(&storage).await, std::slice::from_ref(&keep.id));
    assert!(storage.search("zebra").await.unwrap().is_empty());
    assert!(storage.find_page(&child.id).await.unwrap().is_none());
    assert!(storage.load_blocks(&gone.id).await.is_err());
    assert!(
        storage
            .list_pages()
            .await
            .unwrap()
            .iter()
            .all(|page| !page.is_favorite)
    );
    let trash = storage.list_trash().await.unwrap();
    assert_eq!(trash.len(), 1);
    assert_eq!(trash[0].id, gone.id);
    assert_eq!(trash[0].title, "Zebra plan");
    assert_eq!(trash[0].page_count, 2);
}

#[tokio::test]
async fn restoring_brings_back_pages_blocks_favourites_and_incoming_links() {
    let storage = storage().await;
    let keep = storage.create_page(None).await.unwrap();
    let parent = storage.create_page(None).await.unwrap();
    let child = storage.create_page(Some(&parent.id)).await.unwrap();
    storage.rename_page(&parent.id, "Zebra plan").await.unwrap();
    storage
        .save_blocks(&parent.id, &[paragraph("p1", "zebra stripes")])
        .await
        .unwrap();
    storage
        .save_blocks(&child.id, &[link_to("c1", &keep.id)])
        .await
        .unwrap();
    storage
        .save_blocks(&keep.id, &[link_to("k1", &parent.id)])
        .await
        .unwrap();
    storage.set_favorite(&parent.id, true).await.unwrap();
    let before = storage.list_pages().await.unwrap();

    storage.trash_page(&parent.id).await.unwrap();
    assert!(storage.list_backlinks(&parent.id).await.is_err());
    assert!(storage.list_backlinks(&keep.id).await.unwrap().is_empty());
    let restored = storage.restore_page(&parent.id).await.unwrap();

    assert_eq!(restored.id, parent.id);
    assert_eq!(storage.list_pages().await.unwrap(), before);
    assert_eq!(storage.load_blocks(&parent.id).await.unwrap().len(), 1);
    assert_eq!(storage.search("zebra").await.unwrap().len(), 1);
    assert_eq!(
        storage.list_backlinks(&parent.id).await.unwrap()[0].id,
        keep.id
    );
    assert_eq!(
        storage.list_backlinks(&keep.id).await.unwrap()[0].id,
        child.id
    );
    assert!(storage.list_trash().await.unwrap().is_empty());
    assert_eq!(count(&storage, "trash_item").await, 0);
}

#[tokio::test]
async fn a_page_returns_to_the_top_level_when_its_parent_is_gone() {
    let storage = storage().await;
    let parent = storage.create_page(None).await.unwrap();
    let child = storage.create_page(Some(&parent.id)).await.unwrap();
    storage.trash_page(&child.id).await.unwrap();
    storage.trash_page(&parent.id).await.unwrap();
    storage.delete_page_permanently(&parent.id).await.unwrap();

    let restored = storage.restore_page(&child.id).await.unwrap();

    assert_eq!(restored.parent_id, None);
}

#[tokio::test]
async fn a_page_returns_below_its_old_parent() {
    let storage = storage().await;
    let parent = storage.create_page(None).await.unwrap();
    let child = storage.create_page(Some(&parent.id)).await.unwrap();
    storage.trash_page(&child.id).await.unwrap();

    let restored = storage.restore_page(&child.id).await.unwrap();

    assert_eq!(restored.parent_id.as_deref(), Some(parent.id.as_str()));
}

#[tokio::test]
async fn a_database_comes_back_with_rows_properties_views_and_cells() {
    let storage = storage().await;
    let database = storage.create_database(None).await.unwrap();
    let id = database.page.id.clone();
    let property = storage
        .create_property(&id, "Notes", PropertyType::Text, None)
        .await
        .unwrap();
    let row = storage.create_row(&id).await.unwrap();
    storage.rename_page(&row.id, "Quokka").await.unwrap();
    storage
        .set_cell(&row.id, &property.id, CellValue::Text("marsupial".into()))
        .await
        .unwrap();
    storage
        .save_blocks(&row.id, &[paragraph("r1", "numbat")])
        .await
        .unwrap();
    assert_eq!(count(&storage, "page").await, 2);

    storage.trash_page(&id).await.unwrap();

    assert_eq!(count(&storage, "page").await, 0);
    assert_eq!(count(&storage, "property").await, 0);
    assert_eq!(count(&storage, "view").await, 0);
    assert!(storage.search("quokka").await.unwrap().is_empty());
    assert!(storage.search("marsupial").await.unwrap().is_empty());
    assert_eq!(storage.list_trash().await.unwrap()[0].page_count, 2);

    storage.restore_page(&id).await.unwrap();

    let restored = storage.load_database(&id).await.unwrap();
    assert_eq!(restored.properties.len(), 1);
    assert_eq!(restored.views.len(), 1);
    let rows = storage.list_rows(&id).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].title, "Quokka");
    assert_eq!(
        rows[0].cells.get(&property.id),
        Some(&CellValue::Text("marsupial".into()))
    );
    assert_eq!(storage.search("quokka").await.unwrap().len(), 1);
    assert_eq!(storage.search("marsupial").await.unwrap().len(), 1);
    assert_eq!(storage.load_blocks(&row.id).await.unwrap().len(), 1);
}

#[tokio::test]
async fn a_trashed_row_returns_to_its_database_or_becomes_a_page() {
    let storage = storage().await;
    let database = storage.create_database(None).await.unwrap().page.id;
    let row = storage.create_row(&database).await.unwrap();
    storage.trash_page(&row.id).await.unwrap();
    assert!(storage.list_rows(&database).await.unwrap().is_empty());

    let restored = storage.restore_page(&row.id).await.unwrap();
    assert_eq!(restored.database_id.as_deref(), Some(database.as_str()));
    assert_eq!(storage.list_rows(&database).await.unwrap().len(), 1);

    storage.trash_page(&row.id).await.unwrap();
    storage.trash_page(&database).await.unwrap();
    storage.delete_page_permanently(&database).await.unwrap();
    let orphan = storage.restore_page(&row.id).await.unwrap();
    assert_eq!(orphan.database_id, None);
    assert_eq!(orphan.parent_id, None);
}

#[tokio::test]
async fn relations_to_a_trashed_database_come_back_with_it() {
    let storage = storage().await;
    let authors = storage.create_database(None).await.unwrap().page.id;
    let books = storage.create_database(None).await.unwrap().page.id;
    let author = storage.create_row(&authors).await.unwrap();
    let book = storage.create_row(&books).await.unwrap();
    run_with_pages(
        &storage,
        &[("authors", &authors), ("books", &books)],
        &format!(
            "CREATE property:wrote SET database = $authors, name = 'Wrote',
                 type = 'relation', target = $books;
             RELATE page:`{}`->row_link->page:`{}` SET property = property:wrote;",
            author.id, book.id
        ),
    )
    .await;

    storage.trash_page(&books).await.unwrap();
    assert_eq!(count(&storage, "property").await, 0);
    assert_eq!(count(&storage, "row_link").await, 0);

    storage.restore_page(&books).await.unwrap();
    assert_eq!(count(&storage, "property").await, 1);
    assert_eq!(count(&storage, "row_link").await, 1);
}

#[tokio::test]
async fn permanent_deletion_and_emptying_remove_everything() {
    let storage = storage().await;
    let first = storage.create_page(None).await.unwrap();
    let second = storage.create_page(None).await.unwrap();
    storage
        .save_blocks(&first.id, &[paragraph("f1", "one")])
        .await
        .unwrap();
    storage.trash_page(&first.id).await.unwrap();
    storage.trash_page(&second.id).await.unwrap();

    storage.delete_page_permanently(&first.id).await.unwrap();
    assert_eq!(storage.list_trash().await.unwrap().len(), 1);
    assert!(matches!(
        storage.restore_page(&first.id).await,
        Err(StorageError::NotFound(_))
    ));
    assert_eq!(storage.empty_trash().await.unwrap(), 1);

    assert!(storage.list_trash().await.unwrap().is_empty());
    assert_eq!(count(&storage, "trash_item").await, 0);
    assert_eq!(count(&storage, "block").await, 0);
}

#[tokio::test]
async fn pages_stay_for_the_retention_and_not_longer() {
    let storage = storage().await;
    assert_eq!(
        storage.trash_settings().await.unwrap().retention_days,
        Some(DEFAULT_RETENTION_DAYS)
    );
    let old = storage.create_page(None).await.unwrap();
    let recent = storage.create_page(None).await.unwrap();
    storage.trash_page(&old.id).await.unwrap();
    storage.trash_page(&recent.id).await.unwrap();
    storage
        .db
        .query("UPDATE type::record('trash', $id) SET deleted_at = time::now() - 40d")
        .bind(("id", old.id.clone()))
        .await
        .unwrap()
        .check()
        .unwrap();

    assert_eq!(storage.purge_expired_trash().await.unwrap(), 1);
    let left = storage.list_trash().await.unwrap();
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].id, recent.id);

    storage.set_trash_retention(None).await.unwrap();
    assert_eq!(storage.trash_settings().await.unwrap().retention_days, None);
    storage
        .db
        .query("UPDATE trash SET deleted_at = time::now() - 4000d")
        .await
        .unwrap()
        .check()
        .unwrap();
    assert_eq!(storage.purge_expired_trash().await.unwrap(), 0);

    storage.set_trash_retention(Some(7)).await.unwrap();
    assert_eq!(
        storage.trash_settings().await.unwrap().retention_days,
        Some(7)
    );
    assert!(matches!(
        storage.set_trash_retention(Some(0)).await,
        Err(StorageError::Invalid(_))
    ));
}

#[tokio::test]
async fn a_move_to_the_trash_that_did_not_finish_is_rolled_back() {
    let storage = storage().await;
    let page = storage.create_page(None).await.unwrap();
    let child = storage.create_page(Some(&page.id)).await.unwrap();
    storage
        .save_blocks(&child.id, &[paragraph("c1", "kept")])
        .await
        .unwrap();
    // The copy exists, the original is half deleted, the entry is open.
    let ids_below = storage.subtree(&page.id).await.unwrap();
    storage
        .db
        .query("CREATE type::record('trash', $id) SET title = '', groups = 1, page_count = 2")
        .bind(("id", page.id.clone()))
        .await
        .unwrap()
        .check()
        .unwrap();
    storage
        .archive_group(&page.id, 0, &ids_below, &ids_below)
        .await
        .unwrap();
    storage
        .db
        .query("DELETE block; DELETE type::record('page', $id);")
        .bind(("id", child.id.clone()))
        .await
        .unwrap()
        .check()
        .unwrap();

    storage.recover_trash().await.unwrap();

    let mut expected = vec![page.id.clone(), child.id.clone()];
    expected.sort();
    assert_eq!(ids(&storage).await, expected);
    assert_eq!(storage.load_blocks(&child.id).await.unwrap().len(), 1);
    assert!(storage.list_trash().await.unwrap().is_empty());
    assert_eq!(count(&storage, "trash").await, 0);
}

#[tokio::test]
async fn trashing_an_unknown_page_or_restoring_one_that_is_not_trashed_fails() {
    let storage = storage().await;

    assert!(matches!(
        storage.trash_page("missing").await,
        Err(StorageError::NotFound(_))
    ));
    assert!(matches!(
        storage.restore_page("missing").await,
        Err(StorageError::NotFound(_))
    ));
    assert!(matches!(
        storage.delete_page_permanently("missing").await,
        Err(StorageError::NotFound(_))
    ));
}

#[tokio::test]
async fn a_large_database_moves_through_the_trash_in_groups() {
    let storage = storage().await;
    let database = storage.create_database(None).await.unwrap().page.id;
    run_with_pages(
        &storage,
        &[("database", &database)],
        "FOR $index IN 0..450 {
             CREATE page SET title = 'row', parent = $database, database = $database,
                 position = <float> $index;
         };",
    )
    .await;

    storage.trash_page(&database).await.unwrap();
    assert_eq!(count(&storage, "page").await, 0);
    assert_eq!(storage.list_trash().await.unwrap()[0].page_count, 451);

    storage.restore_page(&database).await.unwrap();
    assert_eq!(count(&storage, "page").await, 451);
    assert_eq!(storage.list_rows(&database).await.unwrap().len(), 450);
}

/// A move to the trash stopped half-way: the entry is open, the records are
/// copied, and the originals are deleted or not.
async fn unfinished_trash(storage: &Storage, id: &str, delete_originals: bool) {
    let ids = storage.subtree(id).await.unwrap();
    storage
        .db
        .query(
            "CREATE type::record('trash', $id) SET title = '', groups = 1, page_count = $count,
                 complete = false",
        )
        .bind(("id", id.to_owned()))
        .bind(("count", ids.len() as i64))
        .await
        .unwrap()
        .check()
        .unwrap();
    storage.archive_group(id, 0, &ids, &ids).await.unwrap();
    if delete_originals {
        storage.delete_page(id).await.unwrap();
    }
}

#[tokio::test]
async fn a_crash_after_the_copy_and_before_the_delete_loses_nothing() {
    let storage = storage().await;
    let page = storage.create_page(None).await.unwrap();
    let child = storage.create_page(Some(&page.id)).await.unwrap();
    storage
        .save_blocks(&child.id, &[paragraph("c1", "kept")])
        .await
        .unwrap();
    unfinished_trash(&storage, &page.id, false).await;

    storage.recover_trash().await.unwrap();

    assert_eq!(ids(&storage).await.len(), 2);
    assert_eq!(storage.load_blocks(&child.id).await.unwrap().len(), 1);
    assert_eq!(count(&storage, "trash").await, 0);
    assert_eq!(count(&storage, "trash_item").await, 0);
}

#[tokio::test]
async fn a_crash_after_the_delete_and_before_the_entry_is_complete_loses_nothing() {
    let storage = storage().await;
    let page = storage.create_page(None).await.unwrap();
    let child = storage.create_page(Some(&page.id)).await.unwrap();
    storage
        .save_blocks(&child.id, &[paragraph("c1", "kept")])
        .await
        .unwrap();
    unfinished_trash(&storage, &page.id, true).await;
    assert_eq!(count(&storage, "page").await, 0);
    assert!(storage.list_trash().await.unwrap().is_empty());

    storage.recover_trash().await.unwrap();

    assert_eq!(ids(&storage).await.len(), 2);
    assert_eq!(storage.load_blocks(&child.id).await.unwrap().len(), 1);
    assert_eq!(count(&storage, "trash").await, 0);
}

#[tokio::test]
async fn a_crash_during_a_purge_finishes_the_purge_and_never_restores_half_an_entry() {
    let storage = storage().await;
    let page = storage.create_page(None).await.unwrap();
    storage.create_page(Some(&page.id)).await.unwrap();
    storage.trash_page(&page.id).await.unwrap();
    // The purge marked the entry and removed some of its items, then stopped.
    storage
        .db
        .query(
            "UPDATE type::record('trash', $id) SET purging = true;
             DELETE (SELECT VALUE id FROM trash_item LIMIT 1);",
        )
        .bind(("id", page.id.clone()))
        .await
        .unwrap()
        .check()
        .unwrap();
    assert!(storage.list_trash().await.unwrap().is_empty());
    assert!(matches!(
        storage.restore_page(&page.id).await,
        Err(StorageError::NotFound(_))
    ));

    storage.recover_trash().await.unwrap();

    assert_eq!(count(&storage, "trash").await, 0);
    assert_eq!(count(&storage, "trash_item").await, 0);
    assert_eq!(count(&storage, "page").await, 0);
}

#[tokio::test]
async fn a_row_cannot_be_restored_while_its_database_is_in_the_trash() {
    let storage = storage().await;
    let database = storage.create_database(None).await.unwrap().page.id;
    let property = storage
        .create_property(&database, "Notes", PropertyType::Text, None)
        .await
        .unwrap();
    let row = storage.create_row(&database).await.unwrap();
    storage
        .set_cell(&row.id, &property.id, CellValue::Text("kept".into()))
        .await
        .unwrap();
    storage.trash_page(&row.id).await.unwrap();
    storage.trash_page(&database).await.unwrap();

    assert!(matches!(
        storage.restore_page(&row.id).await,
        Err(StorageError::Invalid(_))
    ));
    // Nothing was lost by trying.
    assert_eq!(storage.list_trash().await.unwrap().len(), 2);

    storage.restore_page(&database).await.unwrap();
    storage.restore_page(&row.id).await.unwrap();
    let rows = storage.list_rows(&database).await.unwrap();
    assert_eq!(
        rows[0].cells.get(&property.id),
        Some(&CellValue::Text("kept".into()))
    );
}

#[tokio::test]
async fn a_save_during_a_move_to_the_trash_is_never_lost() {
    for round in 0..5 {
        let storage = storage().await;
        let page = storage.create_page(None).await.unwrap();
        for _ in 0..20 {
            storage.create_page(Some(&page.id)).await.unwrap();
        }
        storage
            .save_blocks(&page.id, &[paragraph("first", "one")])
            .await
            .unwrap();
        let late = paragraph(&format!("late{round}"), "late");

        let document = [paragraph("first", "one"), late.clone()];
        let (trashed, saved) = tokio::join!(
            storage.trash_page(&page.id),
            storage.save_blocks(&page.id, &document)
        );
        trashed.unwrap();
        storage.restore_page(&page.id).await.unwrap();

        let blocks = storage.load_blocks(&page.id).await.unwrap();
        match saved {
            // The save ran before the page was copied, or after it was gone.
            Ok(_) => assert!(blocks.contains(&late)),
            Err(error) => assert!(matches!(error, StorageError::NotFound(_))),
        }
    }
}

#[tokio::test]
async fn a_restored_page_goes_last_when_a_sibling_took_its_position() {
    let storage = storage().await;
    let parent = storage.create_page(None).await.unwrap();
    let first = storage.create_page(Some(&parent.id)).await.unwrap();
    storage.create_page(Some(&parent.id)).await.unwrap();
    storage.trash_page(&first.id).await.unwrap();
    let taker = storage.create_page(Some(&parent.id)).await.unwrap();
    storage
        .db
        .query("UPDATE type::record('page', $id) SET position = 0.0")
        .bind(("id", taker.id.clone()))
        .await
        .unwrap()
        .check()
        .unwrap();

    let restored = storage.restore_page(&first.id).await.unwrap();

    let siblings: Vec<Page> = storage
        .list_pages()
        .await
        .unwrap()
        .into_iter()
        .filter(|page| page.parent_id.as_deref() == Some(parent.id.as_str()))
        .collect();
    let max = siblings
        .iter()
        .map(|page| page.position)
        .fold(f64::MIN, f64::max);
    assert_eq!(restored.position, max);
    assert!(
        siblings
            .iter()
            .filter(|page| page.id != restored.id)
            .all(|page| page.position != restored.position)
    );
}

#[tokio::test]
async fn pages_with_the_same_title_both_come_back() {
    let storage = storage().await;
    let first = storage.create_page(None).await.unwrap();
    storage.rename_page(&first.id, "Same").await.unwrap();
    storage.trash_page(&first.id).await.unwrap();
    let second = storage.create_page(None).await.unwrap();
    storage.rename_page(&second.id, "Same").await.unwrap();

    storage.restore_page(&first.id).await.unwrap();

    let pages = storage.list_pages().await.unwrap();
    assert_eq!(pages.len(), 2);
    assert!(pages.iter().all(|page| page.title == "Same"));
}

#[tokio::test]
async fn a_leftover_entry_does_not_stop_a_page_from_being_trashed() {
    let storage = storage().await;
    let page = storage.create_page(None).await.unwrap();
    storage
        .db
        .query("CREATE type::record('trash', $id) SET complete = true, groups = 0")
        .bind(("id", page.id.clone()))
        .await
        .unwrap()
        .check()
        .unwrap();

    storage.trash_page(&page.id).await.unwrap();

    assert_eq!(storage.list_trash().await.unwrap().len(), 1);
}

#[tokio::test]
async fn two_moves_of_the_same_page_leave_one_copy_and_lose_nothing() {
    let storage = storage().await;
    let page = storage.create_page(None).await.unwrap();
    storage
        .save_blocks(&page.id, &[paragraph("a", "kept")])
        .await
        .unwrap();

    let (first, second) = tokio::join!(storage.trash_page(&page.id), storage.trash_page(&page.id));

    // One of them found the page gone; neither destroyed the copy.
    assert_eq!(
        [first.is_ok(), second.is_ok()]
            .iter()
            .filter(|ok| **ok)
            .count(),
        1
    );
    assert!(
        [first, second]
            .into_iter()
            .filter_map(Result::err)
            .all(|error| matches!(error, StorageError::NotFound(_)))
    );
    storage.restore_page(&page.id).await.unwrap();
    assert_eq!(storage.load_blocks(&page.id).await.unwrap().len(), 1);
}

#[tokio::test]
async fn a_write_that_started_before_the_move_is_in_the_copy() {
    let storage = std::sync::Arc::new(storage().await);
    let page = storage.create_page(None).await.unwrap();
    storage
        .save_blocks(&page.id, &[paragraph("a", "one")])
        .await
        .unwrap();

    // A write is in flight: it holds the gate shared and has not written yet.
    let in_flight = storage.write_gate.read().await;
    let mover = {
        let storage = storage.clone();
        let id = page.id.clone();
        tokio::spawn(async move { storage.trash_page(&id).await })
    };
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    assert!(!mover.is_finished(), "the move must wait for the write");

    // The write lands, then the move may start.
    storage
        .db
        .query("CREATE block:late SET page = type::record('page', $id), type = 'paragraph'")
        .bind(("id", page.id.clone()))
        .await
        .unwrap()
        .check()
        .unwrap();
    drop(in_flight);
    mover.await.unwrap().unwrap();

    storage.restore_page(&page.id).await.unwrap();
    assert_eq!(count(&storage, "block").await, 2);
}

#[tokio::test]
async fn writers_wait_while_a_page_is_moved_and_run_afterwards() {
    let storage = storage().await;
    let exclusive = storage.write_gate.write().await;

    let blocked = tokio::time::timeout(
        std::time::Duration::from_millis(200),
        storage.create_page(None),
    )
    .await;
    assert!(blocked.is_err(), "create_page must wait for the gate");
    let blocked = tokio::time::timeout(
        std::time::Duration::from_millis(200),
        storage.save_blocks("page", &[]),
    )
    .await;
    assert!(blocked.is_err(), "save_blocks must wait for the gate");

    drop(exclusive);
    storage.create_page(None).await.unwrap();
}

/// A database on disk with a page, a child and a block, and a crash simulated
/// by `crash`, which gets the storage and the id of the page. Returns the
/// storage reopened through `Storage::open`, which recovers.
async fn crashed_and_reopened<F, Fut>(crash: F) -> (Storage, String, String, tempfile::TempDir)
where
    F: FnOnce(std::sync::Arc<Storage>, String, String) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("db");
    let storage = std::sync::Arc::new(Storage::open(&path).await.unwrap());
    let page = storage.create_page(None).await.unwrap();
    let child = storage.create_page(Some(&page.id)).await.unwrap();
    storage
        .save_blocks(&child.id, &[paragraph("c1", "kept")])
        .await
        .unwrap();

    crash(storage.clone(), page.id.clone(), child.id.clone()).await;
    drop(storage);

    let reopened = super::super::tests::reopen(&path).await;
    (reopened, page.id, child.id, directory)
}

#[tokio::test]
async fn opening_rolls_back_a_move_that_stopped_after_the_copy() {
    let (storage, page, child, _directory) = crashed_and_reopened(|storage, page, _| async move {
        unfinished_trash(&storage, &page, false).await;
    })
    .await;

    assert_eq!(ids(&storage).await.len(), 2);
    assert_eq!(storage.load_blocks(&child).await.unwrap().len(), 1);
    assert_eq!(count(&storage, "trash").await, 0);
    assert!(storage.find_page(&page).await.unwrap().is_some());
}

#[tokio::test]
async fn opening_rolls_back_a_move_that_stopped_after_the_delete() {
    let (storage, _page, child, _directory) = crashed_and_reopened(|storage, page, _| async move {
        unfinished_trash(&storage, &page, true).await;
    })
    .await;

    assert_eq!(ids(&storage).await.len(), 2);
    assert_eq!(storage.load_blocks(&child).await.unwrap().len(), 1);
    assert_eq!(count(&storage, "trash").await, 0);
}

#[tokio::test]
async fn opening_rolls_forward_a_restore_that_stopped_half_way() {
    let (storage, page, child, _directory) = crashed_and_reopened(|storage, page, _| async move {
        storage.trash_page(&page).await.unwrap();
        // The restore marked the entry and inserted only the pages.
        storage
            .db
            .query(
                "UPDATE type::record('trash', $id) SET restoring = true;
                 LET $rows = (SELECT VALUE data FROM trash_item WHERE tb = 'page');
                 INSERT IGNORE INTO page $rows;",
            )
            .bind(("id", page))
            .await
            .unwrap()
            .check()
            .unwrap();
    })
    .await;

    assert_eq!(ids(&storage).await.len(), 2);
    assert_eq!(storage.load_blocks(&child).await.unwrap().len(), 1);
    assert_eq!(count(&storage, "trash").await, 0);
    assert_eq!(count(&storage, "trash_item").await, 0);

    // Trashing the page again still has everything to move.
    storage.trash_page(&page).await.unwrap();
    storage.restore_page(&page).await.unwrap();
    assert_eq!(storage.load_blocks(&child).await.unwrap().len(), 1);
}

#[tokio::test]
async fn opening_finishes_a_purge_that_stopped_half_way() {
    let (storage, page, _child, _directory) = crashed_and_reopened(|storage, page, _| async move {
        storage.trash_page(&page).await.unwrap();
        storage
            .db
            .query(
                "UPDATE type::record('trash', $id) SET purging = true;
                 DELETE (SELECT VALUE id FROM trash_item LIMIT 1);",
            )
            .bind(("id", page))
            .await
            .unwrap()
            .check()
            .unwrap();
    })
    .await;

    assert_eq!(count(&storage, "trash").await, 0);
    assert_eq!(count(&storage, "trash_item").await, 0);
    assert!(storage.find_page(&page).await.unwrap().is_none());
}

#[tokio::test]
async fn a_restore_that_stops_after_the_page_is_back_is_not_trashed_destructively() {
    // The page is live again, the entry is still there: the state a crash
    // between the restore and its cleanup leaves behind.
    let storage = storage().await;
    let page = storage.create_page(None).await.unwrap();
    storage
        .save_blocks(&page.id, &[paragraph("a", "kept")])
        .await
        .unwrap();
    storage.trash_page(&page.id).await.unwrap();
    storage
        .db
        .query(
            "UPDATE type::record('trash', $id) SET restoring = true;
             LET $rows = (SELECT VALUE data FROM trash_item WHERE tb = 'page');
             INSERT IGNORE INTO page $rows;",
        )
        .bind(("id", page.id.clone()))
        .await
        .unwrap()
        .check()
        .unwrap();

    storage.trash_page(&page.id).await.unwrap();
    storage.restore_page(&page.id).await.unwrap();

    assert_eq!(storage.load_blocks(&page.id).await.unwrap().len(), 1);
}

/// Moves `rows` rows with a block each through the trash and prints the time
/// of each step: archive (copy), delete of the originals, restore.
async fn measure(rows: usize) {
    use std::time::Instant;

    let storage = storage().await;
    let database = storage.create_database(None).await.unwrap().page.id;
    run_with_pages(
        &storage,
        &[("database", &database)],
        &format!(
            "FOR $index IN 0..{rows} {{
                 LET $row = CREATE page SET title = 'row', parent = $database,
                     database = $database, position = <float> $index;
                 CREATE block SET page = $row[0].id, type = 'paragraph', text = 'text';
             }};"
        ),
    )
    .await;

    let started = Instant::now();
    let ids_below = storage.subtree(&database).await.unwrap();
    storage
        .db
        .query("CREATE type::record('trash', $id) SET groups = $groups, page_count = 1")
        .bind(("id", database.clone()))
        .bind(("groups", ids_below.chunks(GROUP).count() as i64))
        .await
        .unwrap()
        .check()
        .unwrap();
    for (grp, group) in ids_below.chunks(GROUP).enumerate() {
        storage
            .archive_group(&database, grp, group, &ids_below)
            .await
            .unwrap();
    }
    let archived = started.elapsed();

    let started = Instant::now();
    storage.delete_page(&database).await.unwrap();
    let deleted = started.elapsed();
    storage.mark_complete(&database).await.unwrap();

    let started = Instant::now();
    storage.restore_page(&database).await.unwrap();
    let restored = started.elapsed();
    assert_eq!(count(&storage, "page").await, rows as i64 + 1);

    println!("ROWS {rows}: archive {archived:?}, delete {deleted:?}, restore {restored:?}");
}

/// Run with `cargo test --profile benchmark -- --ignored --nocapture scaling`.
#[tokio::test]
#[ignore = "benchmark, run on demand"]
async fn trash_time_scales_with_the_number_of_rows() {
    for rows in [2_500, 5_000, 10_000] {
        measure(rows).await;
    }
}
