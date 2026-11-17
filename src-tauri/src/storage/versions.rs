//! Version history.
//!
//! A version is a snapshot of the blocks of a page. Saving a page takes one of
//! its state *before* the save when the newest version is older than
//! [`SNAPSHOT_INTERVAL`], so that autosave produces at most one version per
//! interval however often it runs. A snapshot equal to the newest version is
//! not stored, and only the newest [`MAX_VERSIONS`] are kept per page, which
//! bounds the space a page can take.

use std::collections::HashMap;

use surrealdb::types::SurrealValue;

use super::blocks::{BlockRow, document};
use super::{Storage, StorageError};
use crate::domain::{Block, PageVersion, PageVersionContent};

/// The least time between two automatic versions of a page.
pub(super) const SNAPSHOT_INTERVAL: &str = "5m";

/// How many versions a page keeps. Older ones are removed when a new one is
/// stored.
pub const MAX_VERSIONS: usize = 50;

/// How much text a preview holds, in characters.
const PREVIEW_LENGTH: usize = 120;

#[derive(SurrealValue)]
struct VersionRow {
    id: String,
    title: String,
    block_count: i64,
    preview: String,
    created_at: String,
}

impl From<VersionRow> for PageVersion {
    fn from(row: VersionRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            block_count: row.block_count.max(0) as usize,
            preview: row.preview,
            created_at: row.created_at,
        }
    }
}

#[derive(SurrealValue)]
struct ContentRow {
    id: String,
    title: String,
    block_count: i64,
    preview: String,
    created_at: String,
    blocks: String,
}

const VERSION_FIELDS: &str = "record::id(id) AS id, title, block_count, preview, \
     <string> created_at AS created_at";

fn count_blocks(blocks: &[Block]) -> usize {
    blocks
        .iter()
        .map(|block| 1 + count_blocks(&block.children))
        .sum()
}

/// The start of the text of a document.
fn preview_of(blocks: &[Block]) -> String {
    fn collect(blocks: &[Block], text: &mut String) {
        for block in blocks {
            if text.chars().count() >= PREVIEW_LENGTH {
                return;
            }
            let own = block.plain_text();
            if !own.is_empty() {
                if !text.is_empty() {
                    text.push(' ');
                }
                text.push_str(&own.replace(['\r', '\n'], " "));
            }
            collect(&block.children, text);
        }
    }

    let mut text = String::new();
    collect(blocks, &mut text);
    text.chars().take(PREVIEW_LENGTH).collect()
}

fn version_not_found(id: &str) -> StorageError {
    StorageError::NotFound(format!("version {id}"))
}

impl Storage {
    /// Takes a version of the blocks that are about to be overwritten when the
    /// newest version is older than the interval. A page without blocks has
    /// nothing to keep. A failure here never stops the save.
    pub(super) async fn snapshot_if_due(
        &self,
        page_id: &str,
        stored: &HashMap<String, BlockRow>,
        interval: &str,
    ) {
        if stored.is_empty() {
            return;
        }
        let due: Result<Option<bool>, _> = async {
            self.db
                .query(
                    "LET $latest = (SELECT VALUE created_at FROM page_version
                         WHERE page = type::record('page', $page_id)
                         ORDER BY created_at DESC LIMIT 1)[0];
                     RETURN $latest = NONE OR time::now() - $latest >= <duration> $interval;",
                )
                .bind(("page_id", page_id.to_owned()))
                .bind(("interval", interval.to_owned()))
                .await?
                .check()?
                .take(1)
        }
        .await;

        match due {
            Ok(Some(true)) => {
                if let Err(error) = self.insert_version(page_id, &document(stored)).await {
                    eprintln!("could not keep a version of page {page_id}: {error}");
                }
            }
            Ok(_) => {}
            Err(error) => eprintln!("could not check the versions of page {page_id}: {error}"),
        }
    }

    /// Stores a version unless it equals the newest one, then removes the
    /// versions beyond the limit. Returns whether one was stored.
    pub(super) async fn insert_version(
        &self,
        page_id: &str,
        blocks: &[Block],
    ) -> Result<bool, StorageError> {
        let json = serde_json::to_string(blocks).map_err(|error| {
            StorageError::Invalid(format!("the blocks cannot be saved: {error}"))
        })?;

        let stored: Option<bool> = self
            .db
            .query(
                "LET $page = type::record('page', $page_id);
                 LET $latest = (SELECT VALUE blocks FROM page_version WHERE page = $page
                     ORDER BY created_at DESC LIMIT 1)[0];
                 IF $latest = $blocks {
                     false
                 } ELSE {
                     CREATE page_version SET page = $page, title = $page.title ?? '',
                         blocks = $blocks, block_count = $count, preview = $preview;
                     LET $old = (SELECT VALUE id FROM page_version WHERE page = $page
                         ORDER BY created_at DESC START $max);
                     DELETE $old RETURN NONE;
                     true
                 };",
            )
            .bind(("page_id", page_id.to_owned()))
            .bind(("blocks", json))
            .bind(("count", count_blocks(blocks) as i64))
            .bind(("preview", preview_of(blocks)))
            .bind(("max", MAX_VERSIONS))
            .await?
            .check()?
            .take(2)?;

        stored.ok_or_else(|| StorageError::Database("a version was not stored".into()))
    }

    /// The versions of a page, the newest first.
    pub async fn list_page_versions(
        &self,
        page_id: &str,
    ) -> Result<Vec<PageVersion>, StorageError> {
        self.require_page(page_id).await?;

        let rows: Vec<VersionRow> = self
            .db
            .query(format!(
                "SELECT {VERSION_FIELDS} FROM page_version
                     WHERE page = type::record('page', $page_id) ORDER BY created_at DESC"
            ))
            .bind(("page_id", page_id.to_owned()))
            .await?
            .check()?
            .take(0)?;

        Ok(rows.into_iter().map(PageVersion::from).collect())
    }

    /// One version with its blocks.
    pub async fn load_page_version(
        &self,
        page_id: &str,
        version_id: &str,
    ) -> Result<PageVersionContent, StorageError> {
        self.require_page(page_id).await?;

        let row: Option<ContentRow> = self
            .db
            .query(format!(
                "SELECT {VERSION_FIELDS}, blocks FROM page_version
                     WHERE id = type::record('page_version', $version_id)
                         AND page = type::record('page', $page_id)"
            ))
            .bind(("page_id", page_id.to_owned()))
            .bind(("version_id", version_id.to_owned()))
            .await?
            .check()?
            .take(0)?;
        let row = row.ok_or_else(|| version_not_found(version_id))?;

        let blocks = serde_json::from_str(&row.blocks).map_err(|error| {
            StorageError::Database(format!("version {version_id} cannot be read: {error}"))
        })?;
        Ok(PageVersionContent {
            version: PageVersion {
                id: row.id,
                title: row.title,
                block_count: row.block_count.max(0) as usize,
                preview: row.preview,
                created_at: row.created_at,
            },
            blocks,
        })
    }

    /// Makes the blocks of a page equal to those of a version. The current
    /// blocks are kept as a version first, so that restoring can be undone by
    /// restoring that one. Returns the blocks the page has now.
    pub async fn restore_page_version(
        &self,
        page_id: &str,
        version_id: &str,
    ) -> Result<Vec<Block>, StorageError> {
        let version = self.load_page_version(page_id, version_id).await?;

        let current = self.load_blocks(page_id).await?;
        if !current.is_empty() {
            self.insert_version(page_id, &current).await?;
        }
        self.save_blocks(page_id, &version.blocks).await?;
        self.load_blocks(page_id).await
    }
}

#[cfg(test)]
mod tests;
