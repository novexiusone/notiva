//! The trash.
//!
//! Moving a page to the trash copies the page, everything below it and
//! everything that belongs to them into `trash_item`, exactly as stored, and
//! then deletes the originals through the ordinary delete cascade. The live
//! tables therefore never hold a trashed record, and the tree, search, links,
//! backlinks, favourites, exports and row queries need no filter to ignore it.
//! Restoring inserts the records again.

use std::collections::HashSet;

use surrealdb::types::{RecordId, SurrealValue};

use super::{Storage, StorageError};
use crate::domain::{Page, PageKind, TrashSettings, TrashedPage};

/// Days a page stays in the trash when nothing else is configured.
pub const DEFAULT_RETENTION_DAYS: u32 = 30;

/// The longest retention that can be configured.
const MAX_RETENTION_DAYS: u32 = 3650;

/// How many pages one archive or restore query handles.
const GROUP: usize = 200;

/// How many items one query removes when an entry is deleted for good.
const PURGE_CHUNK: usize = 1000;

/// Where the records of a group of pages are found, by table. `$group` holds
/// the ids of the pages and `$all` the ids of every page that is trashed.
const SOURCES: &[(&str, &str)] = &[
    ("page", "SELECT * FROM $group"),
    ("block", "SELECT * FROM block WHERE page IN $group"),
    (
        "page_version",
        "SELECT * FROM page_version WHERE page IN $group",
    ),
    (
        "property",
        "SELECT * FROM property WHERE database IN $group",
    ),
    // Relation properties of other databases that point at a trashed one.
    (
        "property",
        "SELECT * FROM property WHERE target IN $group AND database NOT IN $group",
    ),
    ("view", "SELECT * FROM view WHERE database IN $group"),
    ("links_to", "SELECT * FROM links_to WHERE in IN $group"),
    (
        "links_to",
        "SELECT * FROM links_to WHERE out IN $group AND in NOT IN $all",
    ),
    ("row_link", "SELECT * FROM row_link WHERE in IN $group"),
    (
        "row_link",
        "SELECT * FROM row_link WHERE out IN $group AND in NOT IN $all",
    ),
];

/// The tables in the order they are restored, with what an item must still
/// find in the live data to come back, and whether it is a relation. Edges
/// that lost an end to a permanent delete are not restored.
const RESTORE: &[(&str, &str, bool)] = &[
    ("page", "", false),
    ("block", "", false),
    ("page_version", "", false),
    (
        "property",
        " AND record::exists(data.database) \
          AND (data.target = NONE OR record::exists(data.target))",
        false,
    ),
    ("view", " AND record::exists(data.database)", false),
    (
        "links_to",
        " AND record::exists(data.in) AND record::exists(data.out) \
          AND record::exists(data.block)",
        true,
    ),
    (
        "row_link",
        " AND record::exists(data.in) AND record::exists(data.out) \
          AND record::exists(data.property)",
        true,
    ),
];

#[derive(SurrealValue)]
struct EntryRow {
    id: String,
    title: String,
    kind: String,
    icon: Option<String>,
    parent: Option<String>,
    database: Option<String>,
    page_count: i64,
    groups: i64,
    complete: bool,
    purging: bool,
    restoring: bool,
    deleted_at: String,
}

impl From<EntryRow> for TrashedPage {
    fn from(row: EntryRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            kind: if row.kind == "database" {
                PageKind::Database
            } else {
                PageKind::Page
            },
            icon: row.icon,
            parent_id: row.parent,
            database_id: row.database,
            page_count: row.page_count.max(0) as usize,
            deleted_at: row.deleted_at,
        }
    }
}

const ENTRY_FIELDS: &str = "record::id(id) AS id, title, kind, icon, parent, database, \
     page_count, groups, complete, purging, restoring, <string> deleted_at AS deleted_at";

#[derive(SurrealValue)]
struct ConfigRow {
    retention_days: Option<i64>,
}

