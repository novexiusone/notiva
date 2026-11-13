//! Schema migrations.
//!
//! Each migration is a numbered `.surql` file that is embedded in the binary.
//! Applied versions are recorded in the `migration` table. A migration that
//! has been applied is never edited; fixes go into a new one.

use surrealdb::Surreal;
use surrealdb::engine::local::Db;

use super::StorageError;

pub(super) struct Migration {
    pub version: u32,
    pub name: &'static str,
    pub sql: &'static str,
}

pub(super) const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "initial",
        sql: include_str!("migrations/0001_initial.surql"),
    },
    Migration {
        version: 2,
        name: "block_content",
        sql: include_str!("migrations/0002_block_content.surql"),
    },
    Migration {
        version: 3,
        name: "search_prefixes",
        sql: include_str!("migrations/0003_search_prefixes.surql"),
    },
    Migration {
        version: 4,
        name: "indexed_cascades",
        sql: include_str!("migrations/0004_indexed_cascades.surql"),
    },
    Migration {
        version: 5,
        name: "databases",
        sql: include_str!("migrations/0005_databases.surql"),
    },
];

const BOOTSTRAP: &str = "
    DEFINE TABLE IF NOT EXISTS migration SCHEMAFULL;
    DEFINE FIELD IF NOT EXISTS version ON migration TYPE int;
    DEFINE FIELD IF NOT EXISTS name ON migration TYPE string;
    DEFINE FIELD IF NOT EXISTS applied_at ON migration TYPE datetime DEFAULT time::now();
    DEFINE INDEX IF NOT EXISTS migration_version ON migration FIELDS version UNIQUE;
";

/// Applies every pending migration in order, each in its own transaction.
pub(super) async fn run(db: &Surreal<Db>, migrations: &[Migration]) -> Result<(), StorageError> {
    db.query(BOOTSTRAP).await?.check()?;

    let current = current_version(db).await?;
    let supported = migrations.last().map_or(0, |migration| migration.version);
    if current > supported {
        return Err(StorageError::SchemaTooNew {
            found: current,
            supported,
        });
    }

    for migration in migrations.iter().filter(|m| m.version > current) {
        let statements = format!(
            "BEGIN TRANSACTION;\n{}\nCREATE migration SET version = $version, name = $name;\nCOMMIT TRANSACTION;",
            migration.sql
        );
        db.query(statements)
            .bind(("version", i64::from(migration.version)))
            .bind(("name", migration.name))
            .await?
            .check()?;
    }

    Ok(())
}

/// The highest applied migration version, or 0 for a fresh database.
pub(super) async fn current_version(db: &Surreal<Db>) -> Result<u32, StorageError> {
    let version: Option<i64> = db
        .query("SELECT VALUE version FROM migration ORDER BY version DESC LIMIT 1")
        .await?
        .take(0)?;

    Ok(version.map_or(0, |version| version as u32))
}
