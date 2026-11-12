# Spec: storage

## Objective

Notiva keeps all data in an embedded SurrealDB inside the Rust backend. This module opens the database, brings its schema up to date and hides SurrealDB behind a repository layer, so that the rest of the backend works with plain domain types and a later change of database stays contained.

It also delivers the first version of the schema for the whole MVP and an early benchmark, because the open risk is whether embedded SurrealDB is fast enough for 10,000 pages.

This module has no user interface. Pages, blocks, links and search get their repositories, commands and UI in their own modules.

## Tech stack

| Area          | Choice                                                            |
| ------------- | ----------------------------------------------------------------- |
| Database      | `surrealdb` 4 embedded, storage engine SurrealKV (`kv-surrealkv`) |
| Tests         | in-memory engine (`kv-mem`), `tempfile` for persistence tests     |
| Async runtime | tokio, through Tauri's async runtime                              |
| Errors        | `thiserror`                                                       |
| Migrations    | own runner: numbered `.surql` files embedded in the binary        |

RocksDB is not an option any more: the 4.x crate only ships the in-memory and SurrealKV engines.

## Commands

```bash
cargo test --manifest-path src-tauri/Cargo.toml                 # unit and repository tests
cargo test --manifest-path src-tauri/Cargo.toml --profile benchmark -- --ignored --nocapture benchmark   # 10,000 page benchmark
```

## Project structure

```
src-tauri/src/
  storage/
    mod.rs            → `Storage`: open on disk, open in memory
    error.rs          → `StorageError`
    migrations.rs     → migration runner
    migrations/       → `0001_initial.surql`, `0002_…`
    benchmark.rs      → ignored test that measures the queries the app depends on
  lib.rs              → opens the storage at startup and hands it to Tauri as managed state
```

`storage` is the repository layer. It is the only module that may import `surrealdb`. A test fails when any other source file mentions the crate.

The database lives in `<app data dir>/db`, on macOS `~/Library/Application Support/com.novexlab.notiva/db`.

## Data model (schema version 1)

```
page
  title        string
  parent       option<record<page>>     → null for top-level pages
  position     float                    → order among siblings
  created_at   datetime
  updated_at   datetime

block
  page         record<page>
  parent       option<record<block>>    → null for top-level blocks
  position     float                    → order among siblings
  type         string                   → BlockNote block type
  props        object, flexible         → BlockNote props
  content      array, flexible          → BlockNote inline content
  text         string                   → plain text for search

links_to       relation page → page
  block        record<block>            → the block that contains the link
```

- Record ids are the stable ids: BlockNote's block id becomes the id of the `block` record.
- Indexes: `page.parent`, `block.page`, and full-text indexes on `page.title` and `block.text`.
- Backlinks are a graph query: `SELECT <-links_to<-page FROM $page`.
- Deleting a page deletes its subpages, its blocks and its links; deleting a block deletes its child blocks and the links it contains. This is done by table events so no caller can forget it.

Later modules change the schema only by adding a migration.

## Migrations

- Each migration is a file `NNNN_name.surql`. Files are embedded with `include_str!` and listed in order in `migrations.rs`.
- The table `migration` records the applied versions. At startup every pending migration runs in its own transaction, in order.
- A migration that was applied is never edited. Fixes go into a new migration.
- A database with a higher schema version than the app knows is refused with a clear error instead of being opened.

## Stack size

SurrealDB recurses deeply while parsing and planning queries. In unoptimised builds this overflows the default 2 MiB stack of tokio workers and test threads. The app therefore starts its own tokio runtime with 16 MiB worker stacks and hands it to Tauri, and `.cargo/config.toml` sets `RUST_MIN_STACK` for tests.

## Code style

The public surface of `storage` uses domain types and `StorageError`, never SurrealDB types.

```rust
pub struct Storage { /* private SurrealDB handle */ }

impl Storage {
    pub async fn open(path: &Path) -> Result<Self, StorageError>;
    pub async fn open_in_memory() -> Result<Self, StorageError>; // tests only
}
```

Queries use bound parameters, never string formatting of values.

## Testing strategy

- Repository tests run against the in-memory engine. Each test opens its own database.
- One test opens a database in a temporary directory, writes, closes, reopens and reads, to prove persistence.
- Migration tests: a fresh database ends at the latest version; running the migrations twice changes nothing; a newer schema version is refused.
- Schema tests exercise the rules that matter: required fields are enforced, deleting a page removes its blocks and links, backlinks and full-text search return what was written.
- The benchmark is an ignored test. It creates 10,000 pages with blocks and links and prints timings for: load one page with its blocks, load the page tree, full-text search, backlinks of a page.

## Boundaries

- **Always:** Add schema changes as a new migration. Bind query parameters. Keep SurrealDB types inside `storage`.
- **Ask first:** Changing the storage engine or the database. Any migration that drops or rewrites user data.
- **Never:** Edit an applied migration. Access the database from the WebView.

## Success criteria

- [ ] The database is created in the app data directory and survives a restart (#10)
- [ ] No source file outside `storage` mentions `surrealdb`; a test enforces it (#10)
- [ ] Migrations are versioned and run at startup; the runner is idempotent (#10)
- [ ] Repository tests run against an in-memory instance (#10)
- [ ] The benchmark runs with 10,000 pages and its results are posted on #11

## Open questions

- Acceptable limits for the benchmark are not defined yet. Working targets: page load and backlinks under 50 ms, page tree under 200 ms, search under 200 ms. The benchmark reports against these.
