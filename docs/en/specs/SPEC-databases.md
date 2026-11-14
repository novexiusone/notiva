# Spec: databases

## Objective

A database is a page whose body is a table instead of text. Its columns are typed properties, and every row is a page of its own that can be opened, written in, linked and found like any other page.

This module delivers the data model, the commands and the table: create a database, add properties of the types text, number, date, select and relation, add rows and edit cells. Filtering, sorting, grouping and the kanban and calendar views are the module `database-views`. A database inside a normal page is the module `database-embed`.

Tracking issue: #19.

## Decisions and what they rest on

The numbers were measured on 2026-11-12 with SurrealDB 4.0.1 on disk, in the benchmark profile, with 10,000 ordinary pages and one database of 10,000 rows with seven properties. They come from a research run, not from the project's benchmark; #62 adds them to the benchmark.

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

- The first column is the title of the row. It cannot be deleted or change its type.
- **Properties.** `+` at the end of the header adds a property: choose a type, type a name. The header menu of a property offers rename, change type and delete.
- **Rows.** "New" below the last row adds a row and puts the cursor in its title. Hovering a row shows "Open" in the title cell and a menu with "Delete".
- **Editing.** Clicking a cell edits it. Text and number are typed in place: Enter or leaving the cell saves, Escape discards. Date opens a calendar, select a searchable list of options.
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
- A row can be linked with `[[`, has backlinks, and is found by search through its title and content.

### Relations

- A relation property points at one target database, chosen when the property is created. The target can be the database itself.
- A cell holds any number of rows of the target, in the order they were added.
- The relation has one direction. The page of a row lists the rows that point at it ("Linked from"), grouped by property.
- Deleting a row removes it from every cell that held it. Deleting the target database deletes the relation properties that point at it.

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
- **`change_property_type`** to the type the property already has changes nothing. Text becomes a number when Rust's `f64` parses the trimmed text to a finite number, and a date when the trimmed text is a real calendar date. Text to select skips empty text and creates the options in row order. Leaving select clears the options.
- **`list_incoming_relations`** orders its groups by the property's position and leaves out groups without rows.
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
- Deleting a database with 10,000 rows in one transaction took 13.8 s, because the delete events fire for every row and every block. The repository therefore deletes the rows in chunks before the database page (#59).

## Performance targets

Database with 10,000 rows, benchmark profile. "Research" is the research run; "Benchmark" is filled in by #62.

| Measurement                        | Target | Research                               | Benchmark |
| ---------------------------------- | ------ | -------------------------------------- | --------- |
| Load all rows                      | 100 ms | 45 ms                                  |           |
| Rows plus 20,000 relation edges    | 200 ms | 45 ms + 53 ms                          |           |
| Write one cell                     | 50 ms  | 7 ms                                   |           |
| Create a row                       | 50 ms  | 31 to 35 ms with today's `create_page` |           |
| `list_pages` with the rows present | 200 ms | 101 ms                                 |           |
| Delete a property / change a type  | report | 513 ms / 536 ms                        |           |
| Delete the database                | report | 13.8 s in one transaction              |           |

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
- Search does not look into property values yet (#69), and the export does not know databases yet (#68).
- A checkbox and a multi-select type would be cheap additions; they are left out because the project brief names five types.
