//! Turns the blocks of a page into Markdown.

use serde_json::Value;

use crate::domain::Block;

/// What a link to another page becomes in the export.
pub enum PageLink {
    /// The target is exported too: a relative link to its file.
    File {
        title: String,
        path: String,
    },
    /// The target exists but is not part of this export.
    Outside {
        title: String,
    },
    Deleted,
}

/// What the export knows about the world outside the page being written.
pub struct Context<'a> {
    pub page_link: &'a dyn Fn(&str) -> PageLink,
    /// Maps the URL of an image block to what the Markdown should point at.
    pub image: &'a dyn Fn(&str) -> String,
}

/// The Markdown of a whole page, starting with its title.
pub fn page(title: &str, blocks: &[Block], context: &Context) -> String {
    let title = if title.trim().is_empty() {
        "Untitled"
    } else {
        title.trim()
    };
    let mut out = format!("# {}\n", escape(title));
    render(blocks, "", context, &mut out);
    out
}

fn is_list_item(kind: &str) -> bool {
    matches!(
        kind,
        "bulletListItem" | "numberedListItem" | "checkListItem"
    )
}

fn render(blocks: &[Block], indent: &str, context: &Context, out: &mut String) {
    let mut number = 0;
    let mut previous: Option<&str> = None;

    for block in blocks {
        let kind = block.kind.as_str();
        number = if kind == "numberedListItem" {
            number + 1
        } else {
            0
        };

        // Items of one list stay together; everything else is set apart.
        let continues_list = is_list_item(kind) && previous.is_some_and(is_list_item);
        if !continues_list {
            out.push('\n');
        }
        previous = Some(kind);

        let text = || inline(block.content.as_ref(), context);
        let mut children_indent = indent.to_owned();

        match kind {
            "heading" => {
                let level = block
                    .props
                    .get("level")
                    .and_then(Value::as_u64)
                    .unwrap_or(1)
                    .clamp(1, 5);
                // One level below the page title.
                let marks = "#".repeat(level as usize + 1);
                out.push_str(&format!("{indent}{marks} {}\n", text()));
            }
            "bulletListItem" => {
                out.push_str(&format!("{indent}- {}\n", text()));
                children_indent.push_str("  ");
            }
            "numberedListItem" => {
                let marker = format!("{number}. ");
                out.push_str(&format!("{indent}{marker}{}\n", text()));
                children_indent.push_str(&" ".repeat(marker.len()));
            }
            "checkListItem" => {
                let checked = block
                    .props
                    .get("checked")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let mark = if checked { 'x' } else { ' ' };
                out.push_str(&format!("{indent}- [{mark}] {}\n", text()));
                children_indent.push_str("  ");
            }
            "quote" => out.push_str(&format!("{indent}> {}\n", text())),
            "codeBlock" => {
                let language = block
                    .props
                    .get("language")
                    .and_then(Value::as_str)
                    .filter(|language| *language != "text")
                    .unwrap_or("");
                let code = plain(block.content.as_ref());
                // A fence longer than any run of backticks inside the code.
                let longest = code
                    .split(|character| character != '`')
                    .map(str::len)
                    .max()
                    .unwrap_or(0);
                let fence = "`".repeat(longest.max(2) + 1);
                out.push_str(&format!("{indent}{fence}{language}\n"));
                for line in code.lines() {
                    out.push_str(&format!("{indent}{line}\n"));
                }
                out.push_str(&format!("{indent}{fence}\n"));
            }
            "image" => {
                let url = block.props.get("url").and_then(Value::as_str).unwrap_or("");
                if !url.is_empty() {
                    let caption = block
                        .props
                        .get("caption")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    out.push_str(&format!(
                        "{indent}![{}]({})\n",
                        escape(caption),
                        (context.image)(url)
                    ));
                }
            }
            _ => {
                let text = text();
                if !text.is_empty() {
                    out.push_str(&format!("{indent}{}\n", guard_line_start(&text)));
                }
            }
        }

        if !block.children.is_empty() {
            if is_list_item(kind) {
                // Nested items belong to their item, without a gap.
                let mut nested = String::new();
                render(&block.children, &children_indent, context, &mut nested);
                out.push_str(nested.trim_start_matches('\n'));
            } else {
                render(&block.children, indent, context, out);
            }
            // Whatever follows starts a new group.
            previous = if is_list_item(kind) { Some(kind) } else { None };
        }
    }
}

