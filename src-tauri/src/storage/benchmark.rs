//! An early benchmark of the queries the app depends on, against a database
//! on disk with 10,000 pages.
//!
//! Run it with:
//!
//! ```bash
//! cargo test --manifest-path src-tauri/Cargo.toml --profile benchmark -- --ignored --nocapture benchmark
//! ```

use std::fmt::Write as _;
use std::time::{Duration, Instant};

use surrealdb::types::Value;

use super::Storage;

const PAGES: usize = 10_000;
const BLOCKS_PER_PAGE: usize = 20;
const LINKS_PER_PAGE: usize = 3;
const WORDS_PER_BLOCK: usize = 12;
const BATCH: usize = 500;
const SAMPLES: usize = 50;

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

struct Timings {
    name: &'static str,
    target: Duration,
    samples: Vec<Duration>,
}

impl Timings {
    fn report(mut self) -> String {
        self.samples.sort();
        let median = self.samples[self.samples.len() / 2];
        let p95 = self.samples[(self.samples.len() * 95 / 100).min(self.samples.len() - 1)];
        let max = *self.samples.last().unwrap();
        let verdict = if p95 <= self.target {
            "ok"
        } else {
            "over target"
        };
        format!(
            "| {} | {:.1} ms | {:.1} ms | {:.1} ms | {} ms | {} |",
            self.name,
            median.as_secs_f64() * 1000.0,
            p95.as_secs_f64() * 1000.0,
            max.as_secs_f64() * 1000.0,
            self.target.as_millis(),
            verdict
        )
    }
}

async fn execute(storage: &Storage, statements: String) {
    storage.db.query(statements).await.unwrap().check().unwrap();
}

/// Runs a query, reads its first result and returns how long both took.
async fn time(storage: &Storage, query: &str, bindings: Vec<(&'static str, String)>) -> Duration {
    let started = Instant::now();
    let mut request = storage.db.query(query);
    for binding in bindings {
        request = request.bind(binding);
    }
    let value: Value = request.await.unwrap().take(0).unwrap();
    let elapsed = started.elapsed();
    std::hint::black_box(value);
    elapsed
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

    let milliseconds = Duration::from_millis;
    println!();
    println!(
        "{PAGES} pages, {} blocks, {} links",
        PAGES * BLOCKS_PER_PAGE,
        PAGES * LINKS_PER_PAGE
    );
    println!("Seeding: {:.1} s", seeding.as_secs_f64());
    println!(
        "Size on disk: {:.1} MiB",
        directory_size(&path) as f64 / 1024.0 / 1024.0
    );
    println!();
    println!("| Query | Median | p95 | Max | Target | Result |");
    println!("| --- | --- | --- | --- | --- | --- |");
    for timings in [
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
            name: "Load the page tree",
            target: milliseconds(200),
            samples: tree,
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
    ] {
        println!("{}", timings.report());
    }
}
