//! Export to Markdown: reads pages, blocks and images and writes them as
//! plain files into a new folder.

mod layout;
mod markdown;

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

use crate::domain::Page;
use crate::media::{self, ImageStore};
use crate::storage::{Storage, StorageError};

const FOLDER: &str = "Notiva export";

#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("{0} is not a folder")]
    NotAFolder(String),

    #[error(transparent)]
    Storage(#[from] StorageError),

    #[error("could not write the export: {0}")]
    Io(#[from] std::io::Error),
}

/// What to export.
pub enum Scope<'a> {
    /// One page with its subpages.
    Page(&'a str),
    All,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct ExportSummary {
    /// The folder that was created.
    pub directory: String,
    pub pages: usize,
    pub images: usize,
}

/// Exports into a new folder inside `parent`. Nothing that exists in
/// `parent` is touched, and a failed export leaves no folder behind.
pub async fn export(
    storage: &Storage,
    images: &ImageStore,
    scope: Scope<'_>,
    parent: &Path,
) -> Result<ExportSummary, ExportError> {
    if !parent.is_dir() {
        return Err(ExportError::NotAFolder(parent.display().to_string()));
    }

    let pages = storage.list_pages().await?;
    let roots: Vec<String> = match scope {
        Scope::Page(id) => {
            // Fails with "not found" for an unknown page.
            storage.load_blocks(id).await?;
            vec![id.to_owned()]
        }
        Scope::All => pages
            .iter()
            .filter(|page| page.parent_id.is_none())
            .map(|page| page.id.clone())
            .collect(),
    };

    // Written under a temporary name and renamed at the end, so that a
    // folder called "Notiva export" is always a complete export.
    let partial = parent.join(format!(
        ".{FOLDER}.{}.partial",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir(&partial)?;

    let written = write(storage, images, &pages, &roots, &partial).await;
    let result = written.and_then(|(page_count, image_count)| {
        let target = free_name(parent);
        std::fs::rename(&partial, &target)?;
        Ok(ExportSummary {
            directory: target.display().to_string(),
            pages: page_count,
            images: image_count,
        })
    });

    if result.is_err() {
        // Only ever the folder created above.
        let _ = std::fs::remove_dir_all(&partial);
    }
    result
}

/// "Notiva export", or the first numbered variant that does not exist yet.
fn free_name(parent: &Path) -> PathBuf {
    let mut candidate = parent.join(FOLDER);
    let mut number = 2;
    while candidate.exists() {
        candidate = parent.join(format!("{FOLDER} {number}"));
        number += 1;
    }
    candidate
}

async fn write(
    storage: &Storage,
    images: &ImageStore,
    pages: &[Page],
    roots: &[String],
    folder: &Path,
) -> Result<(usize, usize), ExportError> {
    let layout = layout::plan(pages, roots);
    let titles: HashMap<&str, &str> = pages
        .iter()
        .map(|page| (page.id.as_str(), page.title.as_str()))
        .collect();
    let image_prefix = format!("{}://localhost/", media::SCHEME);
    // The image files that the exported pages refer to.
    let used_images: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

    for page_id in &layout.order {
        let Some(path) = layout.path(page_id) else {
            continue;
        };
        let blocks = storage.load_blocks(page_id).await?;

        let context = markdown::Context {
            page_link: &|target| match (titles.get(target), layout.link(page_id, target)) {
                (Some(title), Some(path)) => markdown::PageLink::File {
                    title: (*title).to_owned(),
                    path,
                },
                (Some(title), None) => markdown::PageLink::Outside {
                    title: (*title).to_owned(),
                },
                (None, _) => markdown::PageLink::Deleted,
            },
            image: &|url| match url.strip_prefix(&image_prefix) {
                Some(file) => {
                    used_images.lock().unwrap().insert(file.to_owned());
                    layout
                        .asset_link(page_id, file)
                        .unwrap_or_else(|| url.to_owned())
                }
                None => url.to_owned(),
            },
        };
        let text = markdown::page(
            titles.get(page_id.as_str()).copied().unwrap_or(""),
            &blocks,
            &context,
        );

        let file = path
            .iter()
            .fold(folder.to_owned(), |file, segment| file.join(segment));
        if let Some(directory) = file.parent() {
            std::fs::create_dir_all(directory)?;
        }
        std::fs::write(file, text)?;
    }

    let mut image_count = 0;
    let assets = folder.join(layout::ASSETS);
    for file in used_images.into_inner().unwrap() {
        // `read` only accepts names the image store generated itself.
        if let Some((bytes, _)) = images.read(&file) {
            std::fs::create_dir_all(&assets)?;
            std::fs::write(assets.join(&file), bytes)?;
            image_count += 1;
        }
    }

    Ok((layout.order.len(), image_count))
}

#[cfg(test)]
mod tests {
    use serde_json::{Map, Value, json};

    use super::*;
    use crate::domain::Block;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nrest of the file";

    struct Workspace {
        directory: tempfile::TempDir,
        storage: Storage,
        images: ImageStore,
    }

    impl Workspace {
        async fn new() -> Self {
            let directory = tempfile::tempdir().unwrap();
            let storage = Storage::open_in_memory().await.unwrap();
            let images = ImageStore::open(&directory.path().join("images")).unwrap();
            std::fs::create_dir(directory.path().join("out")).unwrap();
            Self {
                directory,
                storage,
                images,
            }
        }

        fn out(&self) -> PathBuf {
            self.directory.path().join("out")
        }

        async fn page(&self, title: &str, parent: Option<&str>, blocks: &[Block]) -> String {
            let page = self.storage.create_page(parent).await.unwrap();
            self.storage.rename_page(&page.id, title).await.unwrap();
            self.storage.save_blocks(&page.id, blocks).await.unwrap();
            page.id
        }

        async fn export(&self, scope: Scope<'_>) -> Result<ExportSummary, ExportError> {
            export(&self.storage, &self.images, scope, &self.out()).await
        }
    }

    fn block(id: &str, kind: &str, content: Value, props: Value) -> Block {
        Block {
            id: id.into(),
            kind: kind.into(),
            props: props.as_object().cloned().unwrap_or_else(Map::new),
            content: if content.is_null() {
                None
            } else {
                Some(content)
            },
            children: Vec::new(),
        }
    }

    fn paragraph(id: &str, content: Value) -> Block {
        block(id, "paragraph", content, json!({}))
    }

    /// Every file below a folder, as paths relative to it, sorted.
    fn files(folder: &Path) -> Vec<String> {
        fn walk(folder: &Path, root: &Path, found: &mut Vec<String>) {
            for entry in std::fs::read_dir(folder).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    walk(&path, root, found);
                } else {
                    found.push(path.strip_prefix(root).unwrap().display().to_string());
                }
            }
        }
        let mut found = Vec::new();
        walk(folder, folder, &mut found);
        found.sort();
        found
    }

    #[tokio::test]
    async fn the_whole_workspace_is_written_as_a_folder_structure() {
        let workspace = Workspace::new().await;
        let image = workspace.images.save(PNG).unwrap();
        let image_file = image.rsplit('/').next().unwrap().to_owned();
        let projects = workspace.page("Projects", None, &[]).await;
        let reading = workspace
            .page(
                "Reading list",
                None,
                &[paragraph(
                    "r1",
                    json!([
                        { "type": "text", "text": "See ", "styles": {} },
                        { "type": "pageLink", "props": { "pageId": projects } }
                    ]),
                )],
            )
            .await;
        workspace
            .page(
                "Fiction",
                Some(&reading),
                &[
                    block(
                        "f1",
                        "heading",
                        json!([{ "type": "text", "text": "Dune", "styles": {} }]),
                        json!({ "level": 1 }),
                    ),
                    block(
                        "f2",
                        "image",
                        Value::Null,
                        json!({ "url": image, "caption": "Cover" }),
                    ),
                    paragraph(
                        "f3",
                        json!([
                            { "type": "text", "text": "Back to ", "styles": {} },
                            { "type": "pageLink", "props": { "pageId": reading } }
                        ]),
                    ),
                ],
            )
            .await;

        let summary = workspace.export(Scope::All).await.unwrap();

        let folder = workspace.out().join("Notiva export");
        assert_eq!(
            summary,
            ExportSummary {
                directory: folder.display().to_string(),
                pages: 3,
                images: 1
            }
        );
        assert_eq!(
            files(&folder),
            [
                "Projects.md".to_owned(),
                "Reading list.md".to_owned(),
                "Reading list/Fiction.md".to_owned(),
                format!("assets/{image_file}"),
            ]
        );
        assert_eq!(
            std::fs::read_to_string(folder.join("Reading list.md")).unwrap(),
            "# Reading list\n\nSee [Projects](Projects.md)\n"
        );
        assert_eq!(
            std::fs::read_to_string(folder.join("Reading list/Fiction.md")).unwrap(),
            format!(
                "# Fiction\n\n## Dune\n\n![Cover](../assets/{image_file})\n\nBack to [Reading list](../Reading%20list.md)\n"
            )
        );
        assert_eq!(
            std::fs::read(folder.join("assets").join(&image_file)).unwrap(),
            PNG
        );
    }

    #[tokio::test]
    async fn a_single_page_is_exported_with_its_subpages_only() {
        let workspace = Workspace::new().await;
        let other = workspace.page("Other", None, &[]).await;
        let parent = workspace
            .page(
                "Parent",
                None,
                &[paragraph(
                    "p1",
                    json!([{ "type": "pageLink", "props": { "pageId": other } }]),
                )],
            )
            .await;
        workspace.page("Child", Some(&parent), &[]).await;

        let summary = workspace.export(Scope::Page(&parent)).await.unwrap();

        let folder = workspace.out().join("Notiva export");
        assert_eq!(summary.pages, 2);
        assert_eq!(files(&folder), ["Parent.md", "Parent/Child.md"]);
        // A page outside the export is named, not linked.
        assert_eq!(
            std::fs::read_to_string(folder.join("Parent.md")).unwrap(),
            "# Parent\n\nOther\n"
        );
    }

    #[tokio::test]
    async fn an_existing_export_is_never_overwritten() {
        let workspace = Workspace::new().await;
        workspace.page("Page", None, &[]).await;
        let existing = workspace.out().join("Notiva export");
        std::fs::create_dir(&existing).unwrap();
        std::fs::write(existing.join("keep.txt"), "mine").unwrap();

        let first = workspace.export(Scope::All).await.unwrap();
        let second = workspace.export(Scope::All).await.unwrap();

        assert!(
            first.directory.ends_with("Notiva export 2"),
            "{}",
            first.directory
        );
        assert!(
            second.directory.ends_with("Notiva export 3"),
            "{}",
            second.directory
        );
        assert_eq!(files(&existing), ["keep.txt"]);
    }

    #[tokio::test]
    async fn an_unknown_page_or_folder_fails_without_leaving_anything_behind() {
        let workspace = Workspace::new().await;
        workspace.page("Page", None, &[]).await;

        let unknown_page = workspace.export(Scope::Page("missing")).await.unwrap_err();
        let unknown_folder = export(
            &workspace.storage,
            &workspace.images,
            Scope::All,
            &workspace.out().join("does not exist"),
        )
        .await
        .unwrap_err();

        assert!(matches!(
            unknown_page,
            ExportError::Storage(StorageError::NotFound(_))
        ));
        assert!(matches!(unknown_folder, ExportError::NotAFolder(_)));
        assert_eq!(std::fs::read_dir(workspace.out()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn an_image_whose_file_is_missing_does_not_stop_the_export() {
        let workspace = Workspace::new().await;
        let missing = format!("notiva-image://localhost/{}.png", "a".repeat(32));
        workspace
            .page(
                "Page",
                None,
                &[block("i1", "image", Value::Null, json!({ "url": missing }))],
            )
            .await;

        let summary = workspace.export(Scope::All).await.unwrap();

        assert_eq!(summary.pages, 1);
        assert_eq!(summary.images, 0);
    }

    #[tokio::test]
    async fn an_image_reference_cannot_reach_outside_the_image_store() {
        let workspace = Workspace::new().await;
        std::fs::write(workspace.directory.path().join("secret.png"), PNG).unwrap();
        workspace
            .page(
                "Page",
                None,
                &[block(
                    "i1",
                    "image",
                    Value::Null,
                    json!({ "url": "notiva-image://localhost/../secret.png" }),
                )],
            )
            .await;

        let summary = workspace.export(Scope::All).await.unwrap();

        assert_eq!(summary.images, 0);
        assert_eq!(files(&workspace.out().join("Notiva export")), ["Page.md"]);
    }
}
