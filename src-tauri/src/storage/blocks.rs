//! The block repository.
//!
//! The editor hands over the whole document of a page. Saving compares it with
//! what is stored and only writes what differs, so that an edit to one block
//! does not rewrite the page.

use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value};
use surrealdb::types::SurrealValue;

use super::{Storage, StorageError};
use crate::domain::Block;

/// A block as it is stored: flat, with a link to its parent.
#[derive(Debug, Clone, PartialEq, SurrealValue)]
struct BlockRow {
    id: String,
    parent_id: Option<String>,
    position: f64,
    kind: String,
    props: Value,
    content: Option<Value>,
}

/// A row to write, together with the text derived from its content.
#[derive(SurrealValue)]
struct BlockWrite {
    id: String,
    parent_id: Option<String>,
    position: f64,
    kind: String,
    props: Value,
    content: Option<Value>,
    text: String,
    /// The pages this block links to.
    links: Vec<String>,
}

/// What a save changed in the database.
#[derive(Debug, PartialEq, Eq)]
pub struct SaveSummary {
    pub written: usize,
    pub removed: usize,
}

/// A flattened block with what is derived from its content: the plain text
/// and the pages it links to.
type Flat = (BlockRow, String, Vec<String>);

fn flatten(blocks: &[Block], parent_id: Option<&str>, rows: &mut Vec<Flat>) {
    for (index, block) in blocks.iter().enumerate() {
        rows.push((
            BlockRow {
                id: block.id.clone(),
                parent_id: parent_id.map(str::to_owned),
                position: index as f64,
                kind: block.kind.clone(),
                props: Value::Object(block.props.clone()),
                content: block.content.clone(),
            },
            block.plain_text(),
            block.page_links(),
        ));
        flatten(&block.children, Some(&block.id), rows);
    }
}

/// Rebuilds the tree. `rows` must be ordered by position.
fn nest(rows: Vec<BlockRow>) -> Vec<Block> {
    let mut children: HashMap<Option<String>, Vec<BlockRow>> = HashMap::new();
    for row in rows {
        children.entry(row.parent_id.clone()).or_default().push(row);
    }

    fn build(
        parent: Option<String>,
        children: &mut HashMap<Option<String>, Vec<BlockRow>>,
    ) -> Vec<Block> {
        children
            .remove(&parent)
            .unwrap_or_default()
            .into_iter()
            .map(|row| Block {
                children: build(Some(row.id.clone()), children),
                id: row.id,
                kind: row.kind,
                props: match row.props {
                    Value::Object(props) => props,
                    _ => Map::new(),
                },
                content: row.content,
            })
            .collect()
    }

    build(None, &mut children)
}

impl Storage {
    /// The blocks of a page as a tree, in document order.
    pub async fn load_blocks(&self, page_id: &str) -> Result<Vec<Block>, StorageError> {
        self.require_page(page_id).await?;
        Ok(nest(self.block_rows(page_id).await?))
    }

    /// Makes the stored blocks of a page equal to `blocks`.
    pub async fn save_blocks(
        &self,
        page_id: &str,
        blocks: &[Block],
    ) -> Result<SaveSummary, StorageError> {
        self.require_page(page_id).await?;

        let mut incoming = Vec::new();
        flatten(blocks, None, &mut incoming);

        let mut seen = HashSet::new();
        for (row, _, _) in &incoming {
            if !seen.insert(row.id.as_str()) {
                return Err(StorageError::Invalid(format!(
                    "block {} appears more than once in the document",
                    row.id
                )));
            }
        }

        let stored: HashMap<String, BlockRow> = self
            .block_rows(page_id)
            .await?
            .into_iter()
            .map(|row| (row.id.clone(), row))
            .collect();

        // An id that is new to this page must not exist anywhere else.
        let new_ids: Vec<String> = incoming
            .iter()
            .filter(|(row, _, _)| !stored.contains_key(&row.id))
            .map(|(row, _, _)| row.id.clone())
            .collect();
        if !new_ids.is_empty() {
            let taken: Vec<String> = self
                .db
                .query(
                    "SELECT VALUE record::id(id) FROM $ids.map(|$id| type::record('block', $id))",
                )
                .bind(("ids", new_ids))
                .await?
                .take(0)?;
            if let Some(id) = taken.first() {
                return Err(StorageError::Invalid(format!(
                    "block {id} already belongs to another page"
                )));
            }
        }

        let removed: Vec<String> = stored
            .keys()
            .filter(|id| !seen.contains(id.as_str()))
            .cloned()
            .collect();
        let writes: Vec<BlockWrite> = incoming
            .into_iter()
            .filter(|(row, _, _)| stored.get(&row.id) != Some(row))
            .map(|(row, text, links)| BlockWrite {
                id: row.id,
                parent_id: row.parent_id,
                position: row.position,
                kind: row.kind,
                props: row.props,
                content: row.content,
                text,
                links,
            })
            .collect();

        let summary = SaveSummary {
            written: writes.len(),
            removed: removed.len(),
        };
        if summary.written == 0 && summary.removed == 0 {
            return Ok(summary);
        }

        // Writes come first: a block that moved out of a removed parent must
        // have its new parent before the removal cascades to the children.
        self.db
            .query(
                "BEGIN TRANSACTION;
                 LET $page = type::record('page', $page_id);
                 FOR $block IN $writes {
                     UPSERT type::record('block', $block.id) CONTENT {
                         page: $page,
                         parent: IF $block.parent_id = NONE { NONE }
                             ELSE { type::record('block', $block.parent_id) },
                         position: $block.position,
                         type: $block.kind,
                         props: $block.props,
                         content: $block.content,
                         text: $block.text,
                     };
                     -- The links of a block are replaced as a whole.
                     DELETE links_to WHERE block = type::record('block', $block.id);
                     FOR $target IN $block.links {
                         LET $to = type::record('page', $target);
                         IF record::exists($to) {
                             RELATE $page->links_to->$to SET block = type::record('block', $block.id);
                         };
                     };
                 };
                 FOR $id IN $removed {
                     DELETE type::record('block', $id);
                 };
                 UPDATE $page SET updated_at = time::now();
                 COMMIT TRANSACTION;",
            )
            .bind(("page_id", page_id.to_owned()))
            .bind(("writes", writes))
            .bind(("removed", removed))
            .await?
            .check()?;

        Ok(summary)
    }