fn trash_not_found(id: &str) -> StorageError {
    StorageError::NotFound(format!("trashed page {id}"))
}

impl Storage {
    /// Moves a page with its subpages (and the rows of a database) to the
    /// trash. Nothing is lost: [`Storage::restore_page`] brings it back.
    ///
    /// Not atomic, because deleting a database is not. If it stops half-way,
    /// the entry stays incomplete and the copy is put back by
    /// [`Storage::recover_trash`] at the next start.
    pub async fn trash_page(&self, id: &str) -> Result<(), StorageError> {
        // Exclusive: no write to the page or below it can run between the copy
        // and the delete. The page is looked up inside, so that two moves of
        // the same page cannot both pass the check.
        let _write = self.write_gate.write().await;
        let page = self
            .find_page(id)
            .await?
            .ok_or_else(|| StorageError::NotFound(format!("page {id}")))?;
        // An entry for a page that is live is a leftover of an earlier attempt
        // (a restore or purge that stopped). Finishing it never loses data.
        if self.entry(id).await?.is_some() {
            self.recover_entry(id).await?;
        }
        let ids = self.subtree(id).await?;

        let groups = ids.chunks(GROUP).count();
        self.db
            .query(
                "CREATE type::record('trash', $id) SET title = $title, kind = $kind,
                     icon = $icon, parent = $parent, database = $database,
                     page_count = $count, groups = $groups, complete = false",
            )
            .bind(("id", id.to_owned()))
            .bind(("title", page.title.clone()))
            .bind((
                "kind",
                match page.kind {
                    PageKind::Database => "database",
                    PageKind::Page => "page",
                },
            ))
            .bind(("icon", page.icon.clone()))
            .bind(("parent", page.parent_id.clone()))
            .bind(("database", page.database_id.clone()))
            .bind(("count", ids.len() as i64))
            .bind(("groups", groups as i64))
            .await?
            .check()
            .map_err(|error| StorageError::Database(error.to_string()))?;

        let archived = async {
            for (grp, group) in ids.chunks(GROUP).enumerate() {
                self.archive_group(id, grp, group, &ids).await?;
            }
            self.delete_page(id).await
        }
        .await;
        let completed = match archived {
            Ok(()) => self.mark_complete(id).await,
            Err(error) => Err(error),
        };
        if let Err(error) = completed {
            // Nothing may be lost, and the page must not stay invisible: put
            // back whatever the delete already took.
            if let Err(rollback) = self.recover_entry(id).await {
                eprintln!("could not roll back the move of page {id} to the trash: {rollback}");
            }
            return Err(error);
        }
        Ok(())
    }

    async fn mark_complete(&self, id: &str) -> Result<(), StorageError> {
        self.db
            .query("UPDATE type::record('trash', $id) SET complete = true")
            .bind(("id", id.to_owned()))
            .await?
            .check()?;
        Ok(())
    }

    /// The trashed pages, the most recently deleted first.
    pub async fn list_trash(&self) -> Result<Vec<TrashedPage>, StorageError> {
        let rows: Vec<EntryRow> = self
            .db
            .query(format!(
                "SELECT {ENTRY_FIELDS} FROM trash WHERE complete = true AND purging = false ORDER BY deleted_at DESC"
            ))
            .await?
            .check()?
            .take(0)?;

        Ok(rows.into_iter().map(TrashedPage::from).collect())
    }

    /// Brings a trashed page back with everything that went with it. It
    /// returns to its old parent, or to the top level when that parent is
    /// gone. A row whose database is gone returns as an ordinary page.
    pub async fn restore_page(&self, id: &str) -> Result<Page, StorageError> {
        let _write = self.write_gate.write().await;
        let entry = self
            .entry(id)
            .await?
            .filter(|entry| entry.complete && !entry.purging)
            .ok_or_else(|| trash_not_found(id))?;

        // A row belongs to its database: its cells are lost when the row
        // comes back without it, so the database has to come back first.
        if let Some(database_id) = &entry.database {
            let live = self.find_page(database_id).await?.is_some();
            if !live && self.entry(database_id).await?.is_some() {
                return Err(StorageError::Invalid(
                    "the database of this row is in the trash: restore the database first".into(),
                ));
            }
        }

        self.finish_restore(id, &entry).await?;

        self.find_page(id)
            .await?
            .ok_or_else(|| StorageError::Database("the restored page was not found".into()))
    }

