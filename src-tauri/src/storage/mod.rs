//! The repository layer.
//!
//! This is the only module that talks to SurrealDB. Everything it exposes
//! uses plain domain types and [`StorageError`], so the rest of the backend
//! does not depend on the database.

mod blocks;
mod error;
mod links;
mod migrations;
mod pages;

#[cfg(test)]
mod benchmark;
#[cfg(test)]
mod tests;

use std::path::Path;

use surrealdb::Surreal;
use surrealdb::engine::local::{Db, SurrealKv};

pub use error::StorageError;

const NAMESPACE: &str = "notiva";
const DATABASE: &str = "main";

/// A handle to the embedded database with its schema up to date.
pub struct Storage {
    db: Surreal<Db>,
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
        Ok(Self { db })
    }
}
