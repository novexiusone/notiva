# Spec: pages

## Objective

The user can build a hierarchy of pages: create a page, nest it under another one, rename it, move it and delete it. The sidebar shows the hierarchy as a tree, and clicking a page opens it in the main area.

A page has a title only. Its content is the `editor` module's job; until then the page shows its title and an empty body.

## Tech stack

| Area               | Choice                                                                        |
| ------------------ | ----------------------------------------------------------------------------- |
| Tree               | react-arborist (virtualised, drag and drop, inline rename)                    |
| Routing            | TanStack Router, code-based routes, hash history                              |
| Menus and dialogs  | shadcn/ui `dropdown-menu` and `alert-dialog`                                  |
| Data fetching      | TanStack Query on top of the page commands                                    |
| End-to-end tests   | Playwright against the frontend with an in-memory fake backend                |

## Behaviour

- **Create.** The `+` in the "Pages" header creates a top-level page. The `+` on a row creates a subpage and expands the row. A new page is titled "Untitled", is opened immediately and has its title focused.
- **Open.** Clicking a row opens the page at `/page/<id>`. The open page is highlighted in the tree.
- **Rename.** The title in the main area is editable; the tree follows as you type. "Rename" in the row menu edits the name inline in the tree. An empty title is stored as an empty string and shown as "Untitled".
- **Move.** Rows can be dragged to reorder them or to drop them into another page. A page cannot be dropped into itself or into one of its descendants.
- **Delete.** "Delete" in the row menu asks for confirmation and names the number of subpages that go with it. Deleting removes the page and its subpages. If the open page is among them, the app goes back to home.
- **Restart.** The tree comes from the database. The last opened page and the expanded rows are remembered locally and restored at startup; a remembered page that no longer exists is ignored.

There is no trash yet (#25), so deleting is final. The confirmation says so.

## Commands

| Command        | Arguments                                    | Returns      |
| -------------- | -------------------------------------------- | ------------ |
| `list_pages`   | none                                         | `Page[]`     |
| `create_page`  | `parentId: string \| null`                   | `Page`       |
| `rename_page`  | `id: string`, `title: string`                | `Page`       |
| `move_page`    | `id: string`, `parentId: string \| null`, `index: number` | nothing |
| `delete_page`  | `id: string`                                 | nothing      |

```ts
type Page = { id: string; title: string; parentId: string | null; position: number };
```

- `list_pages` returns every page as a flat list ordered by position. The frontend builds the tree. At 10,000 pages this takes about 9 ms in the database (#11).
- `create_page` appends the page after its last sibling.
- `move_page` places the page at `index` among the children of `parentId` and renumbers those siblings. It fails when the target is the page itself or one of its descendants.
- Errors reach the frontend as `{ kind: 'not_found' | 'invalid' | 'internal', message: string }`.

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
    PageTree.tsx          → the sidebar tree
    PageRow.tsx           → one row: title, `+`, menu
    PageView.tsx          → the open page: editable title
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

- **Repository tests** (in-memory database): creation order, rename, move within and across parents, rejected moves, cascading delete, unknown ids.
- **Unit tests** for `tree.ts`.
- **Component tests** for the tree and the page view against the fake backend.
- **End-to-end** with Playwright: create, rename, nest, reload and delete, in a real browser against the fake backend. This cannot drive the Tauri window; the Rust side is covered by the repository tests.
- The fake backend implements the same rules as the repository (ordering, renumbering, cascade). It only exists in development and test builds.

## Boundaries

- **Always:** Keep the fake backend in step with the commands. Validate moves in the backend, not only in the UI.
- **Ask first:** Changing the meaning of `position` or the page id format.
- **Never:** Ship the fake backend in a production build.

## Success criteria

- [ ] A new page and a subpage can be created (#12)
- [ ] Pages can be moved and reordered in the tree by drag and drop (#12)
- [ ] Renaming works from the title and from the tree (#12)
- [ ] Deleting asks for confirmation and removes the page with its subpages (#12)
- [ ] The tree and the last opened page survive a restart (#12)

## Open questions

- Drag and drop inside the Tauri window needs the window's native drop handler switched off. That will have to be revisited when images can be dropped into the editor.
