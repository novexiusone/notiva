# Spec: database-embed

## Objective

A database can sit inside a normal page, between paragraphs, the way an image does. It is the same database and the same view as on its own page.

The project brief names this as a risk: BlockNote restricts the block schema, so a custom block like this has to be tried early. This spec records what is known and what the spike has to show.

Tracking issue: #19.

## What is known

Read in the source of BlockNote 0.57 and TipTap 3.33 as installed. Nothing of it was run.

| Finding                                                                                | Consequence                                                                                          |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `createReactBlockSpec` accepts `content: 'none'` and any React content in `render`     | The block is possible                                                                                |
| With `meta.selectable: false` the editor ignores every event inside the block          | Typing in a cell does not reach the document; dragging inside stays native                           |
| The block is a leaf node, and changes inside a leaf are ignored by the editor          | The view can re-render freely                                                                        |
| Cell edits do not change the document                                                  | They are saved by the database commands, not by `save_blocks`, and are not part of the editor's undo |
| The block is stored as `{ type: 'database', props: { databaseId } }` without `content` | `save_blocks`, `load_blocks` and the search text need no change                                      |
| The Markdown export writes a blank line for a block type it does not know              | The export needs a case for it (#68)                                                                 |

Not known until the spike (#52) has run: how a block that cannot be selected behaves with the drag handle, the arrow keys, Backspace and a selection across it, and whether a drag inside it can start a block drag.

## Behaviour

- **Insert.** "Database" in the slash menu, in the group "Basic blocks", with a Lucide icon and no Markdown shortcut. Choosing it creates a database below the current page and then inserts the block, so the document never holds a reference to nothing.
- **Show.** The block shows the database's title, its view tabs and the active view, as wide as the text column, scrolling sideways when the table is wider. A control opens the database as a full page.
- **Sidebar.** The database appears in the tree below the page that contains it, like any database.
- **Edit.** Everything that works on the database's own page works in the block.
- **Deleted database.** The block stays and reads "Deleted database", greyed out, like a link to a deleted page.
- **Remove the block.** The database is not deleted; it stays in the sidebar. Undo brings the block back.
- **Copy the block.** The copy shows the same database. There are then two views of one database, not two databases.

## How it is built

```tsx
export const databaseBlock = createReactBlockSpec(
  { type: 'database', propSchema: { databaseId: { default: '' } }, content: 'none' },
  {
    meta: { selectable: false },
    render: ({ block }) => <DatabaseBlock databaseId={block.props.databaseId} />,
    toExternalHTML: ({ block }) => <p data-database-id={block.props.databaseId}>Database</p>,
  },
);
```

- `DatabaseBlock` looks the database up in the page list and renders `DatabaseView` with it, or the "Deleted database" notice.
- The slash menu entry needs to create a database before it inserts. `getSlashMenuItems` gets the actions it needs from `Editor.tsx`, which knows the page.
- `SPEC-editor.md` lists switching on a further block type under "Ask first". This spec is that request.

## Project structure

```
src/features/databases/databaseBlockSpec.tsx   → the block and `DatabaseBlock`
src/features/editor/schema.ts                  → registers the block
src/features/editor/slashMenuItems.ts          → the "Database" entry
```

## Testing strategy

- **Spike (#52)**, on a throwaway branch: the checks listed in the issue, each reported as working or not.
- **End-to-end** in WebKit (#67): the same checks as regular tests against the real block: insert through the slash menu; type in a cell and see that no block was saved; Cmd+Z in a cell keeps the block; reload; move the block by its handle; copy and paste; delete the database and see the notice.
- **Rust**: a database block has no search text and no page links.

## Boundaries

- **Always:** Create the database before inserting the block. Render the same `DatabaseView` as the full page.
- **Ask first:** Deleting a database when its last block is removed.
- **Never:** Store anything of the database in the block except its id.

## Success criteria

- [ ] The spike reports on every open point, and this spec is corrected where a finding requires it (#52)
- [ ] A database can be inserted from the slash menu and edited inside the page (#67)
- [ ] Typing in a cell never changes the page's blocks (#67)
- [ ] A block whose database is gone says so (#67)

## Open questions

- People will expect Cmd+Z to undo a cell edit in a block. It does not, by design of the editor; whether that needs a hint in the UI is open.
- Whether a pasted block should become a copy of the database instead of a second view is left for later.
- BlockNote is at 0.x and marks parts of this API as experimental, so an upgrade can break the block. The tests of #67 are the guard.
