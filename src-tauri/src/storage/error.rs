/// Everything that can go wrong in the repository layer.
///
/// Database errors are carried as text so that no SurrealDB type leaks out of
/// this module.
#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("{0} was not found")]
    NotFound(String),

    #[error("{0}")]
    Invalid(String),

    #[error("database error: {0}")]
    Database(String),

    #[error(
        "the database has schema version {found}, but this version of Notiva only supports up to {supported}"
    )]
    SchemaTooNew { found: u32, supported: u32 },

    #[error("could not prepare the data directory: {0}")]
    Io(#[from] std::io::Error),
}

impl From<surrealdb::Error> for StorageError {
    fn from(error: surrealdb::Error) -> Self {
        Self::Database(error.to_string())
    }
}
