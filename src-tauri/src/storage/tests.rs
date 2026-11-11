use surrealdb::types::SurrealValue;

use super::migrations::{self, MIGRATIONS, Migration};
use super::{Storage, StorageError};

const LATEST: u32 = 1;

async fn storage() -> Storage {
    Storage::open_in_memory()
        .await
        .expect("in-memory storage opens")
}

/// Runs statements that are expected to succeed.
async fn run(storage: &Storage, statements: &str) {
    storage
        .db
        .query(statements)
        .await
        .expect("query runs")
        .check()
        .expect("statements succeed");
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

/// Opens a database that was just closed. The engine releases its file lock
/// shortly after the handle is dropped, so this retries for a moment.
async fn reopen(path: &std::path::Path) -> Storage {
    for _ in 0..100 {
        if let Ok(storage) = Storage::open(path).await {
            return storage;
        }
        tokio::task::yield_now().await;
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    Storage::open(path)
        .await
        .expect("the database can be reopened")
}

#[tokio::test]
async fn a_fresh_database_ends_at_the_latest_schema_version() {
    let storage = storage().await;

    assert_eq!(
        migrations::current_version(&storage.db).await.unwrap(),
        LATEST
    );
    assert_eq!(MIGRATIONS.last().unwrap().version, LATEST);
}

#[tokio::test]
async fn migration_versions_are_consecutive() {
    for (index, migration) in MIGRATIONS.iter().enumerate() {
        assert_eq!(migration.version as usize, index + 1, "{}", migration.name);
    }
}

#[tokio::test]
async fn running_the_migrations_again_changes_nothing() {
    let storage = storage().await;

    migrations::run(&storage.db, MIGRATIONS).await.unwrap();

    assert_eq!(count(&storage, "migration").await, i64::from(LATEST));
}

#[tokio::test]
async fn a_database_from_a_newer_app_version_is_refused() {
    let storage = storage().await;
    run(
        &storage,
        "CREATE migration SET version = 99, name = 'from the future'",
    )
    .await;

    let error = migrations::run(&storage.db, MIGRATIONS).await.unwrap_err();

    assert!(matches!(
        error,
        StorageError::SchemaTooNew {
            found: 99,
            supported: LATEST
        }
    ));
}

#[tokio::test]
async fn a_failing_migration_leaves_no_trace() {
    let storage = storage().await;
    let broken = [Migration {
        version: LATEST + 1,
        name: "broken",
        sql: "DEFINE TABLE half_done SCHEMAFULL; THROW 'boom';",
    }];
    let all: Vec<&Migration> = MIGRATIONS.iter().chain(broken.iter()).collect();
    let all: Vec<Migration> = all
        .into_iter()
        .map(|m| Migration {
            version: m.version,
            name: m.name,
            sql: m.sql,
        })
        .collect();

    assert!(migrations::run(&storage.db, &all).await.is_err());

    assert_eq!(
        migrations::current_version(&storage.db).await.unwrap(),
        LATEST
    );
}

#[tokio::test]
async fn data_survives_closing_and_reopening_the_database() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("db");

    let first = Storage::open(&path).await.unwrap();
    run(&first, "CREATE page:kept SET title = 'Still here'").await;
    drop(first);

    let second = reopen(&path).await;
    let title: Option<String> = second
        .db
        .query("SELECT VALUE title FROM ONLY page:kept")
        .await
        .unwrap()
        .take(0)
        .unwrap();

    assert_eq!(title.as_deref(), Some("Still here"));
}

#[tokio::test]
async fn a_block_needs_a_page() {
    let storage = storage().await;

    let result = storage
        .db
        .query("CREATE block:orphan SET type = 'paragraph'")
        .await
        .unwrap()
        .check();

    assert!(result.is_err());
}

#[tokio::test]
async fn block_props_and_content_keep_their_nested_shape() {
    let storage = storage().await;
    run(
        &storage,
        "CREATE page:a SET title = 'A';
         CREATE block:b SET page = page:a, type = 'heading',
             props = { level: 2, textAlignment: 'left' },
             content = [{ type: 'text', text: 'Hello', styles: { bold: true } }];",
    )
    .await;

    #[derive(SurrealValue)]
    struct Stored {
        level: i64,
        bold: bool,
    }
    let stored: Option<Stored> = storage
        .db
        .query("SELECT props.level AS level, content[0].styles.bold AS bold FROM ONLY block:b")
        .await
        .unwrap()
        .take(0)
        .unwrap();
    let stored = stored.unwrap();

    assert_eq!(stored.level, 2);
    assert!(stored.bold);
}

#[tokio::test]
async fn deleting_a_page_removes_its_subpages_blocks_and_links() {
    let storage = storage().await;
    run(
        &storage,
        "CREATE page:parent SET title = 'Parent';
         CREATE page:child SET title = 'Child', parent = page:parent;
         CREATE page:other SET title = 'Other';
         CREATE block:p1 SET page = page:parent, type = 'paragraph';
         CREATE block:p2 SET page = page:parent, type = 'paragraph', parent = block:p1;
         CREATE block:c1 SET page = page:child, type = 'paragraph';
         CREATE block:o1 SET page = page:other, type = 'paragraph';
         RELATE page:parent->links_to->page:other SET block = block:p1;
         RELATE page:other->links_to->page:child SET block = block:o1;",
    )
    .await;

    run(&storage, "DELETE page:parent").await;

    assert_eq!(
        count(&storage, "page").await,
        1,
        "only the unrelated page is left"
    );
    assert_eq!(
        count(&storage, "block").await,
        1,
        "only the unrelated page's block is left"
    );
    assert_eq!(count(&storage, "links_to").await, 0);
}

#[tokio::test]
async fn deleting_a_block_removes_its_children_and_its_links() {
    let storage = storage().await;
    run(
        &storage,
        "CREATE page:a SET title = 'A';
         CREATE page:b SET title = 'B';
         CREATE block:outer SET page = page:a, type = 'bulletListItem';
         CREATE block:inner SET page = page:a, type = 'bulletListItem', parent = block:outer;
         RELATE page:a->links_to->page:b SET block = block:inner;",
    )
    .await;

    run(&storage, "DELETE block:outer").await;

    assert_eq!(count(&storage, "block").await, 0);
    assert_eq!(count(&storage, "links_to").await, 0);
    assert_eq!(count(&storage, "page").await, 2);
}

#[tokio::test]
async fn backlinks_are_the_incoming_links_of_a_page() {
    let storage = storage().await;
    run(
        &storage,
        "CREATE page:target SET title = 'Target';
         CREATE page:one SET title = 'One';
         CREATE page:two SET title = 'Two';
         CREATE page:unrelated SET title = 'Unrelated';
         CREATE block:b1 SET page = page:one, type = 'paragraph';
         CREATE block:b2 SET page = page:two, type = 'paragraph';
         RELATE page:one->links_to->page:target SET block = block:b1;
         RELATE page:two->links_to->page:target SET block = block:b2;",
    )
    .await;

    let mut titles: Vec<String> = storage
        .db
        .query("SELECT VALUE title FROM page WHERE ->links_to->page CONTAINS page:target")
        .await
        .unwrap()
        .take(0)
        .unwrap();
    titles.sort();
    let mut via_graph: Vec<String> = storage
        .db
        .query("RETURN page:target<-links_to<-page.title")
        .await
        .unwrap()
        .take(0)
        .unwrap();
    via_graph.sort();

    assert_eq!(titles, ["One", "Two"]);
    assert_eq!(via_graph, ["One", "Two"]);
}

#[tokio::test]
async fn full_text_search_finds_block_text_and_page_titles() {
    let storage = storage().await;
    run(
        &storage,
        "CREATE page:recipes SET title = 'Recipes';
         CREATE page:travel SET title = 'Travel plans';
         CREATE block:r1 SET page = page:recipes, type = 'paragraph', text = 'Sourdough needs a long fermentation';
         CREATE block:t1 SET page = page:travel, type = 'paragraph', text = 'Book the night train to Vienna';",
    )
    .await;

    let blocks: Vec<String> = storage
        .db
        .query("SELECT VALUE search::highlight('<b>', '</b>', 0) FROM block WHERE text @0@ 'FERMENTATION'")
        .await
        .unwrap()
        .take(0)
        .unwrap();
    let pages: Vec<String> = storage
        .db
        .query("SELECT VALUE title FROM page WHERE title @@ 'travel'")
        .await
        .unwrap()
        .take(0)
        .unwrap();

    assert_eq!(blocks, ["Sourdough needs a long <b>fermentation</b>"]);
    assert_eq!(pages, ["Travel plans"]);
}

/// The repository layer is the only place that may know SurrealDB.
#[test]
fn only_the_storage_module_mentions_surrealdb() {
    fn visit(directory: &std::path::Path, offenders: &mut Vec<String>) {
        for entry in std::fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                if path.file_name().unwrap() != "storage" {
                    visit(&path, offenders);
                }
            } else if path.extension().is_some_and(|extension| extension == "rs")
                && std::fs::read_to_string(&path)
                    .unwrap()
                    .contains("surrealdb")
            {
                offenders.push(path.display().to_string());
            }
        }
    }

    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut offenders = Vec::new();
    visit(&source, &mut offenders);

    assert!(offenders.is_empty(), "SurrealDB leaked into: {offenders:?}");
}
