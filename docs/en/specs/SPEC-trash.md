# Spec: trash

## Objective

Deleting is no longer final. A deleted page, with its subpages and, for a database, its rows, goes to the trash, where it can be restored or deleted for good. Every page also keeps a short history of its content: earlier states of its blocks that can be read and brought back. This closes #25 in two steps: this spec and its backend (storage, commands, fake backend) come first; the user interface (a trash view, a retention setting, a history panel) follows in its own work package.

## Decisions

| Decision                                                                      | Why                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trashed records leave the live tables and are kept in `trash_item`            | Every read path (tree, search, links, backlinks, favourites, exports, row queries, relations) already reads only the live tables, so none needs a filter, and a new read path cannot forget one. A `trashed_at` flag would need a filter in every query, including the ones other modules add later. |
| One trash entry per trashed page; its id is the page id                       | A page is in the trash once. Subpages are not entries of their own: they come back with the page.                                                                                                                                                                                                    |
| Items are copies of the records exactly as stored, in a flexible `data` field | Restoring inserts them unchanged, so record links, edges and timestamps survive without a Rust type per table.                                                                                                                                                                                       |
| Moving to the trash copies first, then deletes through the existing cascade   | The cascade, including the chunked delete of large databases, stays the one way records are removed. A crash between the two steps loses nothing (see Recovery).                                                                                                                                     |
| Retention defaults to 30 days and can be switched off                         | A trash that never empties grows without bound; an automatic purge that is too short loses data. 30 days is the usual middle. `null` keeps pages until they are deleted by hand.                                                                                                                     |
| A version is the state a save overwrites, taken at most once per 5 minutes    | One version per interval however often autosave runs. The newest state is always the live page, so it needs no version. Restoring keeps the replaced state, so it can be undone.                                                                                                                     |
| At most 50 versions per page, identical snapshots are not stored              | Bounds the space a page can take. Pruning removes the oldest.                                                                                                                                                                                                                                        |

## Behaviour

### Trash

- **Delete.** `delete_page` moves the page to the trash instead of removing it. The page, every page below it and, for a database, its properties, views and rows disappear from the tree, favourites, search, links, backlinks, relations and exports. Links in other pages that point at it read "Deleted page" while it is in the trash, and work again after a restore.
- **What goes along.** The pages, their blocks, their versions, the properties and views of databases among them, relation properties of other databases that point at a trashed database, and the link and relation edges that touch a trashed page.
- **Restore.** `restore_page` puts everything back. The page returns to its old parent and position when that parent still exists and is not a database; otherwise it returns to the top level, last among its siblings. A page whose position was taken meanwhile goes last among its siblings. A row returns to its database; while that database is still in the trash, restoring the row is `invalid` ("restore the database first") so its cells are not lost; when the database was deleted for good the row returns as an ordinary page at the top level without cells. Edges to pages that were deleted for good in the meantime are not restored. The favourite flag, icon, cover, ids and timestamps are restored as they were.
- **Delete permanently.** `delete_page_permanently` removes one entry for good. `empty_trash` removes all entries and resolves to how many there were. Neither can be undone. Both first mark the entry `purging`, so it can no longer be restored; a purge that stops is finished at the next start. Image files stay in the image store, as before.
- **Retention.** A setting, `retentionDays`, between 1 and 3650, or `null` for "never". Default 30. At startup every entry older than the retention is deleted for good. `list_trash` does not purge.
- **Recovery.** Entries carry the state of the operation that touches them: `complete = false` while a move is running, `restoring` while a restore runs, `purging` while a purge runs. At startup (`Storage::open`) a move that did not finish is rolled back, a restore is rolled forward and a purge is finished; every step inserts only what is missing, so none loses data. If setting `complete` fails after the delete, the move is rolled back at once, so the page never stays invisible. Errors of this housekeeping are written to stderr and never stop the app from starting.
- **Recovery (details).** An entry is `complete` only after the originals are deleted. At startup an incomplete entry (the app stopped in between) is rolled back: its records are inserted where they are missing and the entry is removed. If the move fails while the app runs, the same rollback runs at once and the error is returned. Writes and the trash share one gate (a read/write lock in the repository): every write to pages, blocks, rows, cells, properties and views holds it shared, and moving a page to the trash, restoring, purging and recovering hold it exclusively. A write therefore cannot land between the copy and the delete, and two moves of the same page cannot interleave (the page is looked up inside the exclusive section). A leftover entry for a page that is live is finished first (rolled forward), never purged blindly, so the full copy is never destroyed.
- **Storage.** The trash holds a second copy of the data until it is purged, so deleting a large database doubles its size on disk for the retention period; the retention and `empty_trash` are the way to reclaim it.
- **Not in the trash.** Nothing else is trashed: deleting a property, a view, a select option or a row's cell is still final, as `SPEC-databases.md` describes.

### Version history

- **When a version is taken.** `save_blocks` stores the blocks it is about to overwrite when the page has none yet or its newest version is at least 5 minutes old, and the page had blocks. A save that changes nothing, and a state equal to the newest version, store nothing. A failure to take a version never fails the save.
- **Limit.** The newest 50 versions of a page are kept.
- **List.** `list_page_versions` returns the versions newest first with the title at that time, the number of blocks and a preview of up to 120 characters of text.
- **Read.** `load_page_version` returns one version with its blocks. A version of another page is `not_found`.
- **Restore.** `restore_page_version` first stores the current blocks as a version (unless equal to the newest one), then makes the page's blocks equal to the version, through `save_blocks`, so text for search and link edges are rebuilt. It resolves to the new blocks. The title and the properties of the page are not part of a version. A block id that now belongs to another page makes the restore `invalid`.
- **Rows and trash.** Rows have versions like any page. Versions are deleted with their page and come back with a restored one.

