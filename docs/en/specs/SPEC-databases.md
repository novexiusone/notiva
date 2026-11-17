# Spec: databases

## Objective

A database is a page whose body is a table instead of text. Its columns are typed properties, and every row is a page of its own that can be opened, written in, linked and found like any other page.

This module delivers the data model, the commands and the table: create a database, add properties of the types text, number, date, select and relation, add rows and edit cells. Filtering, sorting, grouping and the kanban and calendar views are the module `database-views`. A database inside a normal page is the module `database-embed`.

Tracking issue: #19.

## Decisions and what they rest on

The numbers were measured on 2026-11-12 with SurrealDB 4.0.1 on disk, in the benchmark profile, with 10,000 ordinary pages and one database of 10,000 rows with seven properties. They come from a research run, not from the project's benchmark. What `just benchmark` measured since is under "Performance targets".

| Decision                                                                         | Why                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A database is a `page` with `kind = 'database'`. A row is a `page` below it      | Rows get the editor, `[[` links, backlinks, search by title and content, export as subpages and the delete cascade without new code                                              |
| Cell values live in one object `page.props`, keyed by property id                | Loading 10,000 rows takes 45 ms. One record per cell took 207 ms for the same data. A table per database would need schema changes at run time, which the migration rule forbids |
| Filter, sort and group run in the frontend over all rows of one database         | Filtering and sorting loaded rows takes 2.5 ms. Doing it in the database saves about 20 ms and cannot use an index, because a key chosen at run time (`props[$key]`) never does  |
| Relation values are graph edges (`row_link`), not ids inside `props`             | Deleting a row removes its edges by itself, so no cell can point at a row that is gone. The reverse direction is the same edges read backwards (0.3 ms)                          |
| Rows stay in `list_pages`, marked with `databaseId`. The sidebar hides them      | The page view, link chips and the `[[` picker keep working unchanged. Cost: `list_pages` took 101 ms with 10,500 rows added, 58 ms with rows filtered out                        |
| Dates are stored as `yyyy-MM-dd` strings                                         | No time zone can shift a day, and the strings sort correctly as text. Times of day are not part of this module                                                                   |
| Rows have one manual order per database, stored in `page.position` as a midpoint | `move_page` renumbers every sibling, which would be 10,000 updates for one moved row                                                                                             |
| The frontend package does not wait for the backend; this spec is the contract    | The fake backend has to implement every rule anyway                                                                                                                              |

Revisit "rows stay in `list_pages`" when `list_pages` exceeds 200 ms in the benchmark; the alternative is to leave rows out and look up titles by id.

## Tech stack

| Area          | Choice                                                          |
| ------------- | --------------------------------------------------------------- |
| Table         | `@tanstack/react-table` 9                                       |
| Virtual rows  | `@tanstack/react-virtual` 3                                     |
| Dates         | `date-fns` 4                                                    |
| Date picker   | shadcn/ui `calendar` (react-day-picker) in a `popover`          |
| Select editor | shadcn/ui `popover` with the existing `command` (cmdk), `badge` |
| Client state  | Zustand 5, only for the active cell                             |

All of them are named in the project brief or come with shadcn/ui. TanStack Table 9 replaced version 8 as the stable line in August 2026.

## Behaviour

### Databases

- **Create.** "New database" in the menu of the "Pages" header creates a top-level database; "Add database" in a page's row menu creates one below that page. It is titled "Untitled", opened at once and has its title focused. It starts with the title column and no rows.
- **Sidebar.** A database appears in the tree with a table icon. It has no `+`, because its children are rows. Rows, and anything below a row, do not appear in the tree.
- **Open.** A database opens at `/page/<id>` like a page. Below the title it shows the table across the full width of the main area.
- **Move and delete.** A database is moved and deleted like a page. The confirmation names the number of rows. A page cannot be moved into a database, and a row cannot be moved at all.

### Table

