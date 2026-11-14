//! A benchmark of the queries the app depends on, against a database on disk
//! with 10,000 pages and, later in the run, one database with 10,000 rows.
//!
//! Run it with:
//!
//! ```bash
//! cargo test --manifest-path src-tauri/Cargo.toml --profile benchmark -- --ignored --nocapture benchmark
//! ```
//!
//! The order matters. The page measurements run first, against the 10,000
//! ordinary pages alone. Then the database is seeded and measured through the
//! repository methods, the destructive changes run one after the other on
//! different properties and end with deleting the database, and only then
//! are ordinary pages deleted.

use std::fmt::Write as _;
use std::time::{Duration, Instant};

use surrealdb::types::Value;

use super::Storage;
use crate::domain::{Block, CellValue, PropertyType, SELECT_COLORS, SelectOption};

const PAGES: usize = 10_000;
const BLOCKS_PER_PAGE: usize = 20;
const LINKS_PER_PAGE: usize = 3;
const WORDS_PER_BLOCK: usize = 12;
const BATCH: usize = 500;
const SAMPLES: usize = 50;

/// The rows of the one database the benchmark seeds.
const ROWS: usize = 10_000;
/// Blocks on each row, so that deleting rows fires the block events too.
const BLOCKS_PER_ROW: usize = 3;
/// The database has two text, two number, one date and two select properties.
const PROPERTIES: usize = 7;
/// Options of the select `status`; a row holds the option `row % 4`.
const STATUS_OPTIONS: usize = 4;
/// Options of the select `priority`; a row holds the option `row % 3`.
const PRIORITY_OPTIONS: usize = 3;
/// Every fifth row holds a text in `amount` that is not a number.
const NOT_A_NUMBER_EVERY: usize = 5;
/// Samples of the reads that return every row or every page.
const LARGE_SAMPLES: usize = 20;
/// Samples of each cell write and of creating a row.
const WRITE_SAMPLES: usize = 20;

const VOCABULARY: &[&str] = &[
    "meeting",
    "notes",
    "project",
    "garden",
    "recipe",
    "travel",
    "budget",
    "invoice",
    "design",
    "review",
    "sprint",
    "release",
    "holiday",
    "family",
    "reading",
    "journal",
    "idea",
    "draft",
    "research",
    "interview",
    "roadmap",
    "feedback",
    "customer",
    "contract",
    "kitchen",
    "running",
    "weather",
    "library",
    "museum",
    "station",
    "bicycle",
    "concert",
    "teacher",
    "doctor",
    "window",
    "mountain",
    "river",
    "harbour",
    "bridge",
    "market",
    "coffee",
    "bread",
    "cheese",
    "tomato",
    "pepper",
    "lemon",
    "winter",
    "summer",
    "autumn",
    "spring",
];

/// A small deterministic generator so every run produces the same data.
struct Random(u64);

impl Random {
    fn next(&mut self, bound: usize) -> usize {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((self.0 >> 33) as usize) % bound
    }
}

/// How long a query took and how many rows it returned.
type Sample = (Duration, usize);

struct Timings {
    name: &'static str,
    /// `None` for a measurement that is only reported.
    target: Option<Duration>,
    samples: Vec<Sample>,
}

impl Timings {
    fn report(self) -> String {
        let mut durations: Vec<Duration> = self.samples.iter().map(|sample| sample.0).collect();
        durations.sort();
        let median = durations[durations.len() / 2];
        let p95 = durations[(durations.len() * 95 / 100).min(durations.len() - 1)];
        let max = *durations.last().unwrap();
        let fewest = self.samples.iter().map(|sample| sample.1).min().unwrap();
        let most = self.samples.iter().map(|sample| sample.1).max().unwrap();
        let rows = if fewest == most {
            fewest.to_string()
        } else {
            format!("{fewest} to {most}")
        };
        let (target, verdict) = match self.target {
            Some(target) if p95 <= target => (format!("{} ms", target.as_millis()), "ok"),
            Some(target) => (format!("{} ms", target.as_millis()), "over target"),
            None => ("none".to_owned(), "report"),
        };
        format!(
            "| {} | {} | {:.1} ms | {:.1} ms | {:.1} ms | {} | {} |",
            self.name,
            rows,
            median.as_secs_f64() * 1000.0,
            p95.as_secs_f64() * 1000.0,
            max.as_secs_f64() * 1000.0,
            target,
            verdict
        )
    }

