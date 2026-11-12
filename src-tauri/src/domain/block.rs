use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// A block of a page, in the shape the editor uses. Blocks nest through
/// `children`; their order in the list is their order on the page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Block {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub props: Map<String, Value>,
    /// Inline content. Absent for blocks without text, such as images.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<Value>,
    #[serde(default)]
    pub children: Vec<Block>,
}

impl Block {
    /// The text of this block without any formatting, for search. The text of
    /// child blocks is not included; they are blocks of their own.
    pub fn plain_text(&self) -> String {
        let mut text = String::new();
        if let Some(content) = &self.content {
            collect_text(content, &mut text);
        }
        text.trim().to_owned()
    }
}

/// Walks inline content: styled text, links that wrap text, and table cells.
fn collect_text(value: &Value, text: &mut String) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_text(item, text);
            }
        }
        Value::Object(object) => {
            if let Some(Value::String(own)) = object.get("text") {
                text.push_str(own);
            }
            for key in ["content", "rows", "cells"] {
                if let Some(nested) = object.get(key) {
                    collect_text(nested, text);
                    // Cells and rows are separate pieces of text.
                    if key != "content" || object.get("type") == Some(&Value::from("tableCell")) {
                        text.push(' ');
                    }
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn block(content: Value) -> Block {
        Block {
            id: "b".into(),
            kind: "paragraph".into(),
            props: Map::new(),
            content: Some(content),
            children: Vec::new(),
        }
    }

    #[test]
    fn styled_runs_are_joined_without_gaps() {
        let block = block(json!([
            { "type": "text", "text": "Hello ", "styles": {} },
            { "type": "text", "text": "wor", "styles": { "bold": true } },
            { "type": "text", "text": "ld", "styles": {} }
        ]));

        assert_eq!(block.plain_text(), "Hello world");
    }

    #[test]
    fn link_text_is_included() {
        let block = block(json!([
            { "type": "text", "text": "See ", "styles": {} },
            { "type": "link", "href": "https://example.com", "content": [
                { "type": "text", "text": "the docs", "styles": {} }
            ] }
        ]));

        assert_eq!(block.plain_text(), "See the docs");
    }

    #[test]
    fn table_cells_are_separated() {
        let block = block(json!({
            "type": "tableContent",
            "rows": [
                { "cells": [
                    { "type": "tableCell", "content": [{ "type": "text", "text": "A1", "styles": {} }] },
                    { "type": "tableCell", "content": [{ "type": "text", "text": "B1", "styles": {} }] }
                ] }
            ]
        }));

        assert_eq!(
            block.plain_text().split_whitespace().collect::<Vec<_>>(),
            ["A1", "B1"]
        );
    }

    #[test]
    fn a_block_without_content_has_no_text() {
        let mut image = block(json!([]));
        image.content = None;

        assert_eq!(image.plain_text(), "");
    }

    #[test]
    fn the_editor_shape_round_trips_through_json() {
        let json = json!({
            "id": "b1",
            "type": "heading",
            "props": { "level": 2 },
            "content": [{ "type": "text", "text": "Title", "styles": {} }],
            "children": []
        });

        let block: Block = serde_json::from_value(json.clone()).unwrap();

        assert_eq!(block.kind, "heading");
        assert_eq!(serde_json::to_value(&block).unwrap(), json);
    }
}
