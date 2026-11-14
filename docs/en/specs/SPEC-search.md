# Spec: search

## Objective

The user finds a page by typing a few letters of its title or of anything written on it. A row of a database is a page, so it is found the same way, and also by the text in its properties. Search is the fastest way around once there are more pages than fit on the screen, so it is one keystroke away and answers while typing.

## Behaviour

- **Open.** Cmd+K, or the search entry in the sidebar, opens the search dialog with the cursor in its input. Escape closes it.
- **Type.** Results appear while typing, from two letters on. Matching is by word prefix and ignores case and accents: `ferm` finds "Fermentation", `uber` finds "Über". Several words must all match.
- **Results.** Each result is a page, listed once: its title and, when the match is in the content or in the properties, a short excerpt with the matching words highlighted. Pages whose title matches come first, then pages whose content matches, then rows whose properties match, each group best match first. At most 20 results.
- **Properties.** A row is found by its text values and by the names of its select options, together with the names of their properties. Numbers, dates and relations are not searched. `done` finds a row whose `Status` is "Done", and so does `status done`.
- **Where the words are.** All words of a query have to match in one place: the title, one block of the content, or the properties of a row. A query whose words are spread over the title and the properties, or over the title and the content, finds nothing.
- **Property excerpt.** A row found by its properties shows the matching properties as `Name: value`, several joined with `·`, for example `Status: Done · Notes: long fermentation`. Properties that do not match are left out. When both the content and the properties of a row match, the excerpt comes from the content, as it does for a page whose title and content match. A row whose title matches shows the content excerpt if its content matches, else the property excerpt.
- **Choose.** Arrow keys move the selection, Enter or a click opens the page and closes the dialog.
- **Fresh.** New and changed content is found without a restart. Opening the dialog runs the search again. The same holds for properties: a changed cell, a renamed property or option, a deleted option or property and a changed type are reflected at once.
- **Nothing found.** The dialog says so. With fewer than two letters it shows a hint instead.

## How it works

- Search runs in the backend on the full-text indexes over `page.title`, `block.text` and `page.props_text`. The three queries run in one request and are merged in Rust.
- `page.props_text` is derived from a row's cells: one line per property that has a text value or a select option with a name, in the order of the properties, written as `Name: value` (only the value when the property has no name). Line breaks inside a value become spaces, so a line is always one property. Values a reader would read as empty, such as an option that is gone, add nothing. An ordinary page has no `props_text`, a new row neither.
- Schema version 6 defines the field and its index, with the same analyzer as the other two. Schema version 7 fills the field for the rows that exist. They are two migrations because SurrealDB 4.0.1 refuses to define an index and write records of its table in one transaction, in either order.
- The repository computes the text in Rust (`props_text` in `storage/rows.rs`) and writes it in the same statement as the cells. Every write that can change it does so: `set_cell`; `update_property` when the property is renamed or an option is renamed or left out (only the rows whose text changes); `delete_select_option`; `change_property_type`; `delete_property`. The bulk commands read the cells of the rows concerned once, then write cells and text with their one statement over a bound array, inside their transaction.
- `set_cell` reads the row's cells, computes the text, and writes only if the cells are still the same; otherwise it starts again, five times at most. So two writes to one row cannot leave a text that misses one of them. The bulk commands keep the window they already have for cells: a cell written between their read and their write can leave that row's text stale until its next write.
- The migration that fills the field writes the same rules in SurrealQL, as functions that it removes again at its end. A test checks that it writes what the repository computes, row by row.
- Computing the text in the database was measured and rejected. A SurrealQL function evaluated per row made writing 10,000 cells take about 3.4 s instead of 0.6 s; the same write with the text computed in Rust took about 1.0 s. Besides, an expression inside `UPDATE … SET` sees `props` as it was before the statement, so it cannot read the cell it writes.
- The excerpt of a property hit is built from the highlighted `props_text`: the lines with a match are kept, joined with `·`, and cut like any other excerpt.
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

### What property search costs

Measured with the benchmark (10,000 pages, one database of 10,000 rows with two text and two select properties among seven, every cell filled), two runs before and two after the change, on 2026-11-14 on one machine (Apple M2 Max, SurrealDB 4.0.1 on disk). The machine was busy with other work (load average 5 to 18), so single numbers vary; the table gives both runs.