    /// A benchmark over empty results would measure nothing.
    fn assert_rows(&self, expected: impl Fn(usize) -> bool) {
        let most = self.samples.iter().map(|sample| sample.1).max().unwrap();
        assert!(expected(most), "{} returned at most {most} rows", self.name);
    }
}

async fn execute(storage: &Storage, statements: String) {
    storage.db.query(statements).await.unwrap().check().unwrap();
}

/// Runs a query and reads its first result. Returns the time both took and
/// the number of rows that came back.
async fn time(storage: &Storage, query: &str, bindings: Vec<(&'static str, String)>) -> Sample {
    let started = Instant::now();
    let mut request = storage.db.query(query);
    for binding in bindings {
        request = request.bind(binding);
    }
    let value: Value = request.await.unwrap().take(0).unwrap();
    let elapsed = started.elapsed();
    let rows = match value {
        Value::Array(rows) => rows.len(),
        Value::None | Value::Null => 0,
        _ => 1,
    };
    (elapsed, rows)
}

async fn seed(storage: &Storage, random: &mut Random) {
    // Pages: 100 top-level pages, every other page hangs below an earlier one.
    for start in (0..PAGES).step_by(BATCH) {
        let mut statement = String::from("INSERT INTO page [");
        for page in start..(start + BATCH).min(PAGES) {
            let parent = if page < 100 {
                "NONE".to_string()
            } else {
                format!("page:p{}", random.next(page))
            };
            let title = format!(
                "{} {} {page}",
                VOCABULARY[random.next(VOCABULARY.len())],
                VOCABULARY[random.next(VOCABULARY.len())]
            );
            write!(
                statement,
                "{{ id: page:p{page}, title: '{title}', parent: {parent}, position: {page}.0 }},"
            )
            .unwrap();
        }
        statement.push_str("] RETURN NONE;");
        execute(storage, statement).await;
    }

    for start in (0..PAGES).step_by(BATCH / 10) {
        let mut statement = String::from("INSERT INTO block [");
        for page in start..(start + BATCH / 10).min(PAGES) {
            for block in 0..BLOCKS_PER_PAGE {
                let text: Vec<&str> = (0..WORDS_PER_BLOCK)
                    .map(|_| VOCABULARY[random.next(VOCABULARY.len())])
                    .collect();
                let text = text.join(" ");
                write!(
                    statement,
                    "{{ id: block:b{page}x{block}, page: page:p{page}, position: {block}.0, \
                     type: 'paragraph', props: {{ textAlignment: 'left' }}, \
                     content: [{{ type: 'text', text: '{text}', styles: {{}} }}], text: '{text}' }},"
                )
                .unwrap();
            }
        }
        statement.push_str("] RETURN NONE;");
        execute(storage, statement).await;
    }

    for start in (0..PAGES).step_by(BATCH) {
        let mut statement = String::from("INSERT RELATION INTO links_to [");
        for page in start..(start + BATCH).min(PAGES) {
            for link in 0..LINKS_PER_PAGE {
                let target = random.next(PAGES);
                write!(
                    statement,
                    "{{ in: page:p{page}, out: page:p{target}, block: block:b{page}x{link} }},"
                )
                .unwrap();
            }
        }
        statement.push_str("] RETURN NONE;");
        execute(storage, statement).await;
    }
}

/// The ids of the seven properties of the seeded database.
struct Properties {
    /// Text, a sentence in every row.
    notes: String,
    /// Text that holds a number, except in every fifth row.
    amount: String,
    pages: String,
    rating: String,
    due: String,
    /// Select with four options.
    status: String,
    /// Select with three options.
    priority: String,
}

fn options(property: &str, count: usize) -> Vec<SelectOption> {
    (0..count)
        .map(|index| SelectOption {
            id: format!("{property}-{index}"),
            name: format!("{property} {index}"),
            color: SELECT_COLORS[index % SELECT_COLORS.len()].to_owned(),
        })
        .collect()
}

async fn create_property(
    storage: &Storage,
    database: &str,
    name: &str,
    kind: PropertyType,
) -> String {
    storage
        .create_property(database, name, kind, None)
        .await
        .unwrap()
        .id
}

/// Creates the database and its properties through the repository, then
/// inserts its rows and their blocks in batches. Each row is what
/// `create_row`, `rename_page`, `set_cell` and `save_blocks` would have
/// written: a page below the database with `database` set, a title, and
/// every cell filled with a value of its property's type.
async fn seed_database(storage: &Storage) -> (String, Properties) {
    let database = storage.create_database(None).await.unwrap().page.id;
    storage.rename_page(&database, "Benchmark").await.unwrap();

    let properties = Properties {
        notes: create_property(storage, &database, "Notes", PropertyType::Text).await,
        amount: create_property(storage, &database, "Amount", PropertyType::Text).await,
        pages: create_property(storage, &database, "Pages", PropertyType::Number).await,
        rating: create_property(storage, &database, "Rating", PropertyType::Number).await,
        due: create_property(storage, &database, "Due", PropertyType::Date).await,
        status: create_property(storage, &database, "Status", PropertyType::Select).await,
        priority: create_property(storage, &database, "Priority", PropertyType::Select).await,
    };
    storage
        .update_property(
            &properties.status,
            None,
            Some(&options("status", STATUS_OPTIONS)),
        )
        .await
        .unwrap();
    storage
        .update_property(
            &properties.priority,
            None,
            Some(&options("priority", PRIORITY_OPTIONS)),
        )
        .await
        .unwrap();

    for start in (0..ROWS).step_by(BATCH) {
        let end = (start + BATCH).min(ROWS);
        let mut statement = String::from(
            "LET $database = type::record('page', $id);
             INSERT INTO page [",
        );
        for row in start..end {
            let amount = if row % NOT_A_NUMBER_EVERY == 0 {
                "n/a".to_owned()
            } else {
                format!("{row}.25")
            };
            // Numbers are floats, as `set_cell` writes them.
            write!(
                statement,
                "{{ id: page:r{row}, title: 'Row {row}', parent: $database, database: $database, \
                 position: {row}.0, props: {{ \"{notes}\": 'Some notes on row {row}', \
                 \"{amount_id}\": '{amount}', \"{pages}\": {row}.0, \"{rating}\": {rating_value}.5, \
                 \"{due}\": '2026-{month:02}-{day:02}', \"{status}\": 'status-{status_value}', \
                 \"{priority}\": 'priority-{priority_value}' }} }},",
                notes = properties.notes,
                amount_id = properties.amount,
                pages = properties.pages,
                rating = properties.rating,
                rating_value = row % 5,
                due = properties.due,
                month = row % 12 + 1,
                day = row % 28 + 1,
                status = properties.status,
                status_value = row % STATUS_OPTIONS,
                priority = properties.priority,
                priority_value = row % PRIORITY_OPTIONS,
            )
            .unwrap();
        }
        statement.push_str("] RETURN NONE;");
        storage
            .db
            .query(statement)
            .bind(("id", database.clone()))
            .await
            .unwrap()
            .check()
            .unwrap();

        let mut statement = String::from("INSERT INTO block [");
        for row in start..end {
            for block in 0..BLOCKS_PER_ROW {
                write!(
                    statement,
                    "{{ id: block:r{row}x{block}, page: page:r{row}, position: {block}.0, \
                     type: 'paragraph', props: {{ textAlignment: 'left' }}, \
                     content: [{{ type: 'text', text: 'Text {block} of row {row}', styles: {{}} }}], \
                     text: 'Text {block} of row {row}' }},"
                )
                .unwrap();
            }
        }
        statement.push_str("] RETURN NONE;");
        execute(storage, statement).await;
    }

    (database, properties)
}

/// A destructive change that runs once.
struct Change {
    name: &'static str,
    /// The cells or rows it touched, to show that it did something.
    touched: String,
    duration: Duration,
}

impl Change {
    fn report(&self) -> String {
        format!(
            "| {} | {} | {:.0} ms |",
            self.name,
            self.touched,
            self.duration.as_secs_f64() * 1000.0
        )
    }
}

fn mebibytes(path: &std::path::Path) -> f64 {
    directory_size(path) as f64 / 1024.0 / 1024.0
}

fn directory_size(path: &std::path::Path) -> u64 {
    std::fs::read_dir(path)
        .unwrap()
        .map(|entry| {
            let path = entry.unwrap().path();
            if path.is_dir() {
                directory_size(&path)
            } else {
                path.metadata().unwrap().len()
            }
        })
        .sum()
}

#[tokio::test]
#[ignore = "benchmark, run on demand"]
async fn benchmark() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("db");
    let storage = Storage::open(&path).await.unwrap();
    let mut random = Random(42);

    let started = Instant::now();
    seed(&storage, &mut random).await;
    let seeding = started.elapsed();
    let size_pages = mebibytes(&path);

    let mut load_page = Vec::new();
    let mut backlinks = Vec::new();
    for _ in 0..SAMPLES {
        let page = format!("p{}", random.next(PAGES));
        load_page.push(
            time(
                &storage,
                "SELECT * FROM block WHERE page = type::record('page', $page) ORDER BY position",
                vec![("page", page.clone())],
            )
            .await,
        );
        backlinks.push(
            time(
                &storage,
                "SELECT id, title FROM page WHERE id IN (SELECT VALUE in FROM links_to WHERE out = type::record('page', $page))",
                vec![("page", page.clone())],
            )
            .await,
        );
    }

    let mut backlinks_graph = Vec::new();
    for _ in 0..SAMPLES {
        let page = format!("p{}", random.next(PAGES));
        backlinks_graph.push(
            time(
                &storage,
                "RETURN type::record('page', $page)<-links_to<-page.{ id, title }",
                vec![("page", page)],
            )
            .await,
        );
    }

    let mut tree = Vec::new();
    for _ in 0..10 {
        tree.push(
            time(
                &storage,
                "SELECT id, title, parent, position FROM page",
                vec![],
            )
            .await,
        );
    }

    // What the app runs for the sidebar: more fields, ids turned into
    // strings, ordered by position, read into `Page`.
    let mut list_pages = Vec::new();
    for _ in 0..LARGE_SAMPLES {
        let started = Instant::now();
        let pages = storage.list_pages().await.unwrap();
        list_pages.push((started.elapsed(), pages.len()));
    }

    let mut search = Vec::new();
    for _ in 0..SAMPLES {
        let term = VOCABULARY[random.next(VOCABULARY.len())].to_string();
        search.push(
            time(
                &storage,
                "SELECT id, page, search::highlight('<b>', '</b>', 0) AS excerpt, search::score(0) AS score \
                 FROM block WHERE text @0@ $term ORDER BY score DESC LIMIT 20",
                vec![("term", term)],
            )
            .await,
        );
    }

    // Without a limit, to show how many blocks a term really matches.
    let mut search_all = Vec::new();
    for _ in 0..10 {
        let term = VOCABULARY[random.next(VOCABULARY.len())].to_string();
        search_all.push(
            time(
                &storage,
                "SELECT VALUE id FROM block WHERE text @@ $term",
                vec![("term", term)],
            )
            .await,
        );
    }

    let mut search_titles = Vec::new();
    for _ in 0..SAMPLES {
        let term = VOCABULARY[random.next(VOCABULARY.len())].to_string();
        search_titles.push(
            time(
                &storage,
                "SELECT id, title, search::score(0) AS score FROM page WHERE title @0@ $term ORDER BY score DESC LIMIT 20",
                vec![("term", term)],
            )
            .await,
        );
    }

    // Editing: the editor sends the whole document, the repository writes the difference.
    let edited_page = storage.create_page(None).await.unwrap().id;
    let mut document: Vec<Block> = (0..200)
        .map(|index| Block {
            id: format!("edit{index}"),
            kind: "paragraph".into(),
            props: serde_json::Map::new(),
            content: Some(serde_json::json!([
                { "type": "text", "text": format!("paragraph {index} about the garden"), "styles": {} }
            ])),
            children: Vec::new(),
        })
        .collect();
    storage.save_blocks(&edited_page, &document).await.unwrap();
    let mut save_edit = Vec::new();
    for sample in 0..SAMPLES {
        let block = &mut document[random.next(200)];
        block.content = Some(serde_json::json!([
            { "type": "text", "text": format!("edited {sample} times near the river"), "styles": {} }
        ]));
        let started = Instant::now();
        let summary = storage.save_blocks(&edited_page, &document).await.unwrap();
        save_edit.push((started.elapsed(), summary.written));
    }
    // Removing a block and deleting a page go through the delete cascade of the schema.
    let mut remove_block = Vec::new();
    for _ in 0..20 {
        document.pop();
        let started = Instant::now();
        let summary = storage.save_blocks(&edited_page, &document).await.unwrap();
        remove_block.push((started.elapsed(), summary.removed));
    }
    let mut load_document = Vec::new();
    for _ in 0..SAMPLES {
        let started = Instant::now();
        let blocks = storage.load_blocks(&edited_page).await.unwrap();
        load_document.push((started.elapsed(), blocks.len()));
    }

    // The database. Everything below goes through the repository methods.
    let size_before_database = mebibytes(&path);
    let started = Instant::now();
    let (database, properties) = seed_database(&storage).await;
    let seeding_database = started.elapsed();
    let size_with_database = mebibytes(&path);

    // The seeded rows read back as rows with every cell filled.
    let rows = storage.list_rows(&database).await.unwrap();
    assert_eq!(rows.len(), ROWS);
    assert!(rows.iter().all(|row| row.cells.len() == PROPERTIES));
    drop(rows);

    let mut list_rows = Vec::new();
    for _ in 0..LARGE_SAMPLES {
        let started = Instant::now();
        let rows = storage.list_rows(&database).await.unwrap();
        list_rows.push((started.elapsed(), rows.len()));
    }

    let mut list_pages_with_rows = Vec::new();
    for _ in 0..LARGE_SAMPLES {
        let started = Instant::now();
        let pages = storage.list_pages().await.unwrap();
        list_pages_with_rows.push((started.elapsed(), pages.len()));
    }

    let mut load_database = Vec::new();
    for _ in 0..SAMPLES {
        let started = Instant::now();
        let loaded = storage.load_database(&database).await.unwrap();
        load_database.push((started.elapsed(), loaded.properties.len()));
    }

    // One cell write per sample, into a random row, for each type.
    let mut set_text = Vec::new();
    let mut set_number = Vec::new();
    let mut set_date = Vec::new();
    let mut set_select = Vec::new();
    for sample in 0..WRITE_SAMPLES {
        let writes = [
            (
                &mut set_text,
                &properties.notes,
                CellValue::Text(format!("Edited {sample} times")),
            ),
            (
                &mut set_number,
                &properties.pages,
                CellValue::Number(sample as f64 + 0.5),
            ),
            (
                &mut set_date,
                &properties.due,
                CellValue::Date(format!("2027-01-{:02}", sample % 28 + 1)),
            ),
            (
                &mut set_select,
                &properties.priority,
                CellValue::Select(format!("priority-{}", sample % PRIORITY_OPTIONS)),
            ),
        ];
        for (samples, property, value) in writes {
            let row = format!("r{}", random.next(ROWS));
            let started = Instant::now();
            storage.set_cell(&row, property, value).await.unwrap();
            samples.push((started.elapsed(), 1));
        }
    }

    let mut create_row = Vec::new();
    let mut created = Vec::new();
    for _ in 0..WRITE_SAMPLES {
        let started = Instant::now();
        let row = storage.create_row(&database).await.unwrap();
        create_row.push((started.elapsed(), 1));
        created.push(row.id);
    }
    // The destructive changes run against exactly the seeded rows.
    for row in created {
        storage.delete_page(&row).await.unwrap();
    }

    // Destructive changes, each once and each on a property the ones before
    // left full: delete an option, change a type, delete a property, then
    // delete the whole database.
    let mut changes = Vec::new();

    let held = ROWS.div_ceil(STATUS_OPTIONS);
    let started = Instant::now();
    storage
        .delete_select_option(&properties.status, "status-0")
        .await
        .unwrap();
    changes.push(Change {
        name: "delete_select_option",
        touched: format!("{held} of {ROWS} cells emptied"),
        duration: started.elapsed(),
    });

    let numbers = ROWS - ROWS.div_ceil(NOT_A_NUMBER_EVERY);
    let started = Instant::now();
    storage
        .change_property_type(&properties.amount, PropertyType::Number)
        .await
        .unwrap();
    changes.push(Change {
        name: "change_property_type text to number",
        touched: format!("{ROWS} cells, {numbers} kept as numbers"),
        duration: started.elapsed(),
    });

    let started = Instant::now();
    storage.delete_property(&properties.notes).await.unwrap();
    changes.push(Change {
        name: "delete_property (text)",
        touched: format!("{ROWS} cells emptied"),
        duration: started.elapsed(),
    });

    // The three changes did exactly what they should have.
    let rows = storage.list_rows(&database).await.unwrap();
    assert_eq!(rows.len(), ROWS);
    let cells: usize = rows.iter().map(|row| row.cells.len()).sum();
    assert_eq!(cells, ROWS * (PROPERTIES - 1) - held - (ROWS - numbers));
    assert!(rows.iter().all(|row| {
        !row.cells.contains_key(&properties.notes)
            && row
                .cells
                .get(&properties.amount)
                .is_none_or(|value| matches!(value, CellValue::Number(_)))
    }));
    drop(rows);

    let started = Instant::now();
    storage.delete_page(&database).await.unwrap();
    changes.push(Change {
        name: "delete_page on the database",
        touched: format!("{ROWS} rows, {} blocks", ROWS * BLOCKS_PER_ROW),
        duration: started.elapsed(),
    });
    let size_after_database = mebibytes(&path);
    // Back to the ordinary pages and the edited one.
    assert_eq!(storage.list_pages().await.unwrap().len(), PAGES + 1);

    // Deleting ordinary pages comes last, so that every measurement before
    // runs against all 10,000 of them.
    let mut delete_page = Vec::new();
    for _ in 0..20 {
        let page = format!("p{}", 5_000 + random.next(5_000));
        let started = Instant::now();
        let deleted = storage.delete_page(&page).await.is_ok();
        delete_page.push((started.elapsed(), usize::from(deleted)));
    }

    let milliseconds = |value| Some(Duration::from_millis(value));
    println!();
    println!(
        "{PAGES} pages, {} blocks, {} links",
        PAGES * BLOCKS_PER_PAGE,
        PAGES * LINKS_PER_PAGE
    );
    println!("Seeding: {:.1} s", seeding.as_secs_f64());
    println!("Size on disk after seeding the pages: {size_pages:.1} MiB");
    println!(
        "One database: {ROWS} rows, {PROPERTIES} properties, every cell filled, {BLOCKS_PER_ROW} blocks per row"
    );
    println!(
        "Seeding the database: {:.1} s",
        seeding_database.as_secs_f64()
    );
    println!(
        "Size on disk before / with / after deleting the database: {size_before_database:.1} / \
         {size_with_database:.1} / {size_after_database:.1} MiB"
    );
    println!();
    let timings = [
        Timings {
            name: "Load the blocks of a page",
            target: milliseconds(50),
            samples: load_page,
        },
        Timings {
            name: "Backlinks (graph traversal)",
            target: milliseconds(50),
            samples: backlinks_graph,
        },
        Timings {
            name: "Backlinks (subquery on links_to)",
            target: milliseconds(50),
            samples: backlinks,
        },
        Timings {
            name: "Page tree, raw query only (not what the app runs)",
            target: milliseconds(200),
            samples: tree,
        },
        Timings {
            name: "Page tree, list_pages, 10,000 pages",
            target: milliseconds(200),
            samples: list_pages,
        },
        Timings {
            name: "Search block text, top 20",
            target: milliseconds(200),
            samples: search,
        },
        Timings {
            name: "Search page titles, top 20",
            target: milliseconds(200),
            samples: search_titles,
        },
        Timings {
            name: "Search block text, every match",
            target: milliseconds(200),
            samples: search_all,
        },
        Timings {
            name: "Save a 200-block page after editing one block",
            target: milliseconds(50),
            samples: save_edit,
        },
        Timings {
            name: "Load a 200-block page into the editor",
            target: milliseconds(50),
            samples: load_document,
        },
        Timings {
            name: "Save a page after removing one block",
            target: milliseconds(50),
            samples: remove_block,
        },
        Timings {
            name: "Delete a page with 20 blocks and its subpages",
            target: milliseconds(50),
            samples: delete_page,
        },
        Timings {
            name: "Database: list_rows, every row with its cells",
            target: milliseconds(100),
            samples: list_rows,
        },
        Timings {
            name: "Database: list_pages with the rows present",
            target: milliseconds(200),
            samples: list_pages_with_rows,
        },
        Timings {
            name: "Database: load_database (rows = properties)",
            target: None,
            samples: load_database,
        },
        Timings {
            name: "Database: set_cell, text",
            target: milliseconds(50),
            samples: set_text,
        },
        Timings {
            name: "Database: set_cell, number",
            target: milliseconds(50),
            samples: set_number,
        },
        Timings {
            name: "Database: set_cell, date",
            target: milliseconds(50),
            samples: set_date,
        },
        Timings {
            name: "Database: set_cell, select",
            target: milliseconds(50),
            samples: set_select,
        },
        Timings {
            name: "Database: create_row",
            target: milliseconds(50),
            samples: create_row,
        },
    ];
    timings[0].assert_rows(|rows| rows == BLOCKS_PER_PAGE);
    timings[1].assert_rows(|rows| rows > 0);
    timings[2].assert_rows(|rows| rows > 0);
    timings[3].assert_rows(|rows| rows == PAGES);
    timings[4].assert_rows(|rows| rows == PAGES);
    timings[5].assert_rows(|rows| rows == 20);
    timings[6].assert_rows(|rows| rows == 20);
    timings[7].assert_rows(|rows| rows > 1_000);
    timings[8].assert_rows(|rows| rows == 1);
    timings[9].assert_rows(|rows| rows == 180);
    timings[10].assert_rows(|rows| rows == 1);
    timings[11].assert_rows(|rows| rows == 1);
    timings[12].assert_rows(|rows| rows == ROWS);
    // The pages, the edited page, the database and its rows.
    timings[13].assert_rows(|rows| rows == PAGES + 2 + ROWS);
    timings[14].assert_rows(|rows| rows == PROPERTIES);

    println!("| Query | Rows | Median | p95 | Max | Target | Result |");
    println!("| --- | --- | --- | --- | --- | --- | --- |");
    for timing in timings {
        println!("{}", timing.report());
    }
    println!();
    println!("Destructive changes on the database, each run once, in this order:");
    println!();
    println!("| Change | Touched | Time |");
    println!("| --- | --- | --- |");
    for change in &changes {
        println!("{}", change.report());
    }
}
