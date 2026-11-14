use surrealdb::Surreal;
use surrealdb::engine::local::SurrealKv;
use surrealdb::types::SurrealValue;

use super::migrations::{self, MIGRATIONS, Migration};
use super::{DATABASE, NAMESPACE, Storage, StorageError};
use crate::domain::PageKind;

const LATEST: u32 = 5;

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

/// Runs statements with a variable bound to the record of each named page:
/// `("books", id)` makes `$books` the page with that id.
pub(super) async fn run_with_pages(storage: &Storage, pages: &[(&str, &str)], statements: &str) {
    let mut bindings = String::new();
    for (name, _) in pages {
        bindings.push_str(&format!(
            "LET ${name} = type::record('page', ${name}_id);\n"
        ));
    }

    let mut query = storage.db.query(format!("{bindings}{statements}"));
    for (name, id) in pages {
        query = query.bind((format!("{name}_id"), (*id).to_owned()));
    }
    query
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
async fn a_database_at_version_4_migrates_and_its_pages_load_unchanged() {
    /// What schema version 4 stored for a page.
    #[derive(Debug, PartialEq, SurrealValue)]
    struct Stored {
        id: String,
        title: String,
        parent_id: Option<String>,
        position: f64,
        created_at: String,
        updated_at: String,
    }
    const STORED: &str = "SELECT record::id(id) AS id, title,
        IF parent = NONE { NONE } ELSE { record::id(parent) } AS parent_id, position,
        <string> created_at AS created_at, <string> updated_at AS updated_at
        FROM page ORDER BY id";

    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("db");

    // A database as the last release left it: schema version 4, with pages.
    let old = Surreal::new::<SurrealKv>(path.as_path()).await.unwrap();
    old.use_ns(NAMESPACE).use_db(DATABASE).await.unwrap();
    migrations::run(&old, &MIGRATIONS[..4]).await.unwrap();
    assert_eq!(migrations::current_version(&old).await.unwrap(), 4);
    old.query(
        "CREATE page:parent SET title = 'Parent', parent = NONE, position = 0.0;
         CREATE page:child SET title = 'Child', parent = page:parent, position = 0.0;
         CREATE page:other SET title = '', parent = NONE, position = 1.0;
         CREATE block:b1 SET page = page:child, type = 'paragraph', text = 'Kept';
         RELATE page:child->links_to->page:other SET block = block:b1;",
    )
    .await
    .unwrap()
    .check()
    .unwrap();
    let before: Vec<Stored> = old.query(STORED).await.unwrap().take(0).unwrap();
    assert_eq!(before.len(), 3);
    drop(old);

    let storage = reopen(&path).await;

    assert_eq!(
        migrations::current_version(&storage.db).await.unwrap(),
        LATEST
    );
    let after: Vec<Stored> = storage.db.query(STORED).await.unwrap().take(0).unwrap();
    assert_eq!(after, before, "the migration does not rewrite pages");
    let fields: Vec<String> = storage
        .db
        .query(
            "RETURN array::sort(array::distinct(array::flatten(
                 SELECT VALUE object::keys($this) FROM page
             )))",
        )
        .await
        .unwrap()
        .take(0)
        .unwrap();
    assert!(fields.iter().any(|field| field == "title"), "{fields:?}");
    assert!(
        !fields
            .iter()
            .any(|field| ["kind", "database", "props"].contains(&field.as_str())),
        "old pages get none of the new fields, found {fields:?}"
    );

    let pages = storage.list_pages().await.unwrap();
    let listed: Vec<(&str, &str, Option<&str>, f64)> = pages
        .iter()
        .map(|page| {
            (
                page.id.as_str(),
                page.title.as_str(),
                page.parent_id.as_deref(),
                page.position,
            )
        })
        .collect();
    assert_eq!(pages.len(), 3);
    for expected in [
        ("parent", "Parent", None, 0.0),
        ("child", "Child", Some("parent"), 0.0),
        ("other", "", None, 1.0),
    ] {
        assert!(listed.contains(&expected), "{expected:?} in {listed:?}");
    }
    for page in &pages {
        assert_eq!(page.kind, PageKind::Page, "{}", page.id);
        assert_eq!(page.database_id, None, "{}", page.id);
    }
    assert_eq!(storage.load_blocks("child").await.unwrap().len(), 1);
    assert_eq!(storage.list_backlinks("other").await.unwrap().len(), 1);

    // The old pages and the new model work together.
    let database = storage.create_database(Some("parent")).await.unwrap();
    assert_eq!(database.page.kind, PageKind::Database);
    assert!(database.page.position > 0.0);
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
async fn deleting_a_database_removes_its_rows_properties_and_views() {
    let storage = storage().await;
    let page = storage.create_page(None).await.unwrap();
    let authors = storage.create_database(None).await.unwrap().page;
    let books = storage.create_database(Some(&page.id)).await.unwrap().page;
    run_with_pages(
        &storage,
        &[("authors", &authors.id), ("books", &books.id)],
        "CREATE page:author SET title = 'Herbert', parent = $authors, database = $authors;
         CREATE page:dune SET title = 'Dune', parent = $books, database = $books,
             props = { pages: 612 };
         CREATE page:emma SET title = 'Emma', parent = $books, database = $books;
         CREATE page:notes SET title = 'Notes', parent = page:dune;
         CREATE block:d1 SET page = page:dune, type = 'paragraph';
         CREATE block:n1 SET page = page:notes, type = 'paragraph';

         CREATE property:born SET database = $authors, name = 'Born', type = 'date';
         CREATE property:wrote SET database = $authors, name = 'Wrote', type = 'relation',
             target = $books;
         CREATE property:pages SET database = $books, name = 'Pages', type = 'number';
         CREATE property:author SET database = $books, name = 'Author', type = 'relation',
             target = $authors;
         CREATE property:sequel SET database = $books, name = 'Sequel', type = 'relation',
             target = $books;

         CREATE view:books_table SET database = $books, name = 'Table',
             config = { type: 'table' };
         CREATE view:books_board SET database = $books, name = 'Board', position = 1.0,
             config = { type: 'board', groupBy: 'author' };

         RELATE page:dune->row_link->page:author SET property = property:author;
         RELATE page:dune->row_link->page:emma SET property = property:sequel;
         RELATE page:author->row_link->page:dune SET property = property:wrote;
         RELATE page:author->row_link->page:emma SET property = property:wrote, position = 1.0;",
    )
    .await;
    assert_eq!(count(&storage, "row_link").await, 4);

    storage.delete_page(&books.id).await.unwrap();

    let mut left: Vec<String> = storage
        .list_pages()
        .await
        .unwrap()
        .into_iter()
        .map(|page| page.id)
        .collect();
    left.sort();
    let mut expected = vec![page.id, authors.id.clone(), "author".to_owned()];
    expected.sort();
    assert_eq!(left, expected, "the rows and their subpages are gone");
    assert_eq!(count(&storage, "block").await, 0);
    assert_eq!(count(&storage, "view").await, 1);
    assert_eq!(count(&storage, "row_link").await, 0);

    let properties: Vec<String> = storage
        .load_database(&authors.id)
        .await
        .unwrap()
        .properties
        .into_iter()
        .map(|property| property.id)
        .collect();
    assert_eq!(
        properties,
        ["born"],
        "the relation that pointed at the deleted database is gone too"
    );
    assert_eq!(count(&storage, "property").await, 1);
}

