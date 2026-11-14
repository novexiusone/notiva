//! Export to Markdown: reads pages, blocks and images and writes them as
//! plain files into a new folder.

mod database;
mod layout;
mod markdown;

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

use crate::domain::{Block, Page, PageKind};
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

    let by_id: HashMap<&str, &Page> = pages.iter().map(|page| (page.id.as_str(), page)).collect();
    // The rows of the databases read so far that are still to be written.
    let mut rows: HashMap<String, RowFile> = HashMap::new();
    let mut loaded: HashSet<String> = HashSet::new();

    for page_id in &layout.order {
        let Some(path) = layout.path(page_id) else {
            continue;
        };
        let page = by_id.get(page_id.as_str()).copied();
        let title = page.map_or("", |page| page.title.as_str());

        // A database and its rows are read together, the first time either
        // is reached: usually the database, a row when the export starts at it.
        let database_id = match page {
            Some(page) if page.kind == PageKind::Database => Some(page.id.as_str()),
            Some(page) => page.database_id.as_deref(),
            None => None,
        };
        let mut table = None;
        if let Some(database_id) = database_id
            && loaded.insert(database_id.to_owned())
        {
            let (text, files) = read_database(storage, &layout, database_id).await?;
            rows.extend(files);
            table = Some(text);
        }
        let source = if page.is_some_and(|page| page.kind == PageKind::Database) {
            // Read just above, since a database comes before its rows.
            Source::Table(table.unwrap_or_default())
        } else if let Some(row) = rows.remove(page_id) {
            Source::Row(row)
        } else {
            Source::Page(storage.load_blocks(page_id).await?)
        };

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
            database_link: &|target| match by_id.get(target) {
                Some(database) if database.kind == PageKind::Database => {
                    match layout.link(page_id, target) {
                        Some(path) => markdown::PageLink::File {
                            title: database.title.clone(),
                            path,
                        },
                        None => markdown::PageLink::Outside {
                            title: database.title.clone(),
                        },
                    }
                }
                _ => markdown::PageLink::Deleted,
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
        let text = match source {
            Source::Table(text) => text,
            Source::Row(row) => markdown::row(title, &row.properties, &row.blocks, &context),
            Source::Page(blocks) => markdown::page(title, &blocks, &context),
        };

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

/// What the file of a page is written from.
enum Source {
    /// The Markdown of a database's table, ready to be written.
    Table(String),
    Row(RowFile),
    Page(Vec<Block>),
}

/// What the file of a row is made of, read together with its database.
struct RowFile {
    /// The list of its properties, as Markdown.
    properties: String,
    blocks: Vec<Block>,
}

/// Reads a database with a fixed number of queries, however many rows it
/// has, and returns the Markdown of its table and the files of its rows by
/// row id.
async fn read_database(
    storage: &Storage,
    layout: &layout::Layout,
    database_id: &str,
) -> Result<(String, HashMap<String, RowFile>), ExportError> {
    let loaded = storage.load_database(database_id).await?;
    let properties = loaded.properties;
    let listed = storage.list_rows(database_id).await?;
    let mut blocks = storage.load_row_blocks(database_id).await?;

    let mut table_rows = Vec::with_capacity(listed.len());
    let mut files = HashMap::with_capacity(listed.len());
    for row in listed {
        let values: Vec<String> = properties
            .iter()
            .map(|property| database::value(property, row.cells.get(&property.id)))
            .collect();
        files.insert(
            row.id.clone(),
            RowFile {
                properties: database::property_list(&properties, &values),
                blocks: blocks.remove(&row.id).unwrap_or_default(),
            },
        );
        table_rows.push(database::TableRow {
            link: layout.link(database_id, &row.id),
            title: row.title,
            values,
        });
    }

    let text = database::table(&loaded.page.title, &properties, &table_rows);
    Ok((text, files))
}

#[cfg(test)]
mod tests {
    use serde_json::{Map, Value, json};

    use super::*;
    use crate::domain::{CellValue, PropertyType, SelectOption};

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

        async fn database(&self, title: &str, parent: Option<&str>) -> String {
            let database = self.storage.create_database(parent).await.unwrap().page.id;
            self.storage.rename_page(&database, title).await.unwrap();
            database
        }

        async fn property(&self, database: &str, name: &str, kind: PropertyType) -> String {
            self.storage
                .create_property(database, name, kind, None)
                .await
                .unwrap()
                .id
        }

        /// A select property with the options `open` ("Open") and `done` ("Done").
        async fn select(&self, database: &str, name: &str) -> String {
            let id = self.property(database, name, PropertyType::Select).await;
            let option = |id: &str, name: &str| SelectOption {
                id: id.into(),
                name: name.into(),
                color: "gray".into(),
            };
            self.storage
                .update_property(
                    &id,
                    None,
                    Some(&[option("open", "Open"), option("done", "Done")]),
                )
                .await
                .unwrap();
            id
        }

        async fn row(&self, database: &str, title: &str, blocks: &[Block]) -> String {
            let row = self.storage.create_row(database).await.unwrap().id;
            self.storage.rename_page(&row, title).await.unwrap();
            self.storage.save_blocks(&row, blocks).await.unwrap();
            row
        }

        async fn cell(&self, row: &str, property: &str, value: CellValue) {
            self.storage.set_cell(row, property, value).await.unwrap();
        }
    }

    fn read(folder: &Path, file: &str) -> String {
        std::fs::read_to_string(folder.join(file)).unwrap()
    }

    /// The targets of the Markdown links in `text`, decoded and resolved
    /// against the folder of the file the text is in.
    fn link_targets(file: &Path, text: &str) -> Vec<PathBuf> {
        fn decode(target: &str) -> String {
            let bytes = target.as_bytes();
            let mut decoded = Vec::new();
            let mut index = 0;
            while index < bytes.len() {
                if bytes[index] == b'%' {
                    let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap();
                    decoded.push(u8::from_str_radix(hex, 16).unwrap());
                    index += 3;
                } else {
                    decoded.push(bytes[index]);
                    index += 1;
                }
            }
            String::from_utf8(decoded).unwrap()
        }

        text.split("](")
            .skip(1)
            .map(|rest| {
                let target = &rest[..rest.find(')').unwrap()];
                file.parent().unwrap().join(decode(target))
            })
            .collect()
    }

    fn text(value: &str) -> Value {
        json!([{ "type": "text", "text": value, "styles": {} }])
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

    // Databases.

    #[tokio::test]
    async fn a_database_becomes_a_table_and_its_rows_files_with_their_properties() {
        let workspace = Workspace::new().await;
        let books = workspace.database("Books", None).await;
        let notes = workspace
            .property(&books, "Notes", PropertyType::Text)
            .await;
        let pages = workspace
            .property(&books, "Pages", PropertyType::Number)
            .await;
        let read_on = workspace.property(&books, "Read", PropertyType::Date).await;
        let status = workspace.select(&books, "Status").await;
        let dune = workspace
            .row(&books, "Dune", &[paragraph("d1", text("Spice."))])
            .await;
        let emma = workspace.row(&books, "Emma", &[]).await;
        workspace
            .cell(
                &dune,
                &notes,
                CellValue::Text("A classic | must read".into()),
            )
            .await;
        workspace
            .cell(&dune, &pages, CellValue::Number(412.0))
            .await;
        workspace
            .cell(&dune, &read_on, CellValue::Date("2026-11-13".into()))
            .await;
        workspace
            .cell(&dune, &status, CellValue::Select("done".into()))
            .await;
        workspace.cell(&emma, &pages, CellValue::Number(1.5)).await;
        workspace
            .cell(&emma, &status, CellValue::Select("open".into()))
            .await;

        let summary = workspace.export(Scope::All).await.unwrap();

        let folder = workspace.out().join("Notiva export");
        assert_eq!(summary.pages, 3);
        assert_eq!(
            files(&folder),
            ["Books.md", "Books/Dune.md", "Books/Emma.md"]
        );
        let table = read(&folder, "Books.md");
        assert_eq!(
            table,
            "# Books\n\n\
             | Name | Notes | Pages | Read | Status |\n\
             | --- | --- | --- | --- | --- |\n\
             | [Dune](Books/Dune.md) | A classic \\| must read | 412 | 2026-11-13 | Done |\n\
             | [Emma](Books/Emma.md) |  | 1.5 |  | Open |\n"
        );
        assert_eq!(
            read(&folder, "Books/Dune.md"),
            "# Dune\n\n\
             - Notes: A classic \\| must read\n\
             - Pages: 412\n\
             - Read: 2026-11-13\n\
             - Status: Done\n\
             \n\
             Spice.\n"
        );
        assert_eq!(
            read(&folder, "Books/Emma.md"),
            "# Emma\n\n- Pages: 1.5\n- Status: Open\n"
        );
        let targets = link_targets(&folder.join("Books.md"), &table);
        assert_eq!(targets.len(), 2);
        for target in targets {
            assert!(target.is_file(), "{}", target.display());
        }
    }

    #[tokio::test]
    async fn a_database_without_properties_or_rows_is_still_a_table() {
        let workspace = Workspace::new().await;
        let plain = workspace.database("Plain", None).await;
        workspace.row(&plain, "Only a title", &[]).await;
        let empty = workspace.database("Empty", None).await;
        workspace
            .property(&empty, "Notes", PropertyType::Text)
            .await;
        workspace.database("", None).await;

        workspace.export(Scope::All).await.unwrap();

        let folder = workspace.out().join("Notiva export");
        assert_eq!(
            files(&folder),
            [
                "Empty.md",
                "Plain.md",
                "Plain/Only a title.md",
                "Untitled.md"
            ]
        );
        assert_eq!(
            read(&folder, "Plain.md"),
            "# Plain\n\n| Name |\n| --- |\n| [Only a title](Plain/Only%20a%20title.md) |\n"
        );
        assert_eq!(read(&folder, "Plain/Only a title.md"), "# Only a title\n");
        assert_eq!(
            read(&folder, "Empty.md"),
            "# Empty\n\n| Name | Notes |\n| --- | --- |\n"
        );
        assert_eq!(
            read(&folder, "Untitled.md"),
            "# Untitled\n\n| Name |\n| --- |\n"
        );
    }

    #[tokio::test]
    async fn rows_with_an_empty_or_the_same_title_get_their_own_files() {
        let workspace = Workspace::new().await;
        let books = workspace.database("Books", None).await;
        let notes = workspace.property(&books, "", PropertyType::Text).await;
        let rows = [
            workspace.row(&books, "", &[]).await,
            workspace.row(&books, "Dune", &[]).await,
            workspace.row(&books, "Dune", &[]).await,
            workspace.row(&books, " [a | b] ", &[]).await,
        ];
        for (row, value) in rows.iter().zip(["first", "second", "third", " a\\b\nc "]) {
            workspace
                .cell(row, &notes, CellValue::Text(value.into()))
                .await;
        }

        workspace.export(Scope::All).await.unwrap();

        let folder = workspace.out().join("Notiva export");
        assert_eq!(
            files(&folder),
            [
                "Books.md",
                "Books/Dune 2.md",
                "Books/Dune.md",
                "Books/Untitled.md",
                "Books/[a - b].md",
            ]
        );
        let table = read(&folder, "Books.md");
        assert_eq!(
            table,
            "# Books\n\n\
             | Name | Untitled |\n\
             | --- | --- |\n\
             | [Untitled](Books/Untitled.md) | first |\n\
             | [Dune](Books/Dune.md) | second |\n\
             | [Dune](Books/Dune%202.md) | third |\n\
             | [\\[a \\| b\\]](Books/%5Ba%20-%20b%5D.md) | a\\\\b<br>c |\n"
        );
        assert_eq!(
            read(&folder, "Books/Dune 2.md"),
            "# Dune\n\n- Untitled: third\n"
        );
        assert_eq!(
            read(&folder, "Books/[a - b].md"),
            "# \\[a \\| b\\]\n\n- Untitled: a\\\\b  \n  c\n"
        );
        for target in link_targets(&folder.join("Books.md"), &table) {
            assert!(target.is_file(), "{}", target.display());
        }
    }

    #[tokio::test]
    async fn a_cell_whose_option_was_deleted_is_empty() {
        let workspace = Workspace::new().await;
        let books = workspace.database("Books", None).await;
        let status = workspace.select(&books, "Status").await;
        let dune = workspace.row(&books, "Dune", &[]).await;
        workspace
            .cell(&dune, &status, CellValue::Select("done".into()))
            .await;
        workspace
            .storage
            .delete_select_option(&status, "done")
            .await
            .unwrap();

        workspace.export(Scope::All).await.unwrap();

        let folder = workspace.out().join("Notiva export");
        assert_eq!(
            read(&folder, "Books.md"),
            "# Books\n\n| Name | Status |\n| --- | --- |\n| [Dune](Books/Dune.md) |  |\n"
        );
        assert_eq!(read(&folder, "Books/Dune.md"), "# Dune\n");
    }

    #[tokio::test]
    async fn databases_below_pages_and_pages_below_rows_follow_the_layout() {
        let workspace = Workspace::new().await;
        let projects = workspace.page("Projects", None, &[]).await;
        let tasks = workspace.database("Tasks", Some(&projects)).await;
        let done = workspace.property(&tasks, "Done", PropertyType::Text).await;
        let write = workspace.row(&tasks, "Write", &[]).await;
        workspace
            .cell(&write, &done, CellValue::Text("yes".into()))
            .await;
        workspace
            .page(
                "Notes",
                Some(&write),
                &[paragraph(
                    "n1",
                    json!([
                        { "type": "text", "text": "For ", "styles": {} },
                        { "type": "pageLink", "props": { "pageId": write } }
                    ]),
                )],
            )
            .await;
        let steps = workspace.database("Steps", Some(&write)).await;
        workspace.row(&steps, "Draft", &[]).await;

        let summary = workspace.export(Scope::All).await.unwrap();

        let folder = workspace.out().join("Notiva export");
        assert_eq!(summary.pages, 6);
        assert_eq!(
            files(&folder),
            [
                "Projects.md",
                "Projects/Tasks.md",
                "Projects/Tasks/Write.md",
                "Projects/Tasks/Write/Notes.md",
                "Projects/Tasks/Write/Steps.md",
                "Projects/Tasks/Write/Steps/Draft.md",
            ]
        );
        assert_eq!(
            read(&folder, "Projects/Tasks.md"),
            "# Tasks\n\n| Name | Done |\n| --- | --- |\n| [Write](Tasks/Write.md) | yes |\n"
        );
        assert_eq!(
            read(&folder, "Projects/Tasks/Write.md"),
            "# Write\n\n- Done: yes\n"
        );
        assert_eq!(
            read(&folder, "Projects/Tasks/Write/Notes.md"),
            "# Notes\n\nFor [Write](../Write.md)\n"
        );
        assert_eq!(
            read(&folder, "Projects/Tasks/Write/Steps.md"),
            "# Steps\n\n| Name |\n| --- |\n| [Draft](Steps/Draft.md) |\n"
        );
    }

    #[tokio::test]
    async fn a_row_exported_on_its_own_keeps_its_properties() {
        let workspace = Workspace::new().await;
        let books = workspace.database("Books", None).await;
        let pages = workspace
            .property(&books, "Pages", PropertyType::Number)
            .await;
        let dune = workspace
            .row(&books, "Dune", &[paragraph("d1", text("Spice."))])
            .await;
        workspace.row(&books, "Emma", &[]).await;
        workspace
            .cell(&dune, &pages, CellValue::Number(412.0))
            .await;

        let summary = workspace.export(Scope::Page(&dune)).await.unwrap();

        let folder = workspace.out().join("Notiva export");
        assert_eq!(summary.pages, 1);
        assert_eq!(files(&folder), ["Dune.md"]);
        assert_eq!(
            read(&folder, "Dune.md"),
            "# Dune\n\n- Pages: 412\n\nSpice.\n"
        );
    }

    #[tokio::test]
    async fn an_inline_database_links_to_its_file_or_says_it_is_gone() {
        let workspace = Workspace::new().await;
        let books = workspace.database("Books & more", None).await;
        let other = workspace.page("Other", None, &[]).await;
        let database_block = |id: &str, target: &str| {
            block(id, "database", Value::Null, json!({ "databaseId": target }))
        };
        let home = workspace
            .page(
                "Home",
                None,
                &[
                    paragraph("h1", text("Before")),
                    database_block("h2", &books),
                    database_block("h3", "missing"),
                    // An ordinary page is not a database.
                    database_block("h4", &other),
                    block("h5", "database", Value::Null, json!({})),
                    paragraph("h6", text("After")),
                ],
            )
            .await;

        workspace.export(Scope::All).await.unwrap();
        workspace.export(Scope::Page(&home)).await.unwrap();

        let all = workspace.out().join("Notiva export");
        let text = read(&all, "Home.md");
        assert_eq!(
            text,
            "# Home\n\nBefore\n\n[Books & more](Books%20%26%20more.md)\n\n\
             Deleted database\n\nDeleted database\n\nDeleted database\n\nAfter\n"
        );
        for target in link_targets(&all.join("Home.md"), &text) {
            assert!(target.is_file(), "{}", target.display());
        }
        // Outside the export the database is named, not linked.
        assert_eq!(
            read(&workspace.out().join("Notiva export 2"), "Home.md"),
            "# Home\n\nBefore\n\nBooks & more\n\n\
             Deleted database\n\nDeleted database\n\nDeleted database\n\nAfter\n"
        );
    }

    /// The export reads a database with a fixed number of queries. Each row
    /// still costs its file, so this measures the whole export and prints it.
    #[tokio::test]
    async fn a_database_with_thousands_of_rows_is_exported_at_once() {
        const ROWS: usize = 3_000;
        let workspace = Workspace::new().await;
        let books = workspace.database("Books", None).await;
        let notes = workspace
            .property(&books, "Notes", PropertyType::Text)
            .await;
        workspace
            .storage
            .seed_rows(&books, &notes, ROWS)
            .await
            .unwrap();

        let started = std::time::Instant::now();
        let summary = workspace.export(Scope::All).await.unwrap();
        let elapsed = started.elapsed();
        eprintln!("exported a database with {ROWS} rows in {elapsed:?}");

        let folder = workspace.out().join("Notiva export");
        assert_eq!(summary.pages, ROWS + 1);
        assert_eq!(
            read(&folder, "Books.md").lines().count(),
            // Title, blank line, header, delimiter and one line per row.
            ROWS + 4
        );
        assert_eq!(
            read(&folder, &format!("Books/Row {}.md", ROWS - 1)),
            format!("# Row {0}\n\n- Notes: Value {0}\n\nContent {0}\n", ROWS - 1)
        );
    }
}
