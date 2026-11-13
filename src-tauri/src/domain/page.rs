use serde::Serialize;

/// What a page shows below its title: text, or the table of a database.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PageKind {
    Page,
    Database,
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
        };
        let database = Page {
            id: "db".into(),
            title: String::new(),
            parent_id: None,
            position: 0.0,
            kind: PageKind::Database,
            database_id: None,
        };

        assert_eq!(
            serde_json::to_value(&row).unwrap(),
            json!({
                "id": "row", "title": "Row", "parentId": "db", "position": 1.5,
                "kind": "page", "databaseId": "db"
            })
        );
        assert_eq!(
            serde_json::to_value(&database).unwrap(),
            json!({
                "id": "db", "title": "", "parentId": null, "position": 0.0,
                "kind": "database", "databaseId": null
            })
        );
    }
}
