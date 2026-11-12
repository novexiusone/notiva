//! The page repository.

use std::collections::HashMap;

use surrealdb::types::SurrealValue;

use super::{Storage, StorageError};
use crate::domain::Page;

/// Selects a page with its ids as plain strings.
const PAGE_FIELDS: &str = "record::id(id) AS id, title, \
     IF parent = NONE { NONE } ELSE { record::id(parent) } AS parent_id, position";

/// Turns an optional page id into an optional record link.
const PARENT: &str = "IF $parent_id = NONE { NONE } ELSE { type::record('page', $parent_id) }";

#[derive(SurrealValue)]
struct PageRow {
    id: String,
    title: String,
    parent_id: Option<String>,
    position: f64,
}

impl From<PageRow> for Page {
    fn from(row: PageRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            parent_id: row.parent_id,
            position: row.position,
        }
    }
}

fn not_found(id: &str) -> StorageError {
    StorageError::NotFound(format!("page {id}"))
}

impl Storage {
    /// Every page as a flat list, ordered by position.
    pub async fn list_pages(&self) -> Result<Vec<Page>, StorageError> {
        let rows: Vec<PageRow> = self
            .db
            .query(format!("SELECT {PAGE_FIELDS} FROM page ORDER BY position"))
            .await?
            .take(0)?;

        Ok(rows.into_iter().map(Page::from).collect())
    }

    /// Creates an untitled page after the last child of `parent_id`.
    pub async fn create_page(&self, parent_id: Option<&str>) -> Result<Page, StorageError> {
        if let Some(parent_id) = parent_id {
            self.require_page(parent_id).await?;
        }

        let row: Option<PageRow> = self
            .db
            .query(format!(
                "LET $parent = {PARENT};
                 LET $last = (SELECT VALUE position FROM page WHERE parent = $parent ORDER BY position DESC LIMIT 1)[0];
                 CREATE page SET title = '', parent = $parent, position = ($last ?? -1.0) + 1.0
                     RETURN {PAGE_FIELDS};"
            ))
            .bind(("parent_id", parent_id.map(str::to_owned)))
            .await?
            .check()?
            .take(2)?;

        row.map(Page::from)
            .ok_or_else(|| StorageError::Database("the created page was not returned".into()))
    }

    pub async fn rename_page(&self, id: &str, title: &str) -> Result<Page, StorageError> {
        let row: Option<PageRow> = self
            .db
            .query(format!(
                "UPDATE type::record('page', $id) SET title = $title, updated_at = time::now()
                     WHERE id != NONE RETURN {PAGE_FIELDS}"
            ))
            .bind(("id", id.to_owned()))
            .bind(("title", title.to_owned()))
            .await?
            .check()?
            .take(0)?;

        row.map(Page::from).ok_or_else(|| not_found(id))
    }

    /// Moves a page to `index` among the children of `parent_id` and renumbers
    /// those children. A page cannot be moved into itself or a descendant.
    pub async fn move_page(
        &self,
        id: &str,
        parent_id: Option<&str>,
        index: usize,
    ) -> Result<(), StorageError> {
        let pages = self.list_pages().await?;
        let parents: HashMap<&str, Option<&str>> = pages
            .iter()
            .map(|page| (page.id.as_str(), page.parent_id.as_deref()))
            .collect();

        if !parents.contains_key(id) {
            return Err(not_found(id));
        }

        // Walk up from the new parent: meeting the moved page means a cycle.
        let mut ancestor = parent_id;
        while let Some(current) = ancestor {
            if current == id {
                return Err(StorageError::Invalid(
                    "a page cannot be moved into itself or one of its subpages".into(),
                ));
            }
            ancestor = *parents.get(current).ok_or_else(|| not_found(current))?;
        }

        let mut order: Vec<String> = pages
            .iter()
            .filter(|page| page.parent_id.as_deref() == parent_id && page.id != id)
            .map(|page| page.id.clone())
            .collect();
        order.insert(index.min(order.len()), id.to_owned());

        self.db
            .query(format!(
                "BEGIN TRANSACTION;
                 UPDATE type::record('page', $id) SET parent = {PARENT}, updated_at = time::now();
                 FOR $index IN 0..array::len($order) {{
                     UPDATE type::record('page', $order[$index]) SET position = <float> $index;
                 }};
                 COMMIT TRANSACTION;"
            ))
            .bind(("id", id.to_owned()))
            .bind(("parent_id", parent_id.map(str::to_owned)))
            .bind(("order", order))
            .await?
            .check()?;

        Ok(())
    }

    /// Deletes a page together with its subpages, blocks and links.
    pub async fn delete_page(&self, id: &str) -> Result<(), StorageError> {
        self.require_page(id).await?;

        self.db
            .query("DELETE type::record('page', $id)")
            .bind(("id", id.to_owned()))
            .await?
            .check()?;

        Ok(())
    }

