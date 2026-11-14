# Spec: database-embed

## Objective

A database can sit inside a normal page, between paragraphs, the way an image does. It is the same database and the same view as on its own page.

The project brief names this as a risk: BlockNote restricts the block schema, so a custom block like this has to be tried early. The spike (#52) tried it; this spec records what it found.

Tracking issue: #19.

## What the spike found

Observed on 2026-11-14 with BlockNote 0.57 in Playwright's WebKit against the fake backend: 43 tests on the throwaway branch `chore/spike-interactive-block`. Nothing was run in the real Tauri window. The full list is on #52.

**Works as it is**

| Finding                                                                                    | Consequence                                                     |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `createReactBlockSpec` with `content: 'none'` renders any React content                    | The block is possible                                           |
| Typing in a field inside the block changes no block and triggers no `save_blocks`          | Cells are saved by the database commands, not by the editor     |
| A popover opened from the block is outside the editor's DOM; typing there reaches nothing  | The cell editors of `databases` work unchanged                  |
| A `@dnd-kit/react` drag inside the block starts no block drag and saves nothing            | Column, row and card drags work inside the block                |
| Afterwards the sidebar tree drag and the block drag still work                             | The three drag systems coexist                                  |
| The drag handle moves the block; arrow keys skip it; a selection across it copies it       | It behaves like an image block                                  |
| The block is stored as `{ type: 'database', props: { databaseId } }` and survives a reload | `save_blocks`, `load_blocks` and the search text need no change |

**Needs a workaround**

| Finding                                                                                                                                        | Workaround that held in the spike                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Cmd+Z in a field undoes the field's text and, with the same key press, the last edit of the document. The page title has the same leak today   | A listener at app level drops undo and redo aimed at anything but the focused field, or the field handles Cmd+Z itself |
| A click on a part of the block that is not a control leaves a text cursor in the neighbouring paragraph; the next Backspace edits the document | On such a click: prevent the default, blur the editor, clear the selection, focus the block's wrapper                  |
| A block dropped onto the database block is swallowed                                                                                           | `pointer-events: none` on the block's node view while a native drag is under way                                       |
| BlockNote's style rule for `p`, `h1` to `h6` and `li` overrides Tailwind utilities inside the block                                            | A reset on the block's wrapper, or other elements                                                                      |

**To know when building**

- Backspace at the start of the paragraph below the block, and Delete at the end of the one above, remove the block at once without selecting it first. Undo brings it back.
- Moving the block rebuilds its React component. Whatever must survive a move, such as the active view, lives outside the component.
- After a drag inside the block, focus is on `body`; Backspace then made the browser go back a page in the test browser.
- The click and the drop problem only exist with `meta.selectable: false`. With the default, a click on a part that is not a control selects the block as a whole, a drop onto it works, and the arrow keys stop on the block before moving on. The undo leak and the style rule exist either way.

Not tested: the real Tauri web view, selecting across the block with the keyboard, cutting across it, and a field that saves to a backend.

## Behaviour

- **Insert.** "Database" in the slash menu, in the group "Basic blocks", with a Lucide icon and no Markdown shortcut. Choosing it creates a database below the current page and then inserts the block, so the document never holds a reference to nothing.
- **Show.** The block shows the database's title, its view tabs and the active view, as wide as the text column, scrolling sideways when the table is wider. A control opens the database as a full page.
- **Sidebar.** The database appears in the tree below the page that contains it, like any database.
- **Edit.** Everything that works on the database's own page works in the block.
- **Deleted database.** The block stays and reads "Deleted database", greyed out, like a link to a deleted page.
- **Remove the block.** The database is not deleted; it stays in the sidebar. Undo brings the block back. One Backspace from the paragraph below is enough to remove the block, which is acceptable because nothing is lost.
- **Copy the block.** The copy shows the same database. There are then two views of one database, not two databases.

## How it is built

```tsx
export const databaseBlock = createReactBlockSpec(
  { type: 'database', propSchema: { databaseId: { default: '' } }, content: 'none' },
  {
    render: ({ block }) => <DatabaseBlock databaseId={block.props.databaseId} />,
    toExternalHTML: ({ block }) => <p data-database-id={block.props.databaseId}>Database</p>,
  },
);
```

- `DatabaseBlock` looks the database up in the page list and renders `DatabaseView` with it, or the "Deleted database" notice.
- The block starts with BlockNote's default for `selectable`, because that needs two workarounds fewer. If clicking cells of the real table disturbs the editor's selection, #67 switches to `meta.selectable: false` with the click and the drop workaround from the spike. The spike tested both variants, but only with a text field, a popover and a sortable list, not with the table.
- The guard against undo and redo leaking into the document is mounted once for the whole app, since the page title needs it too.
- The block's wrapper resets BlockNote's style rule for paragraphs, headings and list items.
- The active view of an embedded database is not kept in component state, because moving the block rebuilds the component.
- The slash menu entry needs to create a database before it inserts. `getSlashMenuItems` gets the actions it needs from `Editor.tsx`, which knows the page.
- `SPEC-editor.md` lists switching on a further block type under "Ask first". This spec is that request.

## Project structure

```
src/features/databases/databaseBlockSpec.tsx   → the block and `DatabaseBlock`
src/features/editor/schema.ts                  → registers the block
src/features/editor/slashMenuItems.ts          → the "Database" entry
```

## Testing strategy

- **Spike (#52)**, done: 43 tests on the throwaway branch `chore/spike-interactive-block`. Its helper for dragging a block by its handle is reused, because a block drag in Playwright has to begin with a few small pointer moves on the handle.
- **End-to-end** in WebKit (#67): the spike's checks as regular tests against the real block: insert through the slash menu; type in a cell and see that no block was saved; Cmd+Z in a cell changes neither the block nor the text around it; click on the block outside its controls and press Backspace; drop a paragraph onto the block; drag inside the block; reload; move the block by its handle; copy and paste; delete the database and see the notice.
- **In the real app** (#67): Cmd+Z in a cell, Backspace after a drag inside the block, and a drag inside the block right after a block drag. These three may behave differently in the Tauri web view than in the test browser.
- **Rust**: a database block has no search text and no page links.

## Boundaries

- **Always:** Create the database before inserting the block. Render the same `DatabaseView` as the full page.
- **Ask first:** Deleting a database when its last block is removed.
- **Never:** Store anything of the database in the block except its id.

## Success criteria

- [x] The spike reports on every open point, and this spec is corrected where a finding requires it (#52)
- [ ] A database can be inserted from the slash menu and edited inside the page (#67)
- [ ] Typing in a cell never changes the page's blocks, and Cmd+Z in a cell never changes the text around the block (#67)
- [ ] A block whose database is gone says so (#67)

## Open questions

- Cmd+Z undoes what was typed into a focused field. Undoing a value that was already saved to the database is not possible; whether that needs a hint in the UI is open.
- Whether a pasted block should become a copy of the database instead of a second view is left for later.
- BlockNote is at 0.x and marks parts of this API as experimental, so an upgrade can break the block. The tests of #67 are the guard.
