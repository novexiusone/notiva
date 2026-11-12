# Spec: links

## Objective

Pages can refer to each other. Typing `[[` inside a page inserts a link to another page, and every page shows which pages link to it. This is what turns a pile of pages into a web of notes, and it is the reason the data model uses graph relations.

## Behaviour

- **Insert.** Typing `[[` opens a page picker below the cursor. Typing further filters the pages by title. Arrow keys and Enter, or a click, insert a link to the chosen page; Escape closes the picker.
- **Appearance.** A link shows the current title of its target with a small page icon. It is one unit: the cursor moves over it as a whole and Backspace removes it.
- **Follow.** Clicking a link opens the target page.
- **Rename.** A link stores the id of its target, not its title. When the target is renamed, every link to it shows the new title at once.
- **Deleted target.** When the target no longer exists, the link reads "Deleted page", is greyed out and cannot be followed. It stays in the text so that nothing disappears silently.
- **Backlinks.** Below its content a page lists the pages that link to it, each once, sorted by title. Clicking an entry opens that page. The section is absent when there are none. A page linking to itself is not listed.

## How links are stored

- In the editor a link is an inline element `pageLink` with one prop, `pageId`. It is saved inside the block's content like any other inline content.
- When a block is saved, the backend reads the page links out of its content and replaces that block's `links_to` edges: one edge per distinct target, from the page that contains the block to the target page, carrying the block. A target that does not exist gets no edge.
- Edges disappear with the block or page they belong to, through the delete cascade of the schema.
- Backlinks are read by graph traversal, `page<-links_to<-page`. The benchmark measured this at 0.1 ms in a database with 10,000 pages (#11).

The frontend never writes edges. It only saves blocks.

## Commands

| Command          | Arguments        | Returns     |
| ---------------- | ---------------- | ----------- |
| `list_backlinks` | `pageId: string` | `PageRef[]` |

```ts
type PageRef = { id: string; title: string };
```

## Project structure

```
src-tauri/src/
  domain/block.rs        → `Block::page_links`
  storage/blocks.rs      → writes the edges of each saved block
  storage/links.rs       → `list_backlinks`
  commands/links.rs
src/features/links/
  pageLink.tsx           → the inline element and how it renders
  PageLinkMenu.tsx       → the picker that `[[` opens
  Backlinks.tsx          → the list below the page
  api.ts
```

## Testing strategy

- **Unit tests** for reading page links out of block content.
- **Repository tests**: saving blocks creates edges; editing a block replaces its edges; removing the block or the source page removes them; duplicates collapse; a missing target and a self-link produce no backlink.
- **End-to-end**: insert a link with `[[`, follow it, see the backlink on the target, rename the target and see the link text change, delete the target and see "Deleted page".

## Boundaries

- **Always:** Derive edges from saved content in the backend. Show a link's title from the live page list.
- **Ask first:** Storing link text, or links to anything other than pages.
- **Never:** Write `links_to` from the frontend.

## Success criteria

- [ ] `[[` opens a page picker and choosing a page inserts a link (#16)
- [ ] Clicking the link opens the page (#16)
- [ ] Renaming the target page updates the link text (#16)
- [ ] Backlinks are shown below the page and come from graph relations (#16)

## Open questions

- Creating a new page straight from the picker ("link to a page that does not exist yet") is left out for now.
- The text of a link is not part of the block's search text, because the title belongs to the target page.