/// The text of inline content without any formatting, for code blocks.
fn plain(content: Option<&Value>) -> String {
    let mut text = String::new();
    if let Some(Value::Array(items)) = content {
        for item in items {
            if let Some(piece) = item.get("text").and_then(Value::as_str) {
                text.push_str(piece);
            }
        }
    }
    text
}

fn inline(content: Option<&Value>, context: &Context) -> String {
    let Some(Value::Array(items)) = content else {
        return String::new();
    };

    let mut out = String::new();
    for item in items {
        match item.get("type").and_then(Value::as_str) {
            Some("text") => {
                let text = item.get("text").and_then(Value::as_str).unwrap_or("");
                out.push_str(&styled(text, item.get("styles")));
            }
            Some("link") => {
                let href = item.get("href").and_then(Value::as_str).unwrap_or("");
                let text = inline(item.get("content"), context);
                out.push_str(&format!(
                    "[{text}]({})",
                    href.replace(' ', "%20").replace(')', "%29")
                ));
            }
            Some("pageLink") => {
                let target = item
                    .get("props")
                    .and_then(|props| props.get("pageId"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let name = |title: &str| {
                    if title.trim().is_empty() {
                        "Untitled".to_owned()
                    } else {
                        escape(title.trim())
                    }
                };
                match (context.page_link)(target) {
                    PageLink::File { title, path } => {
                        out.push_str(&format!("[{}]({path})", name(&title)))
                    }
                    PageLink::Outside { title } => out.push_str(&name(&title)),
                    PageLink::Deleted => out.push_str("Deleted page"),
                }
            }
            _ => {}
        }
    }
    out
}

/// Wraps text in the markers of its styles. Markers have to touch the text,
/// so surrounding spaces stay outside of them.
fn styled(text: &str, styles: Option<&Value>) -> String {
    let has = |style: &str| {
        styles
            .and_then(|styles| styles.get(style))
            .and_then(Value::as_bool)
            .unwrap_or(false)
    };

    let core = text.trim();
    if core.is_empty() {
        return text.replace('\n', "  \n");
    }
    let start = text.len() - text.trim_start().len();
    let (leading, trailing) = (&text[..start], &text[start + core.len()..]);

    let mut body = if has("code") {
        let ticks = if core.contains('`') { "``" } else { "`" };
        format!("{ticks}{core}{ticks}")
    } else {
        escape(core).replace('\n', "  \n")
    };
    if has("bold") {
        body = format!("**{body}**");
    }
    if has("italic") {
        body = format!("*{body}*");
    }
    if has("strike") {
        body = format!("~~{body}~~");
    }
    if has("underline") {
        body = format!("<u>{body}</u>");
    }

    format!("{leading}{body}{trailing}")
}

/// Escapes the characters Markdown reads as formatting anywhere in a line.
fn escape(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        if matches!(
            character,
            '\\' | '`' | '*' | '_' | '[' | ']' | '<' | '>' | '#' | '|'
        ) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

/// A paragraph must not start like a list, a quote or a heading.
fn guard_line_start(line: &str) -> String {
    let starts_list = line.starts_with("- ") || line.starts_with("+ ");
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    let starts_numbered = digits > 0 && line[digits..].starts_with(['.', ')']);

    if starts_list {
        format!("\\{line}")
    } else if starts_numbered {
        format!("{}\\{}", &line[..digits], &line[digits..])
    } else {
        line.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Map, json};

    use super::*;

    fn block(kind: &str, content: Value, props: Value, children: Vec<Block>) -> Block {
        Block {
            id: "b".into(),
            kind: kind.into(),
            props: props.as_object().cloned().unwrap_or_else(Map::new),
            content: if content.is_null() {
                None
            } else {
                Some(content)
            },
            children,
        }
    }

    fn text(value: &str) -> Value {
        json!([{ "type": "text", "text": value, "styles": {} }])
    }

    fn simple(kind: &str, value: &str) -> Block {
        block(kind, text(value), json!({}), vec![])
    }

    fn markdown(blocks: &[Block]) -> String {
        let context = Context {
            page_link: &|id| match id {
                "inside" => PageLink::File {
                    title: "Reading list".into(),
                    path: "Reading%20list.md".into(),
                },
                "outside" => PageLink::Outside {
                    title: "Elsewhere".into(),
                },
                _ => PageLink::Deleted,
            },
            image: &|url| url.replace("notiva-image://localhost/", "assets/"),
        };
        page("Title", blocks, &context)
    }

    #[test]
    fn a_page_starts_with_its_title() {
        assert_eq!(markdown(&[]), "# Title\n");
        let context = Context {
            page_link: &|_| PageLink::Deleted,
            image: &|url| url.to_owned(),
        };
        assert_eq!(page("  ", &[], &context), "# Untitled\n");
    }

    #[test]
    fn paragraphs_are_separated_by_blank_lines() {
        assert_eq!(
            markdown(&[simple("paragraph", "First"), simple("paragraph", "Second")]),
            "# Title\n\nFirst\n\nSecond\n"
        );
    }

    #[test]
    fn headings_sit_one_level_below_the_title() {
        let headings: Vec<Block> = (1..=3)
            .map(|level| block("heading", text("H"), json!({ "level": level }), vec![]))
            .collect();

        assert_eq!(markdown(&headings), "# Title\n\n## H\n\n### H\n\n#### H\n");
    }

    #[test]
    fn lists_are_tight_and_numbered_in_sequence() {
        let blocks = [
            simple("bulletListItem", "One"),
            simple("bulletListItem", "Two"),
            simple("paragraph", "Between"),
            simple("numberedListItem", "First"),
            simple("numberedListItem", "Second"),
            simple("paragraph", "After"),
            simple("numberedListItem", "Starts again"),
        ];

        assert_eq!(
            markdown(&blocks),
            "# Title\n\n- One\n- Two\n\nBetween\n\n1. First\n2. Second\n\nAfter\n\n1. Starts again\n"
        );
    }

    #[test]
    fn check_lists_show_their_state() {
        let blocks = [
            block(
                "checkListItem",
                text("Done"),
                json!({ "checked": true }),
                vec![],
            ),
            block(
                "checkListItem",
                text("Open"),
                json!({ "checked": false }),
                vec![],
            ),
        ];

        assert_eq!(markdown(&blocks), "# Title\n\n- [x] Done\n- [ ] Open\n");
    }

    #[test]
    fn nested_list_items_are_indented_below_their_item() {
        let blocks = [
            block(
                "bulletListItem",
                text("Outer"),
                json!({}),
                vec![
                    block(
                        "bulletListItem",
                        text("Inner"),
                        json!({}),
                        vec![simple("bulletListItem", "Deep")],
                    ),
                    simple("bulletListItem", "Inner two"),
                ],
            ),
            block(
                "numberedListItem",
                text("Numbered"),
                json!({}),
                vec![simple("numberedListItem", "Sub")],
            ),
        ];

        assert_eq!(
            markdown(&blocks),
            "# Title\n\n- Outer\n  - Inner\n    - Deep\n  - Inner two\n1. Numbered\n   1. Sub\n"
        );
    }

    #[test]
    fn quotes_and_code_blocks_keep_their_form() {
        let blocks = [
            simple("quote", "Wise words"),
            block(
                "codeBlock",
                text("let a = 1;\nlet b = `x`;"),
                json!({ "language": "javascript" }),
                vec![],
            ),
            block(
                "codeBlock",
                text("no language"),
                json!({ "language": "text" }),
                vec![],
            ),
        ];

        assert_eq!(
            markdown(&blocks),
            "# Title\n\n> Wise words\n\n```javascript\nlet a = 1;\nlet b = `x`;\n```\n\n```\nno language\n```\n"
        );
    }

    #[test]
    fn code_containing_a_fence_gets_a_longer_fence() {
        let blocks = [block(
            "codeBlock",
            text("```\ninner\n```"),
            json!({}),
            vec![],
        )];

        assert_eq!(
            markdown(&blocks),
            "# Title\n\n````\n```\ninner\n```\n````\n"
        );
    }

    #[test]
    fn inline_styles_become_markdown() {
        let content = json!([
            { "type": "text", "text": "plain ", "styles": {} },
            { "type": "text", "text": "bold", "styles": { "bold": true } },
            { "type": "text", "text": " ", "styles": {} },
            { "type": "text", "text": "italic", "styles": { "italic": true } },
            { "type": "text", "text": " ", "styles": {} },
            { "type": "text", "text": "gone", "styles": { "strike": true } },
            { "type": "text", "text": " ", "styles": {} },
            { "type": "text", "text": "x = 1", "styles": { "code": true } },
            { "type": "text", "text": " ", "styles": {} },
            { "type": "text", "text": "under", "styles": { "underline": true } },
            { "type": "text", "text": " ", "styles": {} },
            { "type": "text", "text": "both", "styles": { "bold": true, "italic": true, "textColor": "red" } }
        ]);

        assert_eq!(
            markdown(&[block("paragraph", content, json!({}), vec![])]),
            "# Title\n\nplain **bold** *italic* ~~gone~~ `x = 1` <u>under</u> ***both***\n"
        );
    }

    #[test]
    fn spaces_stay_outside_of_emphasis_markers() {
        let content = json!([
            { "type": "text", "text": "a", "styles": {} },
            { "type": "text", "text": " bold ", "styles": { "bold": true } },
            { "type": "text", "text": "b", "styles": {} }
        ]);

        assert_eq!(
            markdown(&[block("paragraph", content, json!({}), vec![])]),
            "# Title\n\na **bold** b\n"
        );
    }

    #[test]
    fn characters_with_a_meaning_in_markdown_are_escaped() {
        let blocks = [
            simple(
                "paragraph",
                "2 * 3 = 6, snake_case, [not a link], <tag>, # not a heading",
            ),
            simple("paragraph", "- not a list"),
            simple("paragraph", "1. not numbered"),
        ];

        assert_eq!(
            markdown(&blocks),
            "# Title\n\n2 \\* 3 = 6, snake\\_case, \\[not a link\\], \\<tag\\>, \\# not a heading\n\n\\- not a list\n\n1\\. not numbered\n"
        );
    }

    #[test]
    fn web_links_and_the_three_kinds_of_page_link() {
        let content = json!([
            { "type": "link", "href": "https://example.com/a b", "content": [
                { "type": "text", "text": "site", "styles": { "bold": true } }
            ] },
            { "type": "text", "text": " ", "styles": {} },
            { "type": "pageLink", "props": { "pageId": "inside" } },
            { "type": "text", "text": " ", "styles": {} },
            { "type": "pageLink", "props": { "pageId": "outside" } },
            { "type": "text", "text": " ", "styles": {} },
            { "type": "pageLink", "props": { "pageId": "gone" } }
        ]);

        assert_eq!(
            markdown(&[block("paragraph", content, json!({}), vec![])]),
            "# Title\n\n[**site**](https://example.com/a%20b) [Reading list](Reading%20list.md) Elsewhere Deleted page\n"
        );
    }

    #[test]
    fn images_point_at_the_copied_file() {
        let blocks = [
            block(
                "image",
                Value::Null,
                json!({ "url": "notiva-image://localhost/abc.png", "caption": "A [cat]" }),
                vec![],
            ),
            block(
                "image",
                Value::Null,
                json!({ "url": "https://example.com/dog.jpg" }),
                vec![],
            ),
            block("image", Value::Null, json!({ "url": "" }), vec![]),
        ];

        assert_eq!(
            markdown(&blocks),
            "# Title\n\n![A \\[cat\\]](assets/abc.png)\n\n![](https://example.com/dog.jpg)\n\n"
        );
    }

    #[test]
    fn a_line_break_inside_a_block_is_a_hard_break() {
        assert_eq!(
            markdown(&[simple("paragraph", "one\ntwo")]),
            "# Title\n\none  \ntwo\n"
        );
    }

    #[test]
    fn children_of_a_paragraph_follow_it() {
        let blocks = [block(
            "paragraph",
            text("Parent"),
            json!({}),
            vec![simple("paragraph", "Child")],
        )];

        assert_eq!(markdown(&blocks), "# Title\n\nParent\n\nChild\n");
    }
}
