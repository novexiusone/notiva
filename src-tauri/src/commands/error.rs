use serde::Serialize;

use crate::export::ExportError;
use crate::media::ImageError;
use crate::storage::StorageError;

/// What the frontend sees when a command fails.
#[derive(Debug, Serialize, PartialEq)]
pub struct CommandError {
    pub kind: &'static str,
    pub message: String,
}

impl From<StorageError> for CommandError {
    fn from(error: StorageError) -> Self {
        let kind = match error {
            StorageError::NotFound(_) => "not_found",
            StorageError::Invalid(_) => "invalid",
            _ => "internal",
        };

        Self {
            kind,
            message: error.to_string(),
        }
    }
}

impl From<ImageError> for CommandError {
    fn from(error: ImageError) -> Self {
        let kind = match error {
            ImageError::TooLarge | ImageError::Unsupported => "invalid",
            ImageError::Io(_) => "internal",
        };

        Self {
            kind,
            message: error.to_string(),
        }
    }
}

impl From<ExportError> for CommandError {
    fn from(error: ExportError) -> Self {
        match error {
            ExportError::Storage(error) => error.into(),
            ExportError::NotAFolder(_) => Self {
                kind: "invalid",
                message: error.to_string(),
            },
            ExportError::Io(_) => Self {
                kind: "internal",
                message: error.to_string(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_errors_map_to_kinds_the_frontend_can_act_on() {
        let not_found = CommandError::from(StorageError::NotFound("page x".into()));
        let invalid = CommandError::from(StorageError::Invalid("no".into()));
        let internal = CommandError::from(StorageError::Database("boom".into()));

        assert_eq!(not_found.kind, "not_found");
        assert_eq!(not_found.message, "page x was not found");
        assert_eq!(invalid.kind, "invalid");
        assert_eq!(internal.kind, "internal");
    }
}