## Duration and the UI

The exclusive section lasts as long as the move, so writes to other pages wait for it; they are delayed, never lost. The time is linear in the number of pages and dominated by the existing cascade delete (see the measurements below). For small entries it is milliseconds. For large databases (thousands of rows) it can take seconds: the UI should show an indeterminate busy state while `delete_page` or `restore_page` is pending and may use `pageCount` of `list_trash` as the size. A progress event (`{ entryId, phase: 'copy' | 'delete' | 'restore', done, total }`, emitted per group of 200 pages) can be added without changing the commands; it is not part of this change.

## Commands

| Command                   | Arguments              | Returns                             |
| ------------------------- | ---------------------- | ----------------------------------- |
| `delete_page`             | `id: string`           | nothing (moves to the trash)        |
| `list_trash`              | none                   | `TrashedPage[]`                     |
| `restore_page`            | `id: string`           | `Page`                              |
| `delete_page_permanently` | `id: string`           | nothing                             |
| `empty_trash`             | none                   | `number` (entries deleted)          |
| `get_trash_settings`      | none                   | `TrashSettings`                     |
| `set_trash_retention`     | `days: number \| null` | `TrashSettings`                     |
| `list_page_versions`      | `pageId: string`       | `PageVersion[]`                     |
| `load_page_version`       | `pageId`, `versionId`  | `PageVersion & { blocks: Block[] }` |
| `restore_page_version`    | `pageId`, `versionId`  | `Block[]`                           |

```ts
type TrashedPage = {
  id: string; // the page id
  title: string;
  kind: 'page' | 'database';
  icon: string | null;
  parentId: string | null; // where it was
  databaseId: string | null; // set for a row
  pageCount: number; // the page, its subpages and rows
  deletedAt: string;
};
type TrashSettings = { retentionDays: number | null };
type PageVersion = {
  id: string;
  title: string;
  blockCount: number;
  preview: string;
  createdAt: string;
};
```

Unknown ids are `not_found`; a retention outside 1 to 3650 is `invalid`.

## Data model (schema version 11)

All additive; no existing record or table changes.

```
trash          title, kind, icon, parent, database, page_count, groups, complete, deleted_at
trash_item     entry record<trash>, tb string, grp int, data object (flexible)
trash_config   retention_days option<int>       one record, trash_config:main
page_version   page record<page>, title, blocks string (JSON), block_count, preview, created_at
```

- `trash_item.tb` names the live table the record came from; `grp` is the group of at most 200 pages it belongs to, so one query handles a bounded amount.
- A separate event `page_version_cleanup` on `page` deletes the versions of a deleted page; `page_deleted` is not touched.
- An absent `trash_config:main` means the default retention.

## Project structure

```
src-tauri/src/
  storage/trash.rs      → trash, restore, purge, settings, recovery
  storage/versions.rs   → snapshots, list, read, restore
  commands/trash.rs     → the commands above
  domain/trash.rs       → TrashedPage, TrashSettings, PageVersion, PageVersionContent
src/lib/commands.ts     → bindings
src/test/fakeBackend.ts → the same behaviour in memory
```

## Testing strategy

- **Repository tests** (in-memory): a trashed page leaves list, search, backlinks and favourites; restore brings back pages, blocks, favourites, incoming links and versions; restore to the old parent and to the top level; a database with rows, properties, views and cells; a row returning to its database or becoming a page; relations to a trashed database; permanent delete, empty, retention and its validation; rollback of an unfinished move; a database of 450 rows moving through several groups.
- **Version tests**: one version per interval, none for a save without changes, read and restore, undoing a restore, pruning at the limit, versions of other pages, versions with trash and delete.
- **Fake backend tests** mirror the commands.
- The migration tests already require the runner to reach the latest version and to be idempotent.

## Boundaries

- **Always:** Keep trashed records out of the live tables. Restore must never overwrite a live record.
- **Ask first:** Changing the default retention; trashing more kinds of records.
- **Never:** Purge at startup without a retention; delete a trash entry before its originals are deleted and complete.

## Measurements

`cargo test --profile benchmark -- --ignored --nocapture trash_time_scales`: a database with N rows and one block each, in memory, benchmark profile (optimised), on a busy development machine. The delete is the existing cascade; archive and restore are the new work.

| Rows   | Archive (copy) | Delete of the originals | Restore |
| ------ | -------------- | ----------------------- | ------- |
| 2,500  | 0.45 s         | 3.08 s                  | 0.48 s  |
| 5,000  | 1.09 s         | 6.17 s                  | 0.95 s  |
| 10,000 | 3.12 s         | 12.52 s                 | 1.88 s  |

Delete and restore scale linearly (about 1.2 ms and 0.19 ms per row with a block). The archive grew a little faster than linearly in this run (the machine was loaded); each of its queries still handles at most 200 pages.

## Not in this work package

- The user interface: a trash view with restore, delete and empty; the retention setting; the version history panel; changing the delete confirmation text from "final" to "moves to the trash" (`SPEC-pages.md` still says deleting is final).
- Removing image files that no block references any more.
- Versions of a page's title, cover or cells; a manual "save version" command; restoring a version into a new page.

## Success criteria

- [ ] `delete_page` moves to the trash and every read path stops showing the page (#25)
- [ ] A trashed page, database or row can be restored with its content (#25)
- [ ] The trash can be emptied and expires with a retention that has a safe default (#25)
- [ ] Pages keep a bounded history that can be listed, read and restored, and a restore can be undone (#25)
- [ ] The migration is additive and the fake backend behaves the same (#25)
