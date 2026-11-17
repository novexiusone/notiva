//! The repository layer.
//!
//! This is the only module that talks to SurrealDB. Everything it exposes
//! uses plain domain types and [`StorageError`], so the rest of the backend
//! does not depend on the database.

mod backup;
mod blocks;
mod databases;
mod error;
mod links;
mod migrations;
mod pages;
mod properties;
mod relations;
mod rows;
mod search;
mod trash;
mod versions;
mod views;

#[cfg(test)]
mod benchmark;
#[cfg(test)]
mod tests;

use std::path::Path;

use surrealdb::Surreal;
use surrealdb::engine::local::{Db, SurrealKv};

pub use backup::restore_snapshot;
pub use error::StorageError;
pub(crate) use properties::number_as_text;

const NAMESPACE: &str = "notiva";
const DATABASE: &str = "main";

/// A handle to the embedded database with its schema up to date.
pub struct Storage {
    db: Surreal<Db>,
    /// Every write to pages and what belongs to them holds it shared; moving a
    /// page to or from the trash and purging hold it exclusively. A write can
    /// therefore not slip in between copying a page and deleting it.
    write_gate: tokio::sync::RwLock<()>,
}

impl Storage {
    /// Opens the database stored in `path`, creating it when it does not exist.
    pub async fn open(path: &Path) -> Result<Self, StorageError> {
        std::fs::create_dir_all(path)?;
        let db = Surreal::new::<SurrealKv>(path).await?;
        Self::prepare(db).await
    }

    /// Opens an empty database that lives only in memory.
    #[cfg(test)]
    pub async fn open_in_memory() -> Result<Self, StorageError> {
        let db = Surreal::new::<surrealdb::engine::local::Mem>(()).await?;
        Self::prepare(db).await
    }

    async fn prepare(db: Surreal<Db>) -> Result<Self, StorageError> {
        db.use_ns(NAMESPACE).use_db(DATABASE).await?;
        migrations::run(&db, migrations::MIGRATIONS).await?;
        let storage = Self {
            db,
            write_gate: tokio::sync::RwLock::new(()),
        };
        // Housekeeping must never keep the app from starting: both only tidy
        // the trash and are tried again at the next start.
        if let Err(error) = storage.recover_trash().await {
            eprintln!("could not finish an interrupted change of the trash: {error}");
        }
        if let Err(error) = storage.purge_expired_trash().await {
            eprintln!("could not empty the expired pages of the trash: {error}");
        }
        Ok(storage)
    }
}
