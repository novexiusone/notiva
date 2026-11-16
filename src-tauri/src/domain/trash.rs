use serde::Serialize;

use super::{Block, PageKind};

/// A page in the trash, with everything that went with it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashedPage {
    /// The id of the page; it identifies the entry in the trash.
    pub id: String,
    pub title: String,
    pub kind: PageKind,
    pub icon: Option<String>,
    /// Where the page was. Restoring puts it back there if that still exists.
    pub parent_id: Option<String>,
    /// Set when the page was a row of a database.
    pub database_id: Option<String>,
    /// The page itself, its subpages and, for a database, its rows.
    pub page_count: usize,
    pub deleted_at: String,
}

/// The settings of the trash.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashSettings {
    /// Days a page stays in the trash before it is deleted for good. `None`
    /// keeps pages until they are deleted by hand.
    pub retention_days: Option<u32>,
}

/// One saved state of a page's blocks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageVersion {
    pub id: String,
    /// The title of the page when the version was taken.
    pub title: String,
    pub block_count: usize,
    /// The start of the text, to tell versions apart in a list.
    pub preview: String,
    pub created_at: String,
}

/// A version together with the blocks it holds.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageVersionContent {
    #[serde(flatten)]
    pub version: PageVersion,
    pub blocks: Vec<Block>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn trash_types_are_serialised_in_camel_case() {
        let trashed = TrashedPage {
            id: "a".into(),
            title: "A".into(),
            kind: PageKind::Database,
            icon: None,
            parent_id: Some("p".into()),
            database_id: None,
            page_count: 3,
            deleted_at: "2026-11-16T00:00:00Z".into(),
        };

        assert_eq!(
            serde_json::to_value(&trashed).unwrap(),
            json!({
                "id": "a", "title": "A", "kind": "database", "icon": null,
                "parentId": "p", "databaseId": null, "pageCount": 3,
                "deletedAt": "2026-11-16T00:00:00Z"
            })
        );
        assert_eq!(
            serde_json::to_value(TrashSettings {
                retention_days: None
            })
            .unwrap(),
            json!({ "retentionDays": null })
        );
    }
}