- The first column is the title of the row. Its header reads "Name" and has no menu: it cannot be renamed, deleted or change its type.
- **Properties.** `+` at the end of the header adds a property: choose a type, type a name. Without a name the property is named after its type. The header menu of a property offers rename, change type and delete. An empty name in a rename keeps the old one.
- **Rows.** "New" below the last row adds a row and puts the cursor in its title. Hovering a row shows "Open" in the title cell and a menu with "Delete". Deleting a row asks for confirmation like deleting a page, because there is no trash.
- **Editing.** Clicking a cell edits it. Text and number are typed in place: Enter or leaving the cell saves, Escape discards. Date opens a calendar, select a searchable list of options. A value that did not change is not saved.
- **Keyboard.** The body is one Tab stop. The arrow keys move between cells, Enter or F2 edits the focused cell, Escape leaves the editor.
- Writes to options and cells of a database go to the backend one after another, in the order they were made, so a cell never names a select option the backend does not know yet.
- Every change is saved at once. There is no save button. Undo inside a cell is the text field's own; changes to a database are not part of the editor's undo history.
- Rows are virtualised: only the visible ones are in the page.

Column widths, column order by dragging and hiding columns belong to a view and arrive with `database-views`.

### Property types

| Type     | Value                     | Editor                                                           | Shown as                               |
| -------- | ------------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| text     | string                    | text field in the cell                                           | text, one line                         |
| number   | number                    | text field in the cell; anything that is not a number is refused | number in the UI language's format     |
| date     | `yyyy-MM-dd`              | calendar in a popover                                            | date in the UI language's format       |
| select   | id of one option          | searchable list; typing a new name offers "Create"               | badge with the option's name           |
| relation | ids of rows of the target | searchable list of the target database's rows                    | titles of the rows, each opens its row |

- An empty cell has no value (`null`).
- A select option has an id, a name and a colour. Cells store the id, so renaming an option changes one record. The colour is one of eight muted tints defined as theme variables.
- Every type also defines how two values compare and which filter operators it has. The table and the views of `database-views` use the same definitions.

### Rows are pages

- "Open" navigates to the row's page at `/page/<rowId>`.
- The row's page lists its properties between the title and the content, editable with the same editors, and shows a link back to its database above the title (#60).
- The list shows every property in the database's order, whatever a view hides or reorders. A value is opened with a click, Enter, Space or F2 and follows the table's rules: an unchanged value is not saved, Escape discards. A property without a value reads "Empty". Names and values stay on one line each; a long text is read in full in its editor.
- The row's page reads and writes the rows the table has loaded, so both always show the same values. Opening a row's page therefore loads all rows of its database once.
- The link back carries no view; the database shows the view that was active there last.
- While the values load, the names are listed without values. If loading fails, a notice takes the list's place and the title and the content still work. A property type without an editor is left out, as in the table.
- A row can be linked with `[[`, has backlinks, and is found by search through its title and content.

### Relations

- A relation property points at one target database, chosen when the property is created. The target can be the database itself.
- A cell holds any number of rows of the target, in the order they were added.
- The relation has one direction. The page of a row lists the rows that point at it ("Linked from"), grouped by property.
- Deleting a row removes it from every cell that held it. Deleting the target database deletes the relation properties that point at it. Deleting a relation property deletes its edges. These follow the existing delete rules: whatever removes a row or a database for good removes the edges with it.
- A two-way relation (a mirrored property in the target database) is not part of this version. It would be a second relation property that the repository keeps in step, and it can be added without changing the stored model.
- A cell may hold the row it sits in when the target is its own database.
- Filter, sort and group on a relation run in the frontend (see `SPEC-database-views.md`) on the cell's row ids: "contains" and "does not contain" compare a row id, "is empty" and "is not empty" test for no row. A relation cannot be sorted or grouped by the backend; the table may order by the number of linked rows.
- Search does not look into relation cells. A row's `props_text` only holds its own values, so a rename of a linked row would have to rewrite every row that points at it; that is not worth it. Linked rows are found through their own titles.
- Export writes the titles of the linked rows, separated by `, `.
- The views of other databases may still mention a relation property that went away with its target database. The backend leaves those entries alone and readers skip them, like any other missed clean-up. The fake backend removes them; the difference is not visible, because readers skip them.

### Changing and deleting properties

- **Delete a property.** Asks for confirmation, then removes the property and its value in every row.
- **Delete a select option.** Cells that held it become empty.
- **Change the type.** Asks for confirmation and says that values which cannot be converted are dropped. Every cell is converted at once:

| From → to       | Result                                                               |
| --------------- | -------------------------------------------------------------------- |
| anything → text | number as written, date as `yyyy-MM-dd`, select as the option's name |
| text → number   | the number if the text is one, otherwise empty                       |
| text → date     | the date if the text is `yyyy-MM-dd`, otherwise empty                |
| text → select   | one option per distinct text, cells point at their option            |
| any other pair  | empty                                                                |

A relation property cannot change its type and no property can become a relation; delete it and add a new one.

## Commands

```ts
type Page = {
  id: string;
  title: string;
  parentId: string | null;
  position: number;
  kind: 'page' | 'database';
  databaseId: string | null; // set on rows
};

type PropertyType = 'text' | 'number' | 'date' | 'select' | 'relation';
type SelectOption = { id: string; name: string; color: string };
type Property = {
  id: string;
  databaseId: string;
  name: string;
  type: PropertyType;
  position: number;
  options: SelectOption[]; // select only, otherwise empty
  targetId: string | null; // relation only
};

// text: string · number: number · date: 'yyyy-MM-dd' · select: option id · relation: row ids
type CellValue = string | number | string[] | null;
type Row = { id: string; title: string; position: number; cells: Record<string, CellValue> };

type Database = { page: Page; properties: Property[]; views: View[] }; // `View`: see SPEC-database-views
```

| Command                   | Arguments                                                       | Returns                                     | Package |
| ------------------------- | --------------------------------------------------------------- | ------------------------------------------- | ------- |
| `create_database`         | `parentId: string \| null`                                      | `Database`                                  | #53     |
| `load_database`           | `id: string`                                                    | `Database`                                  | #53     |
| `create_property`         | `databaseId`, `name`, `type`, `targetId: string \| null`        | `Property`                                  | #54     |
| `update_property`         | `id`, `name: string \| null`, `options: SelectOption[] \| null` | `Property`                                  | #54     |
| `list_rows`               | `databaseId: string`                                            | `Row[]`                                     | #54     |
| `create_row`              | `databaseId: string`                                            | `Row`                                       | #54     |
| `set_cell`                | `rowId`, `propertyId`, `value: CellValue`                       | nothing                                     | #54     |
| `delete_property`         | `id: string`                                                    | nothing                                     | #59     |
| `delete_select_option`    | `propertyId`, `optionId`                                        | nothing                                     | #59     |
| `change_property_type`    | `id`, `type: PropertyType`                                      | `Property`                                  | #59     |
| `list_incoming_relations` | `rowId: string`                                                 | `{ property: Property; rows: PageRef[] }[]` | #61     |

- A row's title is changed with `rename_page` and a row is deleted with `delete_page`. A database is deleted with `delete_page` too.
- `list_pages` returns every page including databases and rows, with `kind` and `databaseId`.
- `list_rows` returns the rows in their manual order. Relation cells are filled from the edges with one query per relation property, never one per row.
- `create_row` appends the row after the last one without touching the others.
- `set_cell` refuses a value that does not fit the property's type, an unknown select option and a relation target that is not a row of the target database. `null` empties the cell.
- `create_page` refuses a database as parent. `move_page` refuses to move a row and to move anything into a database.
- `update_property` with `options` replaces the list of options; it is used to add, rename, recolour and reorder them. Removing one goes through `delete_select_option`.
- Readers skip property ids and option ids that no longer exist, so a missed clean-up never breaks a view.
- Errors use the existing `{ kind: 'not_found' | 'invalid' | 'internal', message }`.

