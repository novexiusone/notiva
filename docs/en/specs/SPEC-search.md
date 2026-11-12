# Spec: search

## Objective

The user finds a page by typing a few letters of its title or of anything written on it. Search is the fastest way around once there are more pages than fit on the screen, so it is one keystroke away and answers while typing.

## Behaviour

- **Open.** Cmd+K, or the search entry in the sidebar, opens the search dialog with the cursor in its input. Escape closes it.
- **Type.** Results appear while typing, from two letters on. Matching is by word prefix and ignores case and accents: `ferm` finds "Fermentation", `uber` finds "Über". Several words must all match.
- **Results.** Each result is a page, listed once: its title and, when the match is in the content, a short excerpt with the matching words highlighted. Pages whose title matches come first, then pages whose content matches, each group best match first. At most 20 results.
- **Choose.** Arrow keys move the selection, Enter or a click opens the page and closes the dialog.
- **Fresh.** New and changed content is found without a restart. Opening the dialog runs the search again.
- **Nothing found.** The dialog says so. With fewer than two letters it shows a hint instead.

## How it works

- Search runs in the backend on the full-text indexes over `page.title` and `block.text`.
- Schema version 3 changes the analyzer: besides lower-casing and accent folding it now indexes word prefixes of 2 to 15 letters, which is what makes search-as-you-type work. Both indexes are rebuilt by the migration.
- The backend returns excerpts as segments marked as matching or not. No markup crosses the boundary, so page content can never inject HTML into the dialog.
- An excerpt is cut around the first match: about 60 characters before it and 120 after, on word boundaries.

## What the prefix index costs

Measured with the benchmark (10,000 pages, 200,000 blocks):

|                                               | Without prefixes | With prefixes |
| --------------------------------------------- | ---------------- | ------------- |
| Database size                                 | 224 MiB          | 449 MiB       |
| Seeding everything                            | 15 s             | 25 s          |
| Search block text, top 20                     | 1.6 ms           | 3.0 ms        |
| Save a 200-block page after editing one block | 11 ms            | 10 ms         |

The database is twice as large. Searching and saving stay far below their targets. The benchmark text only has 50 distinct words, so real notes will differ.

## Commands

| Command  | Arguments       | Returns       |
| -------- | --------------- | ------------- |
| `search` | `query: string` | `SearchHit[]` |

```ts
type SearchHit = {
  pageId: string;
  title: string;
  /** Text from the page that matches; `null` when only the title matched. */
  excerpt: { text: string; matched: boolean }[] | null;
};
```

## Project structure

```
src-tauri/src/
  domain/search.rs         → `SearchHit`, `Segment`, excerpt cutting
  storage/search.rs        → the queries, merging title and content hits
  storage/migrations/0003_search_prefixes.surql
  commands/search.rs
src/features/search/
  SearchDialog.tsx         → the dialog, built on cmdk
  api.ts
  useSearchShortcut.ts     → Cmd+K
```

## Testing strategy

- **Unit tests** for cutting excerpts and turning highlight markers into segments.
- **Repository tests**: title and content matches, prefix and accent matching, all words required, one result per page, title matches first, ranking, the result limit, short and empty queries, content that changed is found and content that was removed is not.
- **End-to-end**: open with Cmd+K and from the sidebar, type, see title and excerpt with highlight, open a result with Enter, find text that was just written.
- The benchmark is run again, because indexing prefixes makes the index larger and writes slower.

## Boundaries

- **Always:** Bind the query as a parameter. Return segments, not markup.
- **Ask first:** Changing the analyzer again; it means rebuilding the indexes of every user.
- **Never:** Render page content as HTML in the search dialog.

## Success criteria

- [ ] Search is reachable from the sidebar and with Cmd+K (#17)
- [ ] Results show the page title and a text excerpt with the term highlighted (#17)
- [ ] Enter opens the result (#17)
- [ ] New and changed content is found without a restart (#17)

## Open questions

- Search does not look inside page links or image captions.
- There is no stemming: "running" does not find "run". Prefix matching covers the common case of typing the start of a word.