    async fn require_page(&self, id: &str) -> Result<(), StorageError> {
        let exists: Option<bool> = self
            .db
            .query("RETURN record::exists(type::record('page', $id))")
            .bind(("id", id.to_owned()))
            .await?
            .take(0)?;

        if exists == Some(true) {
            Ok(())
        } else {
            Err(not_found(id))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn storage() -> Storage {
        Storage::open_in_memory().await.unwrap()
    }

    /// The ids of the children of `parent`, in order.
    async fn children(storage: &Storage, parent: Option<&str>) -> Vec<String> {
        storage
            .list_pages()
            .await
            .unwrap()
            .into_iter()
            .filter(|page| page.parent_id.as_deref() == parent)
            .map(|page| page.id)
            .collect()
    }

    #[tokio::test]
    async fn a_new_page_is_untitled_and_comes_last() {
        let storage = storage().await;

        let first = storage.create_page(None).await.unwrap();
        let second = storage.create_page(None).await.unwrap();

        assert_eq!(first.title, "");
        assert_eq!(first.parent_id, None);
        assert!(second.position > first.position);
        assert_eq!(children(&storage, None).await, [first.id, second.id]);
    }

    #[tokio::test]
    async fn a_subpage_belongs_to_its_parent() {
        let storage = storage().await;
        let parent = storage.create_page(None).await.unwrap();

        let child = storage.create_page(Some(&parent.id)).await.unwrap();

        assert_eq!(child.parent_id.as_deref(), Some(parent.id.as_str()));
        assert_eq!(children(&storage, Some(&parent.id)).await, [child.id]);
    }

    #[tokio::test]
    async fn creating_below_an_unknown_page_fails() {
        let storage = storage().await;

        let error = storage.create_page(Some("missing")).await.unwrap_err();

        assert!(matches!(error, StorageError::NotFound(_)));
        assert!(storage.list_pages().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn renaming_changes_the_title() {
        let storage = storage().await;
        let page = storage.create_page(None).await.unwrap();

        let renamed = storage.rename_page(&page.id, "Reading list").await.unwrap();

        assert_eq!(renamed.title, "Reading list");
        assert_eq!(storage.list_pages().await.unwrap()[0].title, "Reading list");
    }

    #[tokio::test]
    async fn renaming_an_unknown_page_fails_without_creating_it() {
        let storage = storage().await;

        let error = storage.rename_page("missing", "Ghost").await.unwrap_err();

        assert!(matches!(error, StorageError::NotFound(_)));
        assert!(storage.list_pages().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn moving_reorders_siblings() {
        let storage = storage().await;
        let a = storage.create_page(None).await.unwrap().id;
        let b = storage.create_page(None).await.unwrap().id;
        let c = storage.create_page(None).await.unwrap().id;

        storage.move_page(&c, None, 0).await.unwrap();
        assert_eq!(
            children(&storage, None).await,
            [c.clone(), a.clone(), b.clone()]
        );

        storage.move_page(&c, None, 99).await.unwrap();
        assert_eq!(children(&storage, None).await, [a, b, c]);
    }

    #[tokio::test]
    async fn moving_into_another_page_changes_the_parent() {
        let storage = storage().await;
        let a = storage.create_page(None).await.unwrap().id;
        let b = storage.create_page(None).await.unwrap().id;
        let existing = storage.create_page(Some(&a)).await.unwrap().id;

        storage.move_page(&b, Some(&a), 0).await.unwrap();

        assert_eq!(children(&storage, Some(&a)).await, [b, existing]);
        assert_eq!(children(&storage, None).await, [a]);
    }

    #[tokio::test]
    async fn a_page_cannot_be_moved_into_itself_or_a_subpage() {
        let storage = storage().await;
        let parent = storage.create_page(None).await.unwrap().id;
        let child = storage.create_page(Some(&parent)).await.unwrap().id;
        let grandchild = storage.create_page(Some(&child)).await.unwrap().id;

        for target in [&parent, &child, &grandchild] {
            let error = storage
                .move_page(&parent, Some(target), 0)
                .await
                .unwrap_err();
            assert!(matches!(error, StorageError::Invalid(_)), "into {target}");
        }

        assert_eq!(children(&storage, None).await, [parent]);
    }

    #[tokio::test]
    async fn moving_an_unknown_page_or_to_an_unknown_parent_fails() {
        let storage = storage().await;
        let page = storage.create_page(None).await.unwrap().id;

        let unknown_page = storage.move_page("missing", None, 0).await.unwrap_err();
        let unknown_parent = storage
            .move_page(&page, Some("missing"), 0)
            .await
            .unwrap_err();

        assert!(matches!(unknown_page, StorageError::NotFound(_)));
        assert!(matches!(unknown_parent, StorageError::NotFound(_)));
    }

    #[tokio::test]
    async fn deleting_removes_the_page_and_its_subpages() {
        let storage = storage().await;
        let keep = storage.create_page(None).await.unwrap().id;
        let parent = storage.create_page(None).await.unwrap().id;
        let child = storage.create_page(Some(&parent)).await.unwrap().id;
        storage.create_page(Some(&child)).await.unwrap();

        storage.delete_page(&parent).await.unwrap();

        let left: Vec<String> = storage
            .list_pages()
            .await
            .unwrap()
            .into_iter()
            .map(|page| page.id)
            .collect();
        assert_eq!(left, [keep]);
    }

    #[tokio::test]
    async fn deleting_an_unknown_page_fails() {
        let storage = storage().await;

        let error = storage.delete_page("missing").await.unwrap_err();

        assert!(matches!(error, StorageError::NotFound(_)));
    }
}