    /// Deletes a trashed page for good.
    pub async fn delete_page_permanently(&self, id: &str) -> Result<(), StorageError> {
        let _write = self.write_gate.write().await;
        self.entry(id)
            .await?
            .filter(|entry| entry.complete && !entry.purging)
            .ok_or_else(|| trash_not_found(id))?;
        self.purge_entry(id).await
    }

    /// Deletes everything in the trash for good and returns how many pages
    /// (top-level entries) went.
    pub async fn empty_trash(&self) -> Result<usize, StorageError> {
        let _write = self.write_gate.write().await;
        let ids: Vec<String> = self
            .db
            .query(
                "SELECT VALUE record::id(id) FROM trash WHERE complete = true AND purging = false",
            )
            .await?
            .check()?
            .take(0)?;
        for id in &ids {
            self.purge_entry(id).await?;
        }
        Ok(ids.len())
    }

    /// The settings of the trash.
    pub async fn trash_settings(&self) -> Result<TrashSettings, StorageError> {
        let row: Option<ConfigRow> = self
            .db
            .query("SELECT retention_days FROM ONLY trash_config:main")
            .await?
            .check()?
            .take(0)?;

        Ok(TrashSettings {
            // No record: nothing was configured yet.
            retention_days: match row {
                None => Some(DEFAULT_RETENTION_DAYS),
                Some(row) => row.retention_days.map(|days| days as u32),
            },
        })
    }

    /// Sets how many days a page stays in the trash, or `None` to keep pages
    /// until they are deleted by hand.
    pub async fn set_trash_retention(
        &self,
        days: Option<u32>,
    ) -> Result<TrashSettings, StorageError> {
        if let Some(days) = days
            && !(1..=MAX_RETENTION_DAYS).contains(&days)
        {
            return Err(StorageError::Invalid(format!(
                "the trash keeps pages for 1 to {MAX_RETENTION_DAYS} days"
            )));
        }

        self.db
            .query("UPSERT trash_config:main SET retention_days = $days")
            .bind(("days", days.map(i64::from)))
            .await?
            .check()?;
        self.trash_settings().await
    }

    /// Deletes the trashed pages that stayed longer than the retention and
    /// returns how many went.
    pub async fn purge_expired_trash(&self) -> Result<usize, StorageError> {
        let _write = self.write_gate.write().await;
        let Some(days) = self.trash_settings().await?.retention_days else {
            return Ok(0);
        };

        let expired: Vec<String> = self
            .db
            .query(
                "SELECT VALUE record::id(id) FROM trash
                     WHERE complete = true AND purging = false AND deleted_at < time::now() - <duration> $span",
            )
            .bind(("span", format!("{days}d")))
            .await?
            .check()?
            .take(0)?;
        for id in &expired {
            self.purge_entry(id).await?;
        }
        Ok(expired.len())
    }

    /// Rolls back every move to the trash that did not finish, so that a crash
    /// loses nothing. Runs at startup.
    pub async fn recover_trash(&self) -> Result<(), StorageError> {
        let _write = self.write_gate.write().await;
        let ids: Vec<String> = self
            .db
            .query(
                "SELECT VALUE record::id(id) FROM trash
                     WHERE complete = false OR purging = true OR restoring = true",
            )
            .await?
            .check()?
            .take(0)?;
        for id in &ids {
            self.recover_entry(id).await?;
        }
        Ok(())
    }