Details the fake backend settled first (#55); the real backend follows them:

- **Not a database, not a row.** `load_database`, `list_rows`, `create_row` and a relation target that is not a database are `not_found`. `set_cell` on a page that is not a row, and `list_incoming_relations` on one, are `invalid`.
- **`create_database`** refuses a database as parent, like `create_page`. Below a row it is allowed.
- **Empty cells** are left out of `cells`; a missing key means empty. `set_cell` with `null`, and with `[]` for a relation, empties the cell. An empty text `''` is stored as it is.
- **`set_cell`** refuses a property of another database, and the same row twice in a relation value. The reserved id `title` is `not_found`; titles go through `rename_page`.
- **`create_property`** refuses a relation without a target and a target on any other type.
- **`update_property`** refuses options on a property that is not a select, and option ids that are empty or appear twice. An option left out of the new list is gone; cells that held it read as empty.
- **Select colours** are `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `red`. Options created by a conversion take them in this order, starting again after the eighth.
- **`delete_select_option`** on an unknown property or option is `not_found`, on a property that is not a select `invalid`. Views that mention the option are left as they are.
- **`change_property_type`** to the type the property already has changes nothing, also for a relation; this is checked before a relation is refused. Text becomes a number when Rust's `f64` parses the trimmed text to a finite number, and a date when the trimmed text is a real calendar date. Text to select skips empty text, compares the texts exactly without trimming, and creates the options in row order. A number becomes the text JavaScript's `String(number)` writes. A select whose option is gone or has an empty name becomes empty. Leaving select clears the options. Stored views are left as they are.
- **`delete_property` and `change_property_type`** read the cells first and then write everything in one transaction. They do not change `updated_at` of the rows. A cell written between the read and the write can keep a value of the old type; readers treat such a value as empty.
- **`delete_page`** on a database, or on a page with databases anywhere below it, is not one transaction: the rows go first, in chunks. If it stops half-way, the database is still there with fewer rows.
- **`list_incoming_relations`** orders its groups by the property's position and leaves out groups without rows. Within a group the rows are in the manual order of their database.
- **A relation cell** is read from the edges, never from `props`; a stored `props` entry of a relation property reads as empty. `set_cell` replaces the whole list in one transaction and gives the edges the positions 0, 1, 2… in the order of the list. It does not touch `props_text`.
- **`create_property`** with a relation whose target is not a database is `not_found`; a target in another place of the page tree is fine.
- **`create_row`** gives the row the highest position plus one.

## Data model (schema version 5)

One migration carries the model for all three database modules, so that views and relations need no further one.

```surql
DEFINE FIELD kind ON page TYPE option<string> ASSERT $value = NONE OR $value IN ['database'];
DEFINE FIELD database ON page TYPE option<record<page>>;   -- set on rows, equals parent
DEFINE FIELD props ON page TYPE option<object> FLEXIBLE;   -- { <property id>: value }
DEFINE INDEX page_database ON page FIELDS database;

DEFINE TABLE property SCHEMAFULL;
DEFINE FIELD database ON property TYPE record<page>;
DEFINE FIELD name ON property TYPE string DEFAULT '';
DEFINE FIELD type ON property TYPE string
    ASSERT $value IN ['text', 'number', 'date', 'select', 'relation'];
DEFINE FIELD position ON property TYPE float DEFAULT 0.0;
DEFINE FIELD options ON property TYPE array<object> DEFAULT [];
DEFINE FIELD options.*.id ON property TYPE string;
DEFINE FIELD options.*.name ON property TYPE string;
DEFINE FIELD options.*.color ON property TYPE string;
DEFINE FIELD target ON property TYPE option<record<page>>;  -- relation: the target database
DEFINE INDEX property_database ON property FIELDS database;
DEFINE INDEX property_target ON property FIELDS target;

DEFINE TABLE view SCHEMAFULL;
DEFINE FIELD database ON view TYPE record<page>;
DEFINE FIELD name ON view TYPE string DEFAULT '';
DEFINE FIELD position ON view TYPE float DEFAULT 0.0;
DEFINE FIELD config ON view TYPE object FLEXIBLE;           -- see SPEC-database-views
DEFINE INDEX view_database ON view FIELDS database;

DEFINE TABLE row_link TYPE RELATION IN page OUT page SCHEMAFULL;
DEFINE FIELD property ON row_link TYPE record<property>;
DEFINE FIELD position ON row_link TYPE float DEFAULT 0.0;
DEFINE INDEX row_link_property ON row_link FIELDS property;
DEFINE INDEX row_link_in ON row_link FIELDS in;
DEFINE INDEX row_link_out ON row_link FIELDS out;

DEFINE EVENT OVERWRITE page_deleted ON page WHEN $event = 'DELETE' THEN {
    LET $gone = $before.id;
    DELETE (SELECT VALUE id FROM block WHERE page = $gone);
    DELETE (SELECT VALUE id FROM links_to WHERE in = $gone);
    DELETE (SELECT VALUE id FROM links_to WHERE out = $gone);
    DELETE (SELECT VALUE id FROM property WHERE database = $gone);
    DELETE (SELECT VALUE id FROM property WHERE target = $gone);
    DELETE (SELECT VALUE id FROM view WHERE database = $gone);
    DELETE (SELECT VALUE id FROM page WHERE parent = $gone);
};
DEFINE EVENT property_deleted ON property WHEN $event = 'DELETE' THEN {
    LET $gone = $before.id;
    DELETE (SELECT VALUE id FROM row_link WHERE property = $gone);
};
```

- A page without `kind` is an ordinary page. Pages written before the migration are not rewritten.
- Rows are deleted with their database through the existing rule for child pages. Edges of a deleted row disappear by themselves.
- What the database cannot check is checked by the repository: the type of a value in `props`, that an option exists, that a relation target belongs to the target database.
- The number is the next free one when #53 is built; if another migration lands first, this one moves up.

Three behaviours of SurrealDB 4.0.1 that the research run found:

- `UPDATE … UNSET props[$key]` does nothing and reports no error. `SET props[$key] = NONE` removes the key.
- An index on a key inside `props` is only used when the path is written out in the schema and in the query. A key passed as a parameter never uses it.
- Deleting a database with 10,000 rows in one transaction took 13.8 s, and 17 s in chunks of 500 (#59), because the delete events run their lookups for every row and every block: about 0.8 ms per page (seven lookups) and 0.3 ms per block (two lookups). Measured with 2,000 rows and 6,000 blocks: 3.3 s with the events, 0.17 s with the events removed; removing the full-text indexes instead saved only 0.2 to 0.4 s. Every lookup uses its index, so no index is missing; the cost is the number of statements. The fix (#83, no migration): `delete_database_rows` does the cascade of the events itself for a whole chunk with set-based statements (the blocks of all rows, the links of the rows and of their blocks) before it deletes the rows. Rows that have subpages are deleted last through the events, which find the subpages. The events still fire for every deleted record and find nothing left. Switching them off with a session variable was tried and does not work: variables of a query are not visible to events in SurrealDB 4.0.1, so the events and their cost stay.
- `WHERE page IN $rows` with 500 ids is slow in a large table: 370 ms for 500 pages of a table with 200,000 blocks, although the plan shows the index. The same lookup written per record, `array::flatten(array::map($rows, |$p| (SELECT VALUE id FROM block WHERE page = $p)))`, took 10 ms. The chunk delete uses the second form. Without it the delete took 17.5 s in the benchmark, no faster than before.
- The row ids are read once and deleted in slices of 500 rows (the chunk is only there to keep each transaction short), so a later chunk does not read past the index entries of the rows already deleted. Deleting in the background with progress was not built: it would need a state the interface shows, which is outside this change, and the delete now takes about 5 s.

## Performance targets

Database with 10,000 rows, benchmark profile. "Research" is the research run. "Benchmark" is `just benchmark` (#62). It was run three times on 2026-11-14 with SurrealDB 4.0.1 on disk, on one machine (Apple M2 Max, 12 cores, 32 GiB). The machine was busy with other work during all three runs (load average 15 to 40), so the numbers are higher and noisier than on an idle machine. For comparison, the raw page tree query that measured 9 to 10.5 ms before took 14 to 24 ms here. Each cell gives the range of the medians over the three runs, then the range of the p95 values. The benchmark seeds 10,000 ordinary pages and one database with seven properties (two text, two number, one date, two select), every cell filled and three blocks per row. It measures through the repository methods. Missed targets are marked **missed**.

| Measurement                                             | Target | Research                               | Benchmark                                                                                                                                      |
| ------------------------------------------------------- | ------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Load all rows (`list_rows`)                             | 100 ms | 45 ms                                  | median 76 to 93 ms, p95 115 to 156 ms: **missed** at p95                                                                                       |
| Rows plus 20,000 relation edges                         | 200 ms | 45 ms + 53 ms                          |                                                                                                                                                |
| Write one cell (`set_cell`, text, number, date, select) | 50 ms  | 7 ms                                   | median 8 to 10 ms, p95 12 to 23 ms                                                                                                             |
| Create a row (`create_row`)                             | 50 ms  | 31 to 35 ms with today's `create_page` | median 39 to 54 ms, p95 68 to 103 ms: **missed**                                                                                               |
| `list_pages` with the rows present (20,002 pages)       | 200 ms | 101 ms                                 | median 255 to 314 ms, p95 356 to 436 ms: **missed**                                                                                            |
| `load_database` (seven properties, one view)            | report |                                        | median 0.3 to 1.0 ms                                                                                                                           |
| Delete a select option (2,500 cells emptied)            | report |                                        | 260 to 407 ms                                                                                                                                  |
| Delete a property / change a type text to number        | report | 513 ms / 536 ms                        | 789 to 1,132 ms / 770 to 988 ms; with the search text of #69 (two runs, same machine and day), 1,621 to 1,693 ms / 1,871 to 1,881 ms           |
| Delete the database (`delete_page`)                     | report | 13.8 s in one transaction              | 26.6 to 31.0 s in chunks of 500, with 30,000 blocks; 17.1 s before #83 on a quieter machine, 5.3 to 5.4 s after (quieter runs below)           |
| Size on disk                                            | report |                                        | 481 to 497 MiB for the pages, 530 MiB with the database (+33 to 49 MiB); 546 to 562 MiB after deleting it; the search index of #69 adds 16 MiB |

`list_pages` with the 10,000 ordinary pages alone took a median of 87 to 154 ms and a p95 of 143 to 195 ms in the same runs. The rows roughly double it. The "rows stay in `list_pages`" decision above names 200 ms as the point to revisit it, and the benchmark is past that point. The machine was loaded, so check this on an idle machine before acting on it. The size on disk does not shrink when the database is deleted, because the storage engine appends deletions. Deleting the database took longer here than the 17.5 s measured for #59, probably because of the load.

### Quieter machine (#89, #83)

Run twice on 2026-11-17 on the same machine, with SurrealDB 4.0.1 on disk, after the delete change of #83. The load average was 5 to 10 on 12 cores while the first run went and 7 to 10 during the second, which is as quiet as this machine got while other builds ran; the earlier runs had 15 to 55. Median, then p95:

| Measurement                         | Target | Run 1            | Run 2            | Result     |
| ----------------------------------- | ------ | ---------------- | ---------------- | ---------- |
| `list_rows`, 10,000 rows            | 100 ms | 59.0 / 93.5 ms   | 56.7 / 72.4 ms   | met        |
| `create_row`                        | 50 ms  | 33.1 / 39.0 ms   | 32.1 / 38.9 ms   | met        |
| `list_pages`, 20,002 pages          | 200 ms | 184.9 / 187.1 ms | 177.4 / 180.5 ms | met, close |
| Search block text, every match      | 200 ms | 106.6 / 112.4 ms | 105.0 / 109.6 ms | met        |
| `list_pages`, 10,000 pages alone    | 200 ms | 82.3 / 87.2 ms   | 79.3 / 84.0 ms   | met        |
| Delete the database (30,000 blocks) | report | 5,412 ms         | 5,284 ms         |            |

Decisions:

- The four targets that were reported as missed under load are met on a quiet machine. They stay as they are; no target was loosened.
- `list_pages` with the rows is within 10% of its target. Rows stay in `list_pages`. The point to revisit is unchanged: over 200 ms on a quiet machine.
- `create_row` stays as it is: it sorts the rows to find the last position and still takes 33 ms. An index on `database, position` was not tried; revisit when `create_row` exceeds 50 ms on a quiet machine.
- Size on disk: 464.9 MiB for the pages, 513.7 MiB with the database, 598.4 MiB after deleting it, in both runs. The storage engine (SurrealKV) is log-structured and the repository has no way to compact it; nothing was found in the embedded API that does. Not solved: the space is not reclaimed after a delete. This stays open in #89.
- "Delete a page with 20 blocks and its subpages" (target 50 ms) had a median of 12 ms and a p95 of 51 to 65 ms over the few samples taken; not part of this change.

Not measured: how long the WebView takes to parse the 2 MiB that 10,000 rows are as JSON, and databases with long text cells.

## Project structure

```
src-tauri/src/
  domain/database.rs       → `Database`, `Property`, `Row`, `CellValue`
  storage/migrations/0005_databases.surql
  storage/databases.rs     → create, load, chunked delete
  storage/properties.rs    → properties, options, type change
  storage/rows.rs          → rows and cells
  storage/relations.rs     → relation cells, incoming relations
  commands/databases.rs
src/features/databases/
  api.ts                   → query and mutation hooks
  DatabaseView.tsx         → what a database page shows below its title
  useDatabaseTable.ts      → builds the TanStack table from properties and rows
  uiStore.ts               → active and edited cell
  properties/              → registry.ts and one file per type
  table/                   → TableView, HeaderCell, Row, Cell, AddPropertyMenu
  RowProperties.tsx        → the property list on a row's page
e2e/databases*.spec.ts
```

## Code style

The repository works with domain types; a cell value is an enum, never raw JSON.

```rust
pub enum CellValue {
    Empty,
    Text(String),
    Number(f64),
    Date(String),
    Select(String),
    Relation(Vec<String>),
}

impl Storage {
    pub async fn list_rows(&self, database_id: &str) -> Result<Vec<Row>, StorageError>;
    pub async fn set_cell(&self, row_id: &str, property_id: &str, value: CellValue) -> Result<(), StorageError>;
}
```

In the frontend one registry entry per type holds everything that differs between types, so no component switches on the type itself.

```ts
type PropertyTypeDefinition = {
  icon: LucideIcon;
  Display: (props: { value: CellValue; property: Property }) => ReactNode;
  Editor: (props: EditorProps) => ReactNode;
  compare: (a: CellValue, b: CellValue, property: Property) => number;
  operators: FilterOperator[];
  matches: (value: CellValue, filter: ViewFilter, property: Property) => boolean;
};
```

## Testing strategy

- **Repository tests** on the in-memory engine: migration on a fresh and on an existing database; every command; every refusal named under "Commands"; cascades; every row of the conversion table.
- **Unit tests** for `compare` and `matches` of every type, including empty values.
- **Component tests** against the fake backend: every editor commits and cancels; the fake backend follows the same rules as the repository.
- **End-to-end** in WebKit against the fake backend: create a database, add properties and rows, edit every type, reload, delete. One test seeds 10,000 rows in memory and checks that only the visible ones are rendered.
- **Benchmark**: the measurements under "Performance targets".
- Once #54 and #57 are in, the table is clicked through in the real Tauri window. The MVP modules were never checked there, so this is the first such check.

## Boundaries

- **Always:** Validate cell values in the repository. Keep the fake backend in step with the commands. Read relation cells with one query per property.
- **Ask first:** A further property type. Storing anything about a row outside `page`. Evaluating filters in the backend.
- **Never:** Create tables or indexes at run time. Query the database once per row.

## Success criteria

- [ ] Schema version 5 applies to a fresh and an existing database (#53)
- [ ] A database can be created, opened, moved and deleted, and shows in the sidebar while its rows do not (#53, #55)
- [ ] Properties of the types text, number, date and select can be added and renamed; rows can be added; every cell can be edited (#54, #56, #57)
- [ ] A database with 10,000 rows opens within the targets and scrolls smoothly (#57, #62)
- [ ] Properties and options can be deleted and a type changed, with the conversions of the table above (#59)
- [ ] A row opens as a page that shows and edits its properties (#60)
- [ ] Relation properties link rows of two databases and show the reverse direction on the row's page (#61)

## Open questions

- Rows can technically have subpages, but nothing in the UI creates or shows them. Whether a row's page should list subpages is left open.
- A long table scrolls inside itself, and the page around it scrolls a little further by the height of the title. One scroll area for both would need a change to the page view; whether that is worth it is open.
- Search does not look into property values yet (#69), and the export does not know databases yet (#68).
- A checkbox and a multi-select type would be cheap additions; they are left out because the project brief names five types.
- A row's page loads all rows of its database to show one of them. A command that loads one row would make that cheaper for large databases; whether it is needed is open.
- Whether a long text value should wrap on the row's page instead of being cut to one line is open.
