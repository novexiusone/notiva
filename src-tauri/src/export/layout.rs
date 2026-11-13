//! Decides which page goes to which file of an export.

use std::collections::{HashMap, HashSet};

use crate::domain::Page;

/// Where images are collected. Reserved, so no page can be exported under
/// this name at the top level.
pub const ASSETS: &str = "assets";

const MAX_NAME: usize = 100;

/// The files of an export: for every exported page its path below the export
/// folder, as segments, the last one being the file name.
pub struct Layout {
    files: HashMap<String, Vec<String>>,
    /// Page ids in the order they were laid out: parents before children.
    pub order: Vec<String>,
}

/// Turns a page title into a file name without its extension.
pub fn file_name(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            character if character.is_control() => ' ',
            character => character,
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    // A name must not start or end with a dot or a space.
    let trimmed: String = collapsed
        .trim_matches(|character| character == '.' || character == ' ')
        .chars()
        .take(MAX_NAME)
        .collect();
    let trimmed = trimmed.trim_end().to_owned();

    if trimmed.is_empty() {
        "Untitled".into()
    } else {
        trimmed
    }
}

/// Lays out `roots` and everything below them. Names are unique among
/// siblings without regard to case, because the file system may not care.
pub fn plan(pages: &[Page], roots: &[String]) -> Layout {
    let mut children: HashMap<Option<&str>, Vec<&Page>> = HashMap::new();
    for page in pages {
        children
            .entry(page.parent_id.as_deref())
            .or_default()
            .push(page);
    }
    for siblings in children.values_mut() {
        siblings.sort_by(|a, b| a.position.total_cmp(&b.position));
    }
    let by_id: HashMap<&str, &Page> = pages.iter().map(|page| (page.id.as_str(), page)).collect();

    let mut layout = Layout {
        files: HashMap::new(),
        order: Vec::new(),
    };
    let top: Vec<&Page> = roots
        .iter()
        .filter_map(|id| by_id.get(id.as_str()).copied())
        .collect();
    place(&top, &[], &children, &mut layout, &[ASSETS]);
    layout
}

fn place(
    siblings: &[&Page],
    folder: &[String],
    children: &HashMap<Option<&str>, Vec<&Page>>,
    layout: &mut Layout,
    reserved: &[&str],
) {
    let mut taken: HashSet<String> = reserved.iter().map(|name| name.to_lowercase()).collect();

    for page in siblings {
        let base = file_name(&page.title);
        let mut name = base.clone();
        let mut number = 2;
        while !taken.insert(name.to_lowercase()) {
            name = format!("{base} {number}");
            number += 1;
        }

        let mut path = folder.to_vec();
        path.push(format!("{name}.md"));
        layout.files.insert(page.id.clone(), path);
        layout.order.push(page.id.clone());

        if let Some(subpages) = children.get(&Some(page.id.as_str())) {
            let mut subfolder = folder.to_vec();
            subfolder.push(name);
            place(subpages, &subfolder, children, layout, &[]);
        }
    }
}

impl Layout {
    /// The path of a page's file below the export folder.
    pub fn path(&self, page_id: &str) -> Option<&[String]> {
        self.files.get(page_id).map(Vec::as_slice)
    }

    /// A relative, URL-encoded link from one exported page to another.
    pub fn link(&self, from: &str, to: &str) -> Option<String> {
        let from = self.path(from)?;
        let to = self.path(to)?;
        Some(relative(&from[..from.len() - 1], to))
    }

    /// A relative, URL-encoded link from an exported page to an image.
    pub fn asset_link(&self, from: &str, file: &str) -> Option<String> {
        let from = self.path(from)?;
        Some(relative(
            &from[..from.len() - 1],
            &[ASSETS.to_owned(), file.to_owned()],
        ))
    }
}

/// The way from a folder to a file, both given as segments below one root.
fn relative(from_folder: &[String], to: &[String]) -> String {
    let shared = from_folder
        .iter()
        .zip(to)
        .take_while(|(a, b)| a == b)
        .count();
    let shared = shared.min(to.len() - 1);

    let up = std::iter::repeat_n("..".to_owned(), from_folder.len() - shared);
    let down = to[shared..].iter().map(|segment| encode(segment));
    up.chain(down).collect::<Vec<_>>().join("/")
}

