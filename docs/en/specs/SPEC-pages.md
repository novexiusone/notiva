# Spec: pages

## Objective

The user can build a hierarchy of pages: create a page, nest it under another one, rename it, move it and delete it. The sidebar shows the hierarchy as a tree, and clicking a page opens it in the main area. Favourite pages also have a flat list of shortcuts, and a page can have an icon and an image banner.

A page's content is the `editor` module's job; a database's table belongs to `databases`. This module owns the shared page shell, its appearance and its actions.

## Tech stack

| Area              | Choice                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| Tree              | react-arborist (virtualised, drag and drop, inline rename)                                              |
| Routing           | TanStack Router, code-based routes, hash history                                                        |
| Menus and dialogs | shadcn/ui `dropdown-menu` and `alert-dialog`                                                            |
| Icons and banners | Emoji (emojibase data) and a curated Lucide set; local images through the existing `save_image` command |
| Panels            | shadcn/ui `popover` for the icon picker, a `dialog`-based sheet for export                              |
| Data fetching     | TanStack Query on top of the page commands                                                              |
| End-to-end tests  | Playwright against the frontend with an in-memory fake backend                                          |

## Behaviour

- **Create.** The `+` in the "Private" header creates a top-level page. The `+` on a row creates a subpage and expands the row. A new page is titled "Untitled", is opened immediately and has its title focused.
- **Create from inside a page.** "Page" in the editor's slash menu creates a subpage below the open page, inserts a link to it in the text (it follows the subpage's title) and opens the new page with its title focused. The subpage appears in the tree like any other. If creating fails, nothing is inserted and a message says so.
- **Open.** Clicking a row opens the page at `/page/<id>`. The open page is highlighted in the tree and in Favourites when present there.
- **Rename.** The title in the main area is editable; the tree follows as you type. "Rename" in the row menu edits the name inline in the tree. An empty title is stored as an empty string and shown as "Untitled".
- **Move.** Rows can be dragged to reorder them or to drop them into another page. A page cannot be dropped into itself or into one of its descendants.
- **Delete.** "Delete" in the row or page menu asks for confirmation and names the number of subpages that go with it. Deleting removes the page and its subpages, including any favourite shortcuts. If the open page is among them, the app goes back to home.
- **Favourites.** "Favourites" sits above "Private" and links directly to every favourited page in page-tree order. A favourite still appears in Private. The star in the open page's header toggles the state, which survives a restart. The section and its empty hint take little space when there are no favourites.
- **Appearance.** A page can have one icon and one local PNG, JPEG, GIF or WebP banner of at most 20 MiB. An icon is an emoji (stored as the character) or the name of a curated Lucide icon. The icon appears above the title, in the sidebar and in the path. The banner spans the top of the page. Either can be removed independently; changing appearance does not change the document.
- **Icon picker.** Clicking the icon, or "Add icon", opens a popover with the tabs "Emoji" and "Icons", a filter field, a button that picks a random emoji and "Remove". Emoji are grouped by category with a category bar; there is no upload tab. It works with the keyboard and takes its colours from the app's tokens.
- **Add icon and cover.** Moving the pointer over the area above the title shows "Add icon" and "Add cover" for whichever the page does not have yet. They also show while the area has keyboard focus.
- **Top bar.** The open page has a bar at the top edge of the main area. On the left is the path: the ancestors from the top down, each a link, then the page itself, separated by `/` and each with its icon; a long path shortens in the middle. On the right, from left to right, are the localised relative last-edited time, the favourite star and a three-dot menu. The menu has icons and offers appearance, lock, export and delete. Renaming happens in the title or in the tree, and a database is added from the slash menu or the sidebar, not from this menu. "Export" opens the export panel (`SPEC-export.md`). The time comes from `updatedAt`, which title, content, cell and appearance changes advance; favouriting alone does not.
- **Lock.** A page is `none`, `content` or `all` locked, set from the page menu and shown as a lock in the top bar that unlocks it. "Lock content" makes the title, text, icon and banner read-only and stops the page from being deleted or renamed; in a database the rows, cells, properties and views stay editable. "Lock everything" also makes a database's properties, views, rows and cells and its row pages read-only. A locked page is opened and exported as usual. The lock does not advance `updatedAt`.
- **Restart.** The tree, favourites and appearance come from the database. The last opened page and the expanded rows are remembered locally and restored at startup; a remembered page that no longer exists is ignored.

