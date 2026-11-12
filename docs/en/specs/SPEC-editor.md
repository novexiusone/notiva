# Spec: editor

## Objective

A page has content: blocks the user writes, formats and rearranges like in Notion. Everything is saved automatically and is there again after a restart.

The editor is BlockNote. This module wires it into the page view, maps its document to the `block` records, restyles its slash menu and stores images on disk.

It is delivered in three steps, one pull request each:

1. Editor, persistence and autosave (#13)
2. Slash menu as designed (#14)
3. Images (#15)

## Tech stack

| Area          | Choice                                                                         |
| ------------- | ------------------------------------------------------------------------------ |
| Editor        | `@blocknote/core`, `@blocknote/react`                                          |
| Editor UI     | `@blocknote/shadcn`, so menus and toolbars use the app's theme variables       |
| Localisation  | BlockNote's own dictionaries for `en` and `de`                                 |
| Image display | The app's own `notiva-image` URL scheme, which serves the image directory only |

## Behaviour

### Editing (#13)

- Below the title the page shows the editor. An empty page shows one empty paragraph with a placeholder.
- Block types in the MVP: paragraph, headings 1 to 3, bullet list, numbered list, check list, code block, quote, image. BlockNote's other default blocks (table, toggle, file, video, audio) are switched off so that nothing can be written that export and search do not handle yet.
- Blocks have a drag handle and a `+` on hover. Nested blocks (indented list items) are supported.
- Undo, redo and the usual formatting shortcuts come from BlockNote and apply within one editor session.
- Pressing Enter in the title moves the cursor into the first block.

### Saving (#13)

- Changes are saved 500 ms after the last edit, without a save button.
- Pending changes are also saved when the page is left, when the window loses focus and before the window closes.
- Saving sends the whole document of the page. The backend compares it with what is stored and only writes blocks that are new, changed, moved or removed.
- Block ids are BlockNote's ids and become the record ids, so a block keeps its identity across saves and restarts.
- If saving fails, the editor keeps the content and tries again with the next change. A small notice says that the last change could not be saved.

### Slash menu (#14)

- Typing `/` opens the menu; typing further filters it. The current filter text is shown in a search row at the top.
- Groups: "Suggested" and "Basic blocks".
- Each entry shows a Lucide icon, its name and, on the right, its Markdown shortcut (`#`, `##`, `-`, `1.`, `[]`, `>`, ` ``` `).
- Arrow keys move the selection, Enter inserts, Escape closes. The footer reads "Close menu" with `esc`.

### Images (#15)

- An image can be added from the slash menu with a file picker, by dropping a file on the editor and by pasting from the clipboard.
- The file is stored in `<app data dir>/images` under a new, random name. The block stores a URL of the app's own scheme, `notiva-image://localhost/<file name>`, never the bytes and never an absolute path.
- Accepted: PNG, JPEG, GIF, WebP, up to 20 MiB. The format is recognised from the content, not from the file name. Anything else is refused with a message below the editor.
- Deleting an image block leaves the file in place for now; removing unused files belongs to trash and history (#25).

## Commands

| Command       | Arguments                           | Returns                 |
| ------------- | ----------------------------------- | ----------------------- |
| `load_blocks` | `pageId: string`                    | `Block[]`               |
| `save_blocks` | `pageId: string`, `blocks: Block[]` | nothing                 |
| `save_image`  | the file as the raw request body    | `string`, the image URL |

```ts
// The shape BlockNote uses, so the frontend passes documents through unchanged.
type Block = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: unknown; // inline content; absent for blocks without text
  children: Block[];
};
```

`save_blocks` runs in one transaction. A document that mentions the same block id twice, or a block id that belongs to another page, is refused.

## Data model

Schema version 2 changes one field of `block`:

- `content` becomes `option<array<object> | object>`, flexible. Blocks without text, such as images, have no content.

The plain text for search (`block.text`) is derived in the backend from the inline content when a block is saved.

## Project structure

```
src-tauri/src/
  domain/block.rs            → `Block`, plain-text extraction
  storage/blocks.rs          → block repository: load, save with diff
  storage/migrations/0002_block_content.surql
  commands/blocks.rs
  commands/images.rs         → validates and stores image files
src/features/editor/
  Editor.tsx                 → BlockNote view for one page
  useAutosave.ts             → debounce, flush, retry
  schema.ts                  → the block types that are switched on
  SlashMenu.tsx              → the custom slash menu
  slashMenuItems.ts          → entries, groups, Markdown shortcuts
  images.ts                  → upload and reference resolution
```

## Code style

The frontend does not interpret blocks. It hands BlockNote's document to `save_blocks` and gives BlockNote what `load_blocks` returns. All knowledge about how blocks are stored lives in the backend.

```rust
impl Storage {
    pub async fn load_blocks(&self, page_id: &str) -> Result<Vec<Block>, StorageError>;
    pub async fn save_blocks(&self, page_id: &str, blocks: &[Block]) -> Result<(), StorageError>;
}
```

## Testing strategy

- **Repository tests**: a saved document loads back identically, including nesting, order, props and inline styles; saving again writes nothing; edits, moves and removals are applied; block ids stay stable; the plain text is derived; another page's blocks are untouched; invalid documents are refused.
- **Unit tests** for the plain-text extraction and for the slash menu entries.
- **Component tests** against the fake backend: content loads, an edit is saved after the debounce, leaving the page flushes.
- **End-to-end**: write a few block types, reload, find them again; use the slash menu with the keyboard; insert an image.
- A write benchmark is added to the existing benchmark: saving a 200-block page after a one-block edit.

## Boundaries

- **Always:** Save through `save_blocks`. Keep the fake backend in step. Store image references, not paths.
- **Ask first:** Switching on further BlockNote block types. Changing the format of stored blocks.
- **Never:** Serve anything but stored images through the `notiva-image` scheme. Store image bytes in the database.

## Success criteria

- [ ] Headings, lists, checkboxes, code and quotes can be written (#13)
- [ ] Blocks can be moved with the drag handle (#13)
- [ ] Changes are saved without a save button and reloaded after a restart (#13)
- [ ] Block ids stay stable across save and load (#13)
- [ ] Undo/redo and the standard shortcuts work (#13)
- [ ] The slash menu matches the design: search row, two groups, icon, name, Markdown shortcut, footer (#14)
- [ ] Images can be added by picker, drop and paste and are shown again after a restart (#15)

## Open questions

- The custom blocks risk named in the project brief (an embedded database block) is not explored here; it belongs to the database feature (#19).