#[tokio::test]
async fn deleting_a_row_removes_the_relation_edges_at_both_ends() {
    let storage = storage().await;
    let database = storage.create_database(None).await.unwrap().page;
    run_with_pages(
        &storage,
        &[("database", &database.id)],
        "CREATE page:a SET title = 'A', parent = $database, database = $database;
         CREATE page:b SET title = 'B', parent = $database, database = $database;
         CREATE page:c SET title = 'C', parent = $database, database = $database;
         CREATE property:related SET database = $database, name = 'Related', type = 'relation',
             target = $database;
         RELATE page:a->row_link->page:b SET property = property:related;
         RELATE page:b->row_link->page:c SET property = property:related;
         RELATE page:a->row_link->page:c SET property = property:related, position = 1.0;",
    )
    .await;

    storage.delete_page("b").await.unwrap();

    assert_eq!(count(&storage, "row_link").await, 1);
    assert_eq!(count(&storage, "property").await, 1);
    assert_eq!(count(&storage, "page").await, 3);
}

#[tokio::test]
async fn deleting_a_property_removes_its_relation_edges() {
    let storage = storage().await;
    let database = storage.create_database(None).await.unwrap().page;
    run_with_pages(
        &storage,
        &[("database", &database.id)],
        "CREATE page:a SET title = 'A', parent = $database, database = $database;
         CREATE page:b SET title = 'B', parent = $database, database = $database;
         CREATE property:first SET database = $database, name = 'First', type = 'relation',
             target = $database;
         CREATE property:second SET database = $database, name = 'Second', type = 'relation',
             target = $database;
         RELATE page:a->row_link->page:b SET property = property:first;
         RELATE page:b->row_link->page:a SET property = property:first;
         RELATE page:a->row_link->page:b SET property = property:second;",
    )
    .await;

    run(&storage, "DELETE property:first").await;

    assert_eq!(count(&storage, "row_link").await, 1);
    assert_eq!(count(&storage, "page").await, 3);
}

#[tokio::test]
async fn the_schema_refuses_unknown_page_kinds_and_property_types() {
    let storage = storage().await;
    run(&storage, "CREATE page:db SET kind = 'database'").await;

    for statement in [
        "CREATE page:odd SET kind = 'spreadsheet'",
        "CREATE property:odd SET database = page:db, type = 'checkbox'",
        "CREATE property:orphan SET type = 'text'",
        "CREATE property:half SET database = page:db, type = 'select', options = [{ id: 'a' }]",
        "CREATE view:orphan SET name = 'Table', config = {}",
    ] {
        let result = storage.db.query(statement).await.unwrap().check();
        assert!(result.is_err(), "{statement}");
    }
}

#[tokio::test]
async fn cell_values_keep_their_shape_and_a_key_is_removed_by_setting_none() {
    let storage = storage().await;
    run(
        &storage,
        "CREATE page:db SET kind = 'database';
         CREATE page:row SET parent = page:db, database = page:db,
             props = { name: 'Dune', pages: 612, read: '2026-11-13' };
         UPDATE page:row SET props['pages'] = NONE;",
    )
    .await;

    #[derive(SurrealValue)]
    struct Cells {
        name: Option<String>,
        pages: Option<i64>,
        read: Option<String>,
        keys: Vec<String>,
    }
    let cells: Option<Cells> = storage
        .db
        .query(
            "SELECT props.name AS name, props.pages AS pages, props.read AS read,
                 array::sort(object::keys(props)) AS keys FROM ONLY page:row",
        )
        .await
        .unwrap()
        .take(0)
        .unwrap();
    let cells = cells.unwrap();

    assert_eq!(cells.name.as_deref(), Some("Dune"));
    assert_eq!(cells.pages, None);
    assert_eq!(cells.read.as_deref(), Some("2026-11-13"));
    assert_eq!(cells.keys, ["name", "read"]);
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
