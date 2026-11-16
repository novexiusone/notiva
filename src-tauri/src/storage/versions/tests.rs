use serde_json::{Map, json};

use super::*;

fn paragraph(id: &str, text: &str) -> Block {
    Block {
        id: id.into(),
        kind: "paragraph".into(),
        props: Map::new(),
        content: Some(json!([{ "type": "text", "text": text, "styles": {} }])),
        children: Vec::new(),
    }
}

async fn storage_with_page() -> (Storage, String) {
    let storage = Storage::open_in_memory().await.unwrap();
    let page = storage.create_page(None).await.unwrap();
    (storage, page.id)
}

/// Makes the versions of a page look `age` old, so that the next save is due.
async fn age_versions(storage: &Storage, page_id: &str, age: &str) {
    storage
        .db
        .query(format!(
            // The field is read-only in the app; a test has to backdate it.
            "DEFINE FIELD OVERWRITE created_at ON page_version TYPE datetime DEFAULT time::now();
             UPDATE page_version SET created_at = time::now() - {age}
                 WHERE page = type::record('page', $id)"
        ))
        .bind(("id", page_id.to_owned()))
        .await
        .unwrap()
        .check()
        .unwrap();
}

#[tokio::test]
async fn saving_keeps_the_overwritten_state_at_most_once_per_interval() {
    let (storage, id) = storage_with_page().await;

    // The first save has nothing to keep; the second keeps the first.
    storage
        .save_blocks(&id, &[paragraph("a", "one")])
        .await
        .unwrap();
    assert!(storage.list_page_versions(&id).await.unwrap().is_empty());
    storage
        .save_blocks(&id, &[paragraph("a", "two")])
        .await
        .unwrap();
    // Within the interval nothing more is kept.
    storage
        .save_blocks(&id, &[paragraph("a", "three")])
        .await
        .unwrap();

    let versions = storage.list_page_versions(&id).await.unwrap();
    assert_eq!(versions.len(), 1);
    assert_eq!(versions[0].preview, "one");
    assert_eq!(versions[0].block_count, 1);

    age_versions(&storage, &id, "6m").await;
    storage
        .save_blocks(&id, &[paragraph("a", "four")])
        .await
        .unwrap();
    let versions = storage.list_page_versions(&id).await.unwrap();
    assert_eq!(versions.len(), 2);
    assert_eq!(versions[0].preview, "three");
}

#[tokio::test]
async fn a_save_without_changes_keeps_nothing() {
    let (storage, id) = storage_with_page().await;
    storage
        .save_blocks(&id, &[paragraph("a", "one")])
        .await
        .unwrap();

    storage
        .save_blocks(&id, &[paragraph("a", "one")])
        .await
        .unwrap();

    assert!(storage.list_page_versions(&id).await.unwrap().is_empty());
}

#[tokio::test]
async fn a_version_can_be_read_and_restored_and_restoring_can_be_undone() {
    let (storage, id) = storage_with_page().await;
    storage
        .save_blocks(&id, &[paragraph("a", "one")])
        .await
        .unwrap();
    storage
        .save_blocks(&id, &[paragraph("a", "two"), paragraph("b", "more")])
        .await
        .unwrap();
    let first = storage.list_page_versions(&id).await.unwrap().remove(0);

    let content = storage.load_page_version(&id, &first.id).await.unwrap();
    assert_eq!(content.blocks, [paragraph("a", "one")]);

    let blocks = storage.restore_page_version(&id, &first.id).await.unwrap();
    assert_eq!(blocks, [paragraph("a", "one")]);
    assert_eq!(storage.load_blocks(&id).await.unwrap(), blocks);

    // The state before the restore is a version now.
    let versions = storage.list_page_versions(&id).await.unwrap();
    assert_eq!(versions.len(), 2);
    let undo = storage
        .restore_page_version(&id, &versions[0].id)
        .await
        .unwrap();
    assert_eq!(undo, [paragraph("a", "two"), paragraph("b", "more")]);
}

#[tokio::test]
async fn restoring_updates_search() {
    let (storage, id) = storage_with_page().await;
    storage
        .save_blocks(&id, &[paragraph("a", "walrus")])
        .await
        .unwrap();
    storage
        .save_blocks(&id, &[paragraph("a", "otter")])
        .await
        .unwrap();
    let version = storage.list_page_versions(&id).await.unwrap().remove(0);

    storage
        .restore_page_version(&id, &version.id)
        .await
        .unwrap();

    assert_eq!(storage.search("walrus").await.unwrap().len(), 1);
    assert!(storage.search("otter").await.unwrap().is_empty());
}

#[tokio::test]
async fn the_oldest_versions_are_pruned() {
    let (storage, id) = storage_with_page().await;
    storage
        .save_blocks(&id, &[paragraph("a", "start")])
        .await
        .unwrap();
    for index in 0..(MAX_VERSIONS + 5) {
        age_versions(&storage, &id, "6m").await;
        storage
            .save_blocks(&id, &[paragraph("a", &format!("text {index}"))])
            .await
            .unwrap();
    }

    let versions = storage.list_page_versions(&id).await.unwrap();

    assert_eq!(versions.len(), MAX_VERSIONS);
    assert!(versions.iter().all(|version| version.preview != "start"));
}

#[tokio::test]
async fn unknown_pages_and_versions_are_not_found() {
    let (storage, id) = storage_with_page().await;
    let other = storage.create_page(None).await.unwrap();
    storage
        .save_blocks(&id, &[paragraph("a", "one")])
        .await
        .unwrap();
    storage
        .save_blocks(&id, &[paragraph("a", "two")])
        .await
        .unwrap();
    let version = storage.list_page_versions(&id).await.unwrap().remove(0);

    assert!(matches!(
        storage.list_page_versions("missing").await,
        Err(StorageError::NotFound(_))
    ));
    assert!(matches!(
        storage.load_page_version(&id, "missing").await,
        Err(StorageError::NotFound(_))
    ));
    // A version belongs to its own page only.
    assert!(matches!(
        storage.load_page_version(&other.id, &version.id).await,
        Err(StorageError::NotFound(_))
    ));
}

#[tokio::test]
async fn versions_go_with_a_deleted_page_and_come_back_with_a_trashed_one() {
    let (storage, id) = storage_with_page().await;
    storage
        .save_blocks(&id, &[paragraph("a", "one")])
        .await
        .unwrap();
    storage
        .save_blocks(&id, &[paragraph("a", "two")])
        .await
        .unwrap();

    storage.trash_page(&id).await.unwrap();
    storage.restore_page(&id).await.unwrap();
    assert_eq!(storage.list_page_versions(&id).await.unwrap().len(), 1);

    storage.delete_page(&id).await.unwrap();
    let left: Option<i64> = storage
        .db
        .query("RETURN count(SELECT * FROM page_version)")
        .await
        .unwrap()
        .take(0)
        .unwrap();
    assert_eq!(left, Some(0));
}