    /// Marks the entry as restoring, so that a crash is rolled forward, then
    /// inserts what is missing, places the page and removes the entry.
    async fn finish_restore(&self, id: &str, entry: &EntryRow) -> Result<(), StorageError> {
        self.db
            .query("UPDATE type::record('trash', $id) SET restoring = true")
            .bind(("id", id.to_owned()))
            .await?
            .check()?;
        self.restore_items(id, entry.groups.max(0) as usize).await?;
        self.place_restored(id, entry).await?;
        self.purge_entry(id).await
    }

    /// Finishes an entry that was left behind, without losing anything: a
    /// purge is completed, a restore is rolled forward, and a move to the
    /// trash that did not finish is rolled back. The records are inserted
    /// where they are missing, then the entry goes. The caller holds the
    /// write gate.
    async fn recover_entry(&self, id: &str) -> Result<(), StorageError> {
        let Some(entry) = self.entry(id).await? else {
            return Ok(());
        };
        // A purge that stopped is finished, not undone: its items are partly gone.
        if entry.purging {
            return self.purge_entry(id).await;
        }
        if entry.complete {
            return self.finish_restore(id, &entry).await;
        }
        self.restore_items(id, entry.groups.max(0) as usize).await?;
        self.purge_entry(id).await
    }

    async fn entry(&self, id: &str) -> Result<Option<EntryRow>, StorageError> {
        let row: Option<EntryRow> = self
            .db
            .query(format!(
                "SELECT {ENTRY_FIELDS} FROM trash WHERE id = type::record('trash', $id)"
            ))
            .bind(("id", id.to_owned()))
            .await?
            .check()?
            .take(0)?;
        Ok(row)
    }

    /// The ids of a page and of every page below it, found one level at a time
    /// through the parent index.
    async fn subtree(&self, id: &str) -> Result<Vec<RecordId>, StorageError> {
        let root: Option<RecordId> = self
            .db
            .query("SELECT VALUE id FROM ONLY type::record('page', $id)")
            .bind(("id", id.to_owned()))
            .await?
            .check()?
            .take(0)?;

        let mut all: Vec<RecordId> = root.into_iter().collect();
        let mut level = all.clone();
        let mut seen: HashSet<String> = all.iter().map(|id| format!("{id:?}")).collect();
        while !level.is_empty() {
            let children: Vec<RecordId> = self
                .db
                .query(
                    "LET $parents = $ids;
                     SELECT VALUE id FROM page WHERE parent IN $parents;",
                )
                .bind(("ids", level))
                .await?
                .check()?
                .take(1)?;
            level = children
                .into_iter()
                .filter(|child| seen.insert(format!("{child:?}")))
                .collect();
            all.extend(level.iter().cloned());
        }
        Ok(all)
    }

    /// Copies the records of one group of pages into the trash.
    async fn archive_group(
        &self,
        id: &str,
        grp: usize,
        group: &[RecordId],
        all: &[RecordId],
    ) -> Result<(), StorageError> {
        let mut statements = String::from("LET $entry = type::record('trash', $entry_id);\n");
        for (table, select) in SOURCES {
            statements.push_str(&format!(
                "LET $rows = ({select});
                 IF array::len($rows) > 0 {{
                     INSERT INTO trash_item $rows.map(|$row| {{
                         entry: $entry, tb: '{table}', grp: $grp, data: $row
                     }});
                 }};\n"
            ));
        }

        self.db
            .query(statements)
            .bind(("entry_id", id.to_owned()))
            .bind(("grp", grp as i64))
            .bind(("group", group.to_vec()))
            .bind(("all", all.to_vec()))
            .await?
            .check()?;
        Ok(())
    }

    /// Inserts the records of an entry that are missing from the live tables.
    async fn restore_items(&self, id: &str, groups: usize) -> Result<(), StorageError> {
        for (table, condition, relation) in RESTORE {
            let insert = if *relation {
                "INSERT RELATION IGNORE INTO"
            } else {
                "INSERT IGNORE INTO"
            };
            for grp in 0..groups {
                self.db
                    .query(format!(
                        "LET $entry = type::record('trash', $entry_id);
                         LET $rows = (SELECT VALUE data FROM trash_item
                             WHERE entry = $entry AND tb = '{table}' AND grp = $grp{condition});
                         IF array::len($rows) > 0 {{ {insert} {table} $rows; }};"
                    ))
                    .bind(("entry_id", id.to_owned()))
                    .bind(("grp", grp as i64))
                    .await?
                    .check()?;
            }
        }
        Ok(())
    }