There is no trash yet (#25), so deleting is final. The confirmation says so.

## Commands

| Command             | Arguments                                                      | Returns  |
| ------------------- | -------------------------------------------------------------- | -------- |
| `list_pages`        | none                                                           | `Page[]` |
| `create_page`       | `parentId: string \| null`                                     | `Page`   |
| `rename_page`       | `id: string`, `title: string`                                  | `Page`   |
| `set_favorite`      | `id: string`, `favorite: boolean`                              | `Page`   |
| `update_appearance` | `id: string`, `icon: string \| null`, `banner: string \| null` | `Page`   |
| `move_page`         | `id: string`, `parentId: string \| null`, `index: number`      | nothing  |
| `delete_page`       | `id: string`                                                   | nothing  |
| `set_lock`          | `id: string`, `lock: 'none' \| 'content' \| 'all'`             | `Page`   |

```ts
type Page = {
  id: string;
  title: string;
  parentId: string | null;
  position: number;
  isFavorite: boolean;
  icon: string | null;
  banner: string | null;
  lock: 'none' | 'content' | 'all';
  updatedAt: string;
};
```

- `list_pages` returns every page as a flat list ordered by position. The frontend builds the tree and filters the flat favourites list from the same result. At 10,000 pages `list_pages` took a median of 87 to 154 ms and a p95 of 143 to 195 ms, under the 200 ms target (#62: three runs on 2026-11-14, SurrealDB 4.0.1, one machine under heavy load). A research run on 2026-11-12 measured 45 to 53 ms. The 9 ms quoted here before came from a simpler query, `SELECT id, title, parent, position FROM page`, which skips what `list_pages` adds: the ids as strings, `kind`, `database`, the ordering by position, and reading the rows into `Page`. That query took 14 to 24 ms in the same runs. With the 10,000 rows of a database also present, `list_pages` took a median of 255 to 314 ms, which is over the target (see `SPEC-databases.md`, "Performance targets").
- `create_page` appends the page after its last sibling. New pages are unfavourited and have no icon or banner.
- `set_favorite` changes only `isFavorite`, not `updatedAt`.
- `update_appearance` replaces both appearance values and advances `updatedAt`; the caller keeps the current value of the field it is not changing. Empty icon or banner strings are invalid. Only image URLs returned by `save_image` are used as banners.
- `move_page` places the page at `index` among the children of `parentId` and renumbers those siblings. It fails when the target is the page itself or one of its descendants.
- `set_lock` changes only `lock`, not `updatedAt`. Every command that changes a locked page's title, content, appearance or position, deletes it, or changes what its lock level covers in a database, fails with `locked`. Rows are checked against their database's lock as well as their own. Pages written before the field exist read as `none`.
- Errors reach the frontend as `{ kind: 'not_found' | 'invalid' | 'locked' | 'internal', message: string }`.

```bash
pnpm test:e2e           # Playwright, starts the frontend with the fake backend
pnpm dev:fake           # frontend with the fake backend, for working on the UI in a browser
```

## Project structure

```
src-tauri/src/
  domain/page.rs          → `Page`, no database types
  storage/pages.rs        → page repository: methods on `Storage`
  commands/pages.rs       → thin Tauri commands
  commands/error.rs       → `CommandError`, what the frontend sees
src/
  router.tsx              → routes: `/` and `/page/$pageId`
  features/pages/
    api.ts                → query and mutation hooks
    tree.ts               → flat list → tree, descendant count
    PageTree.tsx          → Private: the complete sidebar tree
    Favourites.tsx        → flat favourite shortcuts
    PageRow.tsx           → one row: title, `+`, menu
    PageView.tsx          → the open page and its shell
    PageHeader.tsx        → the top bar: path, last edited, star and page menu
    Breadcrumbs.tsx       → the path to the page
    IconPicker.tsx        → emoji and icon popover
    PageLock.tsx          → lock menu items and the lock button
    PageAppearance.tsx    → add icon and cover on hover, banner and image input
    DeletePageDialog.tsx
  test/fakeBackend.ts     → in-memory implementation of the commands
e2e/pages.spec.ts
```

## Code style

Repositories are methods on `Storage` that take and return domain types. Ids cross the boundary as plain strings.

```rust
impl Storage {
    pub async fn create_page(&self, parent_id: Option<&str>) -> Result<Page, StorageError>;
}
```

Components get their data from the hooks in `api.ts`, never from `commands` directly.

## Testing strategy

- **Repository tests** (in-memory database): creation order, rename, move within and across parents, rejected moves, cascading delete, favourites, appearance, timestamps and unknown ids.
- **Unit tests** for `tree.ts`.
- **Component tests** for the tree, favourites and page header against the fake backend, including keyboard operation.
- **End-to-end** with Playwright: create, rename, nest, favourite, choose an icon and banner, reload and delete, in a real browser against the fake backend. This cannot drive the Tauri window; the Rust side is covered by the repository tests.
- The fake backend implements the same rules as the repository (ordering, renumbering, cascade, favourites and appearance). It only exists in development and test builds.

## Boundaries

- **Always:** Keep the fake backend in step with the commands. Validate moves in the backend, not only in the UI. Add page fields through a new additive migration and keep the fake backend compatible with pages written before those fields existed.
- **Ask first:** Changing the meaning of `position` or the page id format. Adding remote-image banners or an icon set beyond emoji and Lucide.
- **Never:** Ship the fake backend in a production build.

## Success criteria

- [ ] A new page and a subpage can be created (#12)
- [ ] Pages can be moved and reordered in the tree by drag and drop (#12)
- [ ] Renaming works from the title and from the tree (#12)
- [ ] Deleting asks for confirmation and removes the page with its subpages (#12)
- [ ] The tree and the last opened page survive a restart (#12)
- [ ] Favourites appear above Private and survive a restart (#95)
- [ ] Icons, banners and the last-edited/star/menu header work and survive a restart (#96)
- [ ] The top bar shows the path, the menu has icons and no "Rename" or "Add database", and "Add icon" and "Add cover" appear on hover (#101)
- [ ] The icon picker offers emoji and Lucide icons and both persist (#102)
- [ ] A page can be locked at "content" or "everything", enforced by the backend (#104)

## Open questions

- Drag and drop inside the Tauri window needs the window's native drop handler switched off. That will have to be revisited when images can be dropped into the editor.