|                                                 | Before        | After             |
| ----------------------------------------------- | ------------- | ----------------- |
| Size on disk with the database                  | 497.7 MiB     | 513.7 MiB         |
| Search property text, top 20                    |               | 0.5 ms            |
| `search` with a word of pages or of properties  |               | 10.4 to 10.5 ms   |
| `set_cell`, median                              | 7.0 to 8.0 ms | 8.0 ms            |
| `create_row`, median                            | 32 ms         | 30 to 32 ms       |
| Rename an option held by 2,500 rows             |               | 301 to 309 ms     |
| Rename a select property, 10,000 rows           |               | 1,077 to 1,113 ms |
| `delete_select_option`, 2,500 cells             | 171 to 191 ms | 335 to 385 ms     |
| `change_property_type` text to number           | 537 to 561 ms | 1,871 to 1,881 ms |
| `delete_property` (text)                        | 486 to 503 ms | 1,621 to 1,693 ms |
| Filling the field for 10,000 rows (migration 7) |               | 1.8 to 1.9 s      |

The index adds 16 MiB for 10,000 rows. Searching stays far below its target. A cell write costs about one more read. The bulk commands take about three times as long, because every row they touch is read whole and its text is indexed again; they have no target and stay under two seconds. The benchmark's property text has few distinct words, so real data will differ.

## Commands

| Command  | Arguments       | Returns       |
| -------- | --------------- | ------------- |
| `search` | `query: string` | `SearchHit[]` |

```ts
type SearchHit = {
  pageId: string;
  title: string;
  /** Content or property text that matches; `null` when only the title matched. */
  excerpt: { text: string; matched: boolean }[] | null;
};
```

## Project structure

```
src-tauri/src/
  domain/search.rs         → `SearchHit`, `Segment`, excerpt cutting, property excerpts
  storage/search.rs        → the queries, merging title, content and property hits
  storage/rows.rs          → `props_text`, written with a cell
  storage/properties.rs    → keeps `props_text` current when properties and options change
  storage/migrations/0003_search_prefixes.surql
  storage/migrations/0006_search_properties.surql → the field `props_text` and its index
  storage/migrations/0007_fill_props_text.surql   → fills it for existing rows
  commands/search.rs
src/features/search/
  SearchDialog.tsx         → the dialog, built on cmdk
  api.ts
  useSearchShortcut.ts     → Cmd+K
```

## Testing strategy

- **Unit tests** for cutting excerpts, turning highlight markers into segments and building the excerpt of a property hit.
- **Repository tests**: title and content matches, prefix and accent matching, all words required, one result per page, title matches first, ranking, the result limit, short and empty queries, content that changed is found and content that was removed is not.
- **Repository tests for properties**: text and select values are found by prefix without regard to case and accents; numbers and dates are not; a cleared, changed or converted cell, a renamed or deleted option and a deleted property are reflected at once, while the row's other values are still found; words spread over title and properties find nothing; property hits come after title and content hits; a row is listed once when title, properties and content match; the excerpt of a property hit; the migration fills the field for rows that existed before it; ordinary pages and rows without values are unaffected.
- **End-to-end**: open with Cmd+K and from the sidebar, type, see title and excerpt with highlight, open a result with Enter, find text that was just written.
- The benchmark is run again, because indexing prefixes makes the index larger and writes slower. It also seeds `props_text` for its database rows, reports the size with the property index, a search over property text, and the cell writes and property changes that keep the field current.

## Boundaries

- **Always:** Bind the query as a parameter. Return segments, not markup.
- **Ask first:** Changing the analyzer again; it means rebuilding the indexes of every user.
- **Never:** Render page content as HTML in the search dialog.

## Success criteria

- [ ] Search is reachable from the sidebar and with Cmd+K (#17)
- [ ] Results show the page title and a text excerpt with the term highlighted (#17)
- [ ] Enter opens the result (#17)
- [ ] New and changed content is found without a restart (#17)
- [ ] Rows are found by their text and select values, and the hit shows the matching properties (#69)

## Open questions

- Search does not look inside page links or image captions.
- Search does not find numbers, dates or relation values, and cannot be limited to one database or property.
- Property names are indexed, so a query for a property's name finds every row with a value in it, after the title and content hits. Whether that is noise or useful (`priority high`) is open.
- Words spread over the title, the content and the properties of a row find nothing. Matching across them would need one combined field per page.
- There is no stemming: "running" does not find "run". Prefix matching covers the common case of typing the start of a word.