/// Percent-encodes what would break a Markdown link target.
fn encode(segment: &str) -> String {
    let mut encoded = String::new();
    for byte in segment.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(id: &str, title: &str, parent: Option<&str>, position: f64) -> Page {
        Page {
            id: id.into(),
            title: title.into(),
            parent_id: parent.map(str::to_owned),
            position,
            kind: crate::domain::PageKind::Page,
            database_id: None,
        }
    }

    fn path(layout: &Layout, id: &str) -> String {
        layout.path(id).unwrap().join("/")
    }

    #[test]
    fn subpages_go_into_a_folder_named_after_their_parent() {
        let pages = [
            page("r", "Reading list", None, 0.0),
            page("f", "Fiction", Some("r"), 0.0),
            page("d", "Dune", Some("f"), 0.0),
            page("p", "Projects", None, 1.0),
        ];

        let layout = plan(&pages, &["r".into(), "p".into()]);

        assert_eq!(path(&layout, "r"), "Reading list.md");
        assert_eq!(path(&layout, "f"), "Reading list/Fiction.md");
        assert_eq!(path(&layout, "d"), "Reading list/Fiction/Dune.md");
        assert_eq!(path(&layout, "p"), "Projects.md");
        assert_eq!(layout.order, ["r", "f", "d", "p"]);
    }

    #[test]
    fn only_the_chosen_page_and_its_subpages_are_laid_out() {
        let pages = [
            page("a", "A", None, 0.0),
            page("a1", "A1", Some("a"), 0.0),
            page("b", "B", None, 1.0),
        ];

        let layout = plan(&pages, &["a".into()]);

        assert_eq!(layout.order, ["a", "a1"]);
        assert!(layout.path("b").is_none());
    }

    #[test]
    fn titles_are_cleaned_into_file_names() {
        assert_eq!(file_name("Notes: 1/2 <draft>?"), "Notes- 1-2 -draft--");
        assert_eq!(file_name("  spaced   out \n title  "), "spaced out title");
        assert_eq!(file_name("...hidden."), "hidden");
        assert_eq!(file_name(""), "Untitled");
        assert_eq!(file_name(" . "), "Untitled");
        assert_eq!(file_name(&"x".repeat(300)).chars().count(), 100);
        assert_eq!(file_name("../../etc/passwd"), "-..-etc-passwd");
    }

    #[test]
    fn pages_with_the_same_name_get_a_number() {
        let pages = [
            page("a", "Notes", None, 0.0),
            page("b", "notes", None, 1.0),
            page("c", "", None, 2.0),
            page("d", "", None, 3.0),
            page("e", "Assets", None, 4.0),
        ];
        let roots: Vec<String> = pages.iter().map(|page| page.id.clone()).collect();

        let layout = plan(&pages, &roots);

        assert_eq!(path(&layout, "a"), "Notes.md");
        assert_eq!(path(&layout, "b"), "notes 2.md");
        assert_eq!(path(&layout, "c"), "Untitled.md");
        assert_eq!(path(&layout, "d"), "Untitled 2.md");
        // "assets" at the top level belongs to the images.
        assert_eq!(path(&layout, "e"), "Assets 2.md");
    }

    #[test]
    fn links_between_pages_are_relative_and_encoded() {
        let pages = [
            page("r", "Reading list", None, 0.0),
            page("f", "Fiction & more", Some("r"), 0.0),
            page("d", "Dune", Some("f"), 0.0),
            page("p", "Projects", None, 1.0),
        ];
        let layout = plan(&pages, &["r".into(), "p".into()]);

        assert_eq!(layout.link("p", "r").unwrap(), "Reading%20list.md");
        assert_eq!(
            layout.link("r", "f").unwrap(),
            "Reading%20list/Fiction%20%26%20more.md"
        );
        assert_eq!(layout.link("d", "p").unwrap(), "../../Projects.md");
        assert_eq!(layout.link("d", "f").unwrap(), "../Fiction%20%26%20more.md");
        assert_eq!(
            layout.link("f", "d").unwrap(),
            "Fiction%20%26%20more/Dune.md"
        );
        assert!(layout.link("p", "missing").is_none());
    }

    #[test]
    fn images_are_linked_relative_to_the_page() {
        let pages = [
            page("r", "Root", None, 0.0),
            page("c", "Child", Some("r"), 0.0),
        ];
        let layout = plan(&pages, &["r".into()]);

        assert_eq!(layout.asset_link("r", "a.png").unwrap(), "assets/a.png");
        assert_eq!(layout.asset_link("c", "a.png").unwrap(), "../assets/a.png");
    }
}
