use serde::Serialize;

/// What a page shows below its title: text, or the table of a database.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PageKind {
    Page,
    Database,
}

/// How far a page is protected against changes. See `SPEC-pages.md`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PageLock {
    #[default]
    None,
    /// Title, text, icon and cover are read-only; a database's rows, cells,
    /// properties and views stay editable.
    Content,
    /// Also a database's rows, cells, properties and views.
    All,
}

impl PageLock {
    /// The lock as it is stored: `None` is stored as no value.
    pub fn stored(self) -> Option<&'static str> {
        match self {
            Self::None => None,
            Self::Content => Some("content"),
            Self::All => Some("all"),
        }
    }

    /// Reads a stored lock; no value and unknown values read as unlocked.
    pub fn from_stored(value: Option<&str>) -> Self {
        match value {
            Some("content") => Self::Content,
            Some("all") => Self::All,
            _ => Self::None,
        }
    }
}

/// A page in the hierarchy. `position` orders the pages that share a parent.
///
/// A database is a page of the kind [`PageKind::Database`], and its rows are
/// the pages below it that carry its id in `database_id`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub id: String,
    pub title: String,
    pub parent_id: Option<String>,
    pub position: f64,
    pub kind: PageKind,
    /// Set on the rows of a database, otherwise `None`.
    pub database_id: Option<String>,
    pub is_favorite: bool,
    pub icon: Option<String>,
    pub banner: Option<String>,
    /// Where the cover image sits in the cover, from 0 (top) to 100 (bottom).
    pub banner_position: u8,
    pub lock: PageLock,
    pub updated_at: String,
}

/// A reference to a page: enough to show it in a list and open it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PageRef {
    pub id: String,
    pub title: String,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_page_is_serialised_in_camel_case_with_its_kind() {
        let row = Page {
            id: "row".into(),
            title: "Row".into(),
            parent_id: Some("db".into()),
            position: 1.5,
            kind: PageKind::Page,
            database_id: Some("db".into()),
            is_favorite: true,
            icon: Some("book".into()),
            banner: Some("notiva-image://localhost/cover.png".into()),
            banner_position: 30,
            lock: PageLock::Content,
            updated_at: "2026-11-15T00:00:00Z".into(),
        };
        let database = Page {
            id: "db".into(),
            title: String::new(),
            parent_id: None,
            position: 0.0,
            kind: PageKind::Database,
            database_id: None,
            is_favorite: false,
            icon: None,
            banner: None,
            banner_position: 50,
            lock: PageLock::None,
            updated_at: "2026-11-15T00:00:00Z".into(),
        };

        assert_eq!(
            serde_json::to_value(&row).unwrap(),
            json!({
                "id": "row", "title": "Row", "parentId": "db", "position": 1.5,
                "kind": "page", "databaseId": "db", "isFavorite": true,
                "icon": "book", "banner": "notiva-image://localhost/cover.png",
                "bannerPosition": 30, "lock": "content",
                "updatedAt": "2026-11-15T00:00:00Z"
            })
        );
        assert_eq!(
            serde_json::to_value(&database).unwrap(),
            json!({
                "id": "db", "title": "", "parentId": null, "position": 0.0,
                "kind": "database", "databaseId": null, "isFavorite": false,
                "icon": null, "banner": null, "bannerPosition": 50, "lock": "none", "updatedAt": "2026-11-15T00:00:00Z"
            })
        );
    }
}
