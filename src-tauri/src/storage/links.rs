//! Links between pages. The edges are written when blocks are saved, see
//! `blocks.rs`; this module reads them.

use surrealdb::types::SurrealValue;

use super::{Storage, StorageError};
use crate::domain::PageRef;

#[derive(SurrealValue)]
struct PageRefRow {
    id: String,
    title: String,
}

impl Storage {
    /// The pages that link to `page_id`, each once, sorted by title. The page
    /// itself is left out.
    pub async fn list_backlinks(&self, page_id: &str) -> Result<Vec<PageRef>, StorageError> {
        self.require_page(page_id).await?;

        let rows: Vec<PageRefRow> = self
            .db
            .query(
                "LET $page = type::record('page', $page_id);
                 SELECT record::id(id) AS id, title FROM array::distinct($page<-links_to<-page)
                     WHERE id != $page ORDER BY title;",
            )
            .bind(("page_id", page_id.to_owned()))
            .await?
            .check()?
            .take(1)?;

        Ok(rows
            .into_iter()
            .map(|row| PageRef {
                id: row.id,
                title: row.title,
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Map, Value, json};

    use super::*;
    use crate::domain::Block;

    async fn page(storage: &Storage, title: &str) -> String {
        let page = storage.create_page(None).await.unwrap();
        storage.rename_page(&page.id, title).await.unwrap();
        page.id
    }

    /// A paragraph that links to the given pages.
    fn linking(id: &str, targets: &[&str]) -> Block {
        let content: Vec<Value> = targets
            .iter()
            .map(|target| json!({ "type": "pageLink", "props": { "pageId": target } }))
            .collect();
        Block {
            id: id.into(),
            kind: "paragraph".into(),
            props: Map::new(),
            content: Some(Value::Array(content)),
            children: Vec::new(),
        }
    }

    async fn backlinks(storage: &Storage, page_id: &str) -> Vec<String> {
        storage
            .list_backlinks(page_id)
            .await
            .unwrap()
            .into_iter()
            .map(|page| page.title)
            .collect()
    }

    #[tokio::test]
    async fn a_page_without_incoming_links_has_no_backlinks() {
        let storage = Storage::open_in_memory().await.unwrap();
        let lonely = page(&storage, "Lonely").await;

        assert!(backlinks(&storage, &lonely).await.is_empty());
    }

    #[tokio::test]
    async fn pages_that_link_to_a_page_are_its_backlinks_sorted_by_title() {
        let storage = Storage::open_in_memory().await.unwrap();
        let target = page(&storage, "Target").await;
        let zebra = page(&storage, "Zebra").await;
        let apple = page(&storage, "Apple").await;
        let unrelated = page(&storage, "Unrelated").await;
        storage
            .save_blocks(&zebra, &[linking("z1", &[&target])])
            .await
            .unwrap();
        storage
            .save_blocks(&apple, &[linking("a1", &[&target])])
            .await
            .unwrap();
        storage
            .save_blocks(&unrelated, &[linking("u1", &[&apple])])
            .await
            .unwrap();

        assert_eq!(backlinks(&storage, &target).await, ["Apple", "Zebra"]);
        assert_eq!(backlinks(&storage, &apple).await, ["Unrelated"]);
    }

    #[tokio::test]
    async fn a_page_that_links_several_times_is_listed_once() {
        let storage = Storage::open_in_memory().await.unwrap();
        let target = page(&storage, "Target").await;
        let source = page(&storage, "Source").await;
        storage
            .save_blocks(
                &source,
                &[
                    linking("s1", &[&target, &target]),
                    linking("s2", &[&target]),
                ],
            )
            .await
            .unwrap();

        assert_eq!(backlinks(&storage, &target).await, ["Source"]);
    }

    #[tokio::test]
    async fn editing_a_block_replaces_its_links() {
        let storage = Storage::open_in_memory().await.unwrap();
        let first = page(&storage, "First").await;
        let second = page(&storage, "Second").await;
        let source = page(&storage, "Source").await;
        storage
            .save_blocks(&source, &[linking("s1", &[&first])])
            .await
            .unwrap();

        storage
            .save_blocks(&source, &[linking("s1", &[&second])])
            .await
            .unwrap();

        assert!(backlinks(&storage, &first).await.is_empty());
        assert_eq!(backlinks(&storage, &second).await, ["Source"]);
    }

    #[tokio::test]
    async fn removing_the_block_or_the_source_page_removes_the_backlink() {
        let storage = Storage::open_in_memory().await.unwrap();
        let target = page(&storage, "Target").await;
        let one = page(&storage, "One").await;
        let two = page(&storage, "Two").await;
        storage
            .save_blocks(&one, &[linking("o1", &[&target])])
            .await
            .unwrap();
        storage
            .save_blocks(&two, &[linking("t1", &[&target])])
            .await
            .unwrap();

        storage.save_blocks(&one, &[]).await.unwrap();
        assert_eq!(backlinks(&storage, &target).await, ["Two"]);

        storage.delete_page(&two).await.unwrap();
        assert!(backlinks(&storage, &target).await.is_empty());
    }

    #[tokio::test]
    async fn a_link_to_itself_is_not_a_backlink() {
        let storage = Storage::open_in_memory().await.unwrap();
        let page_id = page(&storage, "Narcissus").await;
        storage
            .save_blocks(&page_id, &[linking("n1", &[&page_id])])
            .await
            .unwrap();

        assert!(backlinks(&storage, &page_id).await.is_empty());
    }

    #[tokio::test]
    async fn a_link_to_a_page_that_does_not_exist_is_saved_without_an_edge() {
        let storage = Storage::open_in_memory().await.unwrap();
        let source = page(&storage, "Source").await;
        let document = vec![linking("s1", &["missing"])];

        storage.save_blocks(&source, &document).await.unwrap();

        // The content keeps the link, so the editor can show it as deleted.
        assert_eq!(storage.load_blocks(&source).await.unwrap(), document);
    }

    #[tokio::test]
    async fn the_backlink_follows_a_renamed_source_page() {
        let storage = Storage::open_in_memory().await.unwrap();
        let target = page(&storage, "Target").await;
        let source = page(&storage, "Draft").await;
        storage
            .save_blocks(&source, &[linking("s1", &[&target])])
            .await
            .unwrap();

        storage.rename_page(&source, "Final").await.unwrap();

        assert_eq!(backlinks(&storage, &target).await, ["Final"]);
    }

    #[tokio::test]
    async fn backlinks_of_an_unknown_page_cannot_be_listed() {
        let storage = Storage::open_in_memory().await.unwrap();

        let error = storage.list_backlinks("missing").await.unwrap_err();

        assert!(matches!(error, StorageError::NotFound(_)));
    }
}