    /// Settles a restored page: back under its old parent, or at the top
    /// level, last among its siblings, when that parent is gone.
    async fn place_restored(&self, id: &str, entry: &EntryRow) -> Result<(), StorageError> {
        if let Some(database_id) = &entry.database {
            let database = self.find_page(database_id).await?;
            if database.is_some_and(|page| page.kind == PageKind::Database) {
                return self.avoid_position_clash(id, Some(database_id)).await;
            }
            // The database is gone, so the row becomes an ordinary page: its
            // cells had no property left to belong to.
            return self.move_to_top(id, true).await;
        }

        if let Some(parent_id) = &entry.parent {
            let parent = self.find_page(parent_id).await?;
            if parent.is_some_and(|page| page.kind != PageKind::Database) {
                return self.avoid_position_clash(id, Some(parent_id)).await;
            }
            return self.move_to_top(id, false).await;
        }
        Ok(())
    }

    /// Puts a restored page last among its siblings when one of them took its
    /// position while it was in the trash.
    async fn avoid_position_clash(
        &self,
        id: &str,
        parent_id: Option<&String>,
    ) -> Result<(), StorageError> {
        self.db
            .query(
                "LET $page = type::record('page', $id);
                 LET $parent = type::record('page', $parent_id);
                 LET $clash = (SELECT VALUE id FROM page
                     WHERE parent = $parent AND position = $page.position AND id != $page LIMIT 1);
                 IF array::len($clash) > 0 {
                     LET $last = (SELECT VALUE position FROM page WHERE parent = $parent
                         ORDER BY position DESC LIMIT 1)[0];
                     UPDATE $page SET position = $last + 1.0;
                 };",
            )
            .bind(("id", id.to_owned()))
            .bind(("parent_id", parent_id.cloned()))
            .await?
            .check()?;
        Ok(())
    }

    async fn move_to_top(&self, id: &str, forget_row: bool) -> Result<(), StorageError> {
        self.db
            .query(format!(
                "LET $page = type::record('page', $id);
                 LET $last = (SELECT VALUE position FROM page WHERE parent = NONE
                     ORDER BY position DESC LIMIT 1)[0];
                 UPDATE $page SET parent = NONE, position = ($last ?? -1.0) + 1.0{};",
                if forget_row {
                    ", database = NONE, props = NONE, props_text = NONE"
                } else {
                    ""
                }
            ))
            .bind(("id", id.to_owned()))
            .await?
            .check()?;
        Ok(())
    }

    /// Removes an entry and its items, in chunks.
    async fn purge_entry(&self, id: &str) -> Result<(), StorageError> {
        // From here the entry cannot be restored any more; a crash is finished
        // at the next start instead of leaving a half-empty entry to restore.
        self.db
            .query("UPDATE type::record('trash', $id) SET purging = true")
            .bind(("id", id.to_owned()))
            .await?
            .check()?;
        loop {
            let removed: Option<usize> = self
                .db
                .query(
                    "LET $entry = type::record('trash', $id);
                     LET $items = (SELECT VALUE id FROM trash_item WHERE entry = $entry
                         LIMIT $chunk);
                     DELETE $items RETURN NONE;
                     RETURN array::len($items);",
                )
                .bind(("id", id.to_owned()))
                .bind(("chunk", PURGE_CHUNK))
                .await?
                .check()?
                .take(3)?;
            if removed.unwrap_or(0) < PURGE_CHUNK {
                break;
            }
        }

        self.db
            .query("DELETE type::record('trash', $id)")
            .bind(("id", id.to_owned()))
            .await?
            .check()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
