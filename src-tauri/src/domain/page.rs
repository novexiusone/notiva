use serde::Serialize;

/// A page in the hierarchy. `position` orders the pages that share a parent.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub id: String,
    pub title: String,
    pub parent_id: Option<String>,
    pub position: f64,
}

/// A reference to a page: enough to show it in a list and open it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PageRef {
    pub id: String,
    pub title: String,
}