    async fn block_rows(&self, page_id: &str) -> Result<Vec<BlockRow>, StorageError> {
        let rows: Vec<BlockRow> = self
            .db
            .query(
                "SELECT record::id(id) AS id,
                        IF parent = NONE { NONE } ELSE { record::id(parent) } AS parent_id,
                        position, type AS kind, props, content
                 FROM block WHERE page = type::record('page', $page_id) ORDER BY position",
            )
            .bind(("page_id", page_id.to_owned()))
            .await?
            .take(0)?;

        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    async fn storage_with_page() -> (Storage, String) {
        let storage = Storage::open_in_memory().await.unwrap();
        let page = storage.create_page(None).await.unwrap();
        (storage, page.id)
    }

    fn text(value: &str) -> Value {
        json!([{ "type": "text", "text": value, "styles": {} }])
    }

    fn paragraph(id: &str, value: &str) -> Block {
        Block {
            id: id.into(),
            kind: "paragraph".into(),
            props: Map::new(),
            content: Some(text(value)),
            children: Vec::new(),
        }
    }

    fn with_children(mut block: Block, children: Vec<Block>) -> Block {
        block.children = children;
        block
    }

    async fn stored_text(storage: &Storage, id: &str) -> Option<String> {
        storage
            .db
            .query("SELECT VALUE text FROM ONLY type::record('block', $id)")
            .bind(("id", id.to_owned()))
            .await
            .unwrap()
            .take(0)
            .unwrap()
    }

    #[tokio::test]
    async fn a_new_page_has_no_blocks() {
        let (storage, page) = storage_with_page().await;

        assert_eq!(storage.load_blocks(&page).await.unwrap(), []);
    }

    #[tokio::test]
    async fn a_saved_document_loads_back_identically() {
        let (storage, page) = storage_with_page().await;
        let heading = Block {
            id: "h".into(),
            kind: "heading".into(),
            props: json!({ "level": 2, "textAlignment": "left" })
                .as_object()
                .unwrap()
                .clone(),
            content: Some(json!([
                { "type": "text", "text": "Plan ", "styles": {} },
                { "type": "text", "text": "now", "styles": { "bold": true, "textColor": "red" } },
                { "type": "link", "href": "https://example.com", "content": [
                    { "type": "text", "text": "link", "styles": {} }
                ] }
            ])),
            children: Vec::new(),
        };
        let image = Block {
            id: "img".into(),
            kind: "image".into(),
            props: json!({ "url": "notiva-image://a.png", "previewWidth": 512 })
                .as_object()
                .unwrap()
                .clone(),
            content: None,
            children: Vec::new(),
        };
        let list = with_children(
            paragraph("l1", "First"),
            vec![with_children(
                paragraph("l1a", "Nested"),
                vec![paragraph("l1a1", "Deeper")],
            )],
        );
        let document = vec![heading, list, image, paragraph("p", "Last")];

        storage.save_blocks(&page, &document).await.unwrap();

        assert_eq!(storage.load_blocks(&page).await.unwrap(), document);
    }

    #[tokio::test]
    async fn saving_an_unchanged_document_writes_nothing() {
        let (storage, page) = storage_with_page().await;
        let document = vec![
            with_children(paragraph("a", "One"), vec![paragraph("a1", "Child")]),
            paragraph("b", "Two"),
        ];

        let first = storage.save_blocks(&page, &document).await.unwrap();
        let second = storage.save_blocks(&page, &document).await.unwrap();

        assert_eq!(
            first,
            SaveSummary {
                written: 3,
                removed: 0
            }
        );
        assert_eq!(
            second,
            SaveSummary {
                written: 0,
                removed: 0
            }
        );
    }

    #[tokio::test]
    async fn only_the_edited_block_is_written() {
        let (storage, page) = storage_with_page().await;
        storage
            .save_blocks(&page, &[paragraph("a", "One"), paragraph("b", "Two")])
            .await
            .unwrap();

        let summary = storage
            .save_blocks(
                &page,
                &[paragraph("a", "One"), paragraph("b", "Two, edited")],
            )
            .await
            .unwrap();

        assert_eq!(
            summary,
            SaveSummary {
                written: 1,
                removed: 0
            }
        );
        assert_eq!(
            storage.load_blocks(&page).await.unwrap(),
            [paragraph("a", "One"), paragraph("b", "Two, edited")]
        );
    }

    #[tokio::test]
    async fn reordering_and_removing_are_applied() {
        let (storage, page) = storage_with_page().await;
        storage
            .save_blocks(
                &page,
                &[
                    paragraph("a", "A"),
                    paragraph("b", "B"),
                    paragraph("c", "C"),
                ],
            )
            .await
            .unwrap();

        let reordered = vec![paragraph("c", "C"), paragraph("a", "A")];
        let summary = storage.save_blocks(&page, &reordered).await.unwrap();

        assert_eq!(
            summary,
            SaveSummary {
                written: 2,
                removed: 1
            }
        );
        assert_eq!(storage.load_blocks(&page).await.unwrap(), reordered);
    }

    #[tokio::test]
    async fn a_child_survives_when_it_moves_out_of_a_removed_parent() {
        let (storage, page) = storage_with_page().await;
        storage
            .save_blocks(
                &page,
                &[with_children(
                    paragraph("parent", "P"),
                    vec![paragraph("child", "C")],
                )],
            )
            .await
            .unwrap();

        let document = vec![paragraph("child", "C")];
        storage.save_blocks(&page, &document).await.unwrap();

        assert_eq!(storage.load_blocks(&page).await.unwrap(), document);
    }

    #[tokio::test]
    async fn the_plain_text_is_stored_for_search() {
        let (storage, page) = storage_with_page().await;
        let mut block = paragraph("a", "");
        block.content = Some(json!([
            { "type": "text", "text": "Sourdough ", "styles": {} },
            { "type": "text", "text": "starter", "styles": { "italic": true } }
        ]));

        storage.save_blocks(&page, &[block]).await.unwrap();

        assert_eq!(
            stored_text(&storage, "a").await.as_deref(),
            Some("Sourdough starter")
        );
    }

    #[tokio::test]
    async fn saving_one_page_leaves_another_page_alone() {
        let (storage, first) = storage_with_page().await;
        let second = storage.create_page(None).await.unwrap().id;
        storage
            .save_blocks(&first, &[paragraph("a", "First page")])
            .await
            .unwrap();
        storage
            .save_blocks(&second, &[paragraph("b", "Second page")])
            .await
            .unwrap();

        storage.save_blocks(&second, &[]).await.unwrap();

        assert_eq!(
            storage.load_blocks(&first).await.unwrap(),
            [paragraph("a", "First page")]
        );
        assert_eq!(storage.load_blocks(&second).await.unwrap(), []);
    }

    #[tokio::test]
    async fn a_block_id_cannot_be_taken_from_another_page() {
        let (storage, first) = storage_with_page().await;
        let second = storage.create_page(None).await.unwrap().id;
        storage
            .save_blocks(&first, &[paragraph("a", "Mine")])
            .await
            .unwrap();

        let error = storage
            .save_blocks(&second, &[paragraph("a", "Stolen")])
            .await
            .unwrap_err();

        assert!(matches!(error, StorageError::Invalid(_)));
        assert_eq!(
            storage.load_blocks(&first).await.unwrap(),
            [paragraph("a", "Mine")]
        );
    }

    #[tokio::test]
    async fn a_document_with_a_repeated_block_id_is_refused() {
        let (storage, page) = storage_with_page().await;

        let error = storage
            .save_blocks(&page, &[paragraph("a", "One"), paragraph("a", "Again")])
            .await
            .unwrap_err();

        assert!(matches!(error, StorageError::Invalid(_)));
        assert_eq!(storage.load_blocks(&page).await.unwrap(), []);
    }

    #[tokio::test]
    async fn blocks_of_an_unknown_page_cannot_be_loaded_or_saved() {
        let storage = Storage::open_in_memory().await.unwrap();

        let load = storage.load_blocks("missing").await.unwrap_err();
        let save = storage
            .save_blocks("missing", &[paragraph("a", "A")])
            .await
            .unwrap_err();

        assert!(matches!(load, StorageError::NotFound(_)));
        assert!(matches!(save, StorageError::NotFound(_)));
    }

    #[tokio::test]
    async fn deleting_a_page_removes_its_blocks() {
        let (storage, page) = storage_with_page().await;
        storage
            .save_blocks(&page, &[paragraph("a", "A")])
            .await
            .unwrap();

        storage.delete_page(&page).await.unwrap();

        assert_eq!(stored_text(&storage, "a").await, None);
    }
}
