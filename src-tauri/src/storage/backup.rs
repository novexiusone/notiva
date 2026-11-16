//! Consistent snapshots of the database, and databases rebuilt from them.
//!
//! The snapshot is SurrealDB's own export: one read transaction, written as
//! SurrealQL. Files of the live database are never copied.

use std::path::Path;

use surrealdb::Surreal;
use surrealdb::engine::local::SurrealKv;

use super::{DATABASE, NAMESPACE, Storage, StorageError, migrations};

impl Storage {
    /// Writes a consistent snapshot of the whole database to `path`, even
    /// while the app keeps writing, and returns the schema version it has.
    pub async fn export_to(&self, path: &Path) -> Result<u32, StorageError> {
        // The version is read before the export. Migrations only run while
        // the database is opened, so it cannot change in between.
        let version = migrations::current_version(&self.db).await?;
        self.db.export(path).await?;
        Ok(version)
    }

    /// The highest schema version this build can open.
    pub fn supported_schema_version() -> u32 {
        migrations::MIGRATIONS
            .last()
            .map_or(0, |migration| migration.version)
    }
}

/// Builds a new database in `directory` from a snapshot written by
/// [`Storage::export_to`], brings its schema up to date and closes it again.
/// Returns the schema version the snapshot had.
///
/// `directory` must be empty or not exist.
pub async fn restore_snapshot(directory: &Path, snapshot: &Path) -> Result<u32, StorageError> {
    if directory.exists() && std::fs::read_dir(directory)?.next().is_some() {
        return Err(StorageError::Invalid(
            "the target of a restore must be an empty folder".into(),
        ));
    }
    std::fs::create_dir_all(directory)?;

    let db = Surreal::new::<SurrealKv>(directory).await?;
    db.use_ns(NAMESPACE).use_db(DATABASE).await?;
    db.import(snapshot).await?;

    let found = migrations::current_version(&db).await?;
    // An older snapshot is brought up to date; a newer one is refused here.
    migrations::run(&db, migrations::MIGRATIONS).await?;
    db.shutdown().await?;
    Ok(found)
}
