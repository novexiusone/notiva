# Spec: database-views

## Objective

One database can be looked at in several ways. A view has a type (table, kanban or calendar) and its own filter, sorting, grouping and choice of visible properties. Views are stored with the database, so they are there again after a restart.

This module builds on `databases`, which delivers the data model, the property types and the plain table. The `view` table is already part of schema version 5.

Tracking issue: #20.

## Decisions and what they rest on

| Decision                                                                   | Why                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Filter, sort and group run in the frontend, in TanStack Table's row models | See `SPEC-databases.md`. All three views read the same table instance, so they cannot disagree                                                                                                                                                         |
| Drag and drop uses `@dnd-kit/react`, not `@dnd-kit/core` + `sortable`      | The older packages were last published in December 2024 and are labelled legacy in the documentation. The new one sorts across several lists out of the box. It is still 0.x, so it is pinned to its patch line and used through one wrapper           |
| The calendar is FullCalendar 7 (standard edition, MIT), after a trial      | It is named in the project brief and ships components for shadcn/ui. Unverified: whether it takes the app's theme variables and follows the system's dark mode. If the trial in #66 fails, the calendar is a month grid of our own built with date-fns |
| Filter conditions are combined with "and" only                             | Enough for a first version. The configuration carries a version number so groups with "or" can be added later                                                                                                                                          |
| A view's settings are saved as they change                                 | Same rule as everywhere in the app: no save button                                                                                                                                                                                                     |

react-arborist in the sidebar drags with HTML5 drag events and BlockNote with native drag. `@dnd-kit/react` starts a drag from a pointer press on its own elements and listens on the document only while that drag is pending or active. The three do not interfere as long as the drag provider is mounted inside the database view and never at the app root. The spike (#52) saw exactly that with the provider mounted inside a block; #64 keeps a regression test for it.

## Tech stack

| Area          | Choice                                                                         |
| ------------- | ------------------------------------------------------------------------------ |
| Row models    | `@tanstack/react-table` 9: sorting, filtering, grouping, column order and size |
| Drag and drop | `@dnd-kit/react` 0.5 with `@dnd-kit/helpers`                                   |
| Calendar      | `@fullcalendar/react` 7 with the day grid and interaction parts                |
| New UI parts  | shadcn/ui `tabs`, `checkbox`                                                   |

FullCalendar brings `temporal-polyfill` as a peer dependency. That is a new dependency the brief does not name; it comes with the named library.

## Behaviour

### Views

- A database has at least one view. A new database gets one table view named "Table".
- Tabs above the table switch between views. `+` adds a view: choose the type. A tab's menu offers rename and delete. The last view cannot be deleted.
- The active view is part of the address (`/page/<id>?view=<viewId>`) and the last one per database is remembered locally.

### Filter, sort and group

- **Filter.** One or more conditions, each a property, an operator and a value. A row is shown when it meets all of them. Operators depend on the property type:

| Type     | Operators                                              |
| -------- | ------------------------------------------------------ |
| text     | contains, does not contain, is, is empty, is not empty |
| number   | =, ≠, >, <, is empty, is not empty                     |
| date     | is, before, after, is empty, is not empty              |
| select   | is, is not, is empty, is not empty                     |
| relation | contains, does not contain, is empty, is not empty     |

- **Sort.** One or more properties, each ascending or descending, applied in order. Without a sort, rows are in their manual order.
- **Group** (table view). By one property. Each group has a header with its value and count and can be collapsed. Rows without a value form their own group.
- **Properties.** Each view chooses which properties it shows and in which order. The title is always shown.

### Drag and drop in the table

- A column is resized by dragging the edge of its header and moved by dragging the header. Both are stored in the view.
- A row is moved by dragging its handle. That changes the manual order of the database, which all views share. It is switched off while the view has a sort.

### Kanban

- The view is grouped by one select property, chosen when the view is created and changeable later. A database without a select property is offered to create one.
- One column per option in the option's order, and one for rows without a value. Columns can be hidden.
- A card shows the row's title and the view's visible properties. Clicking it opens the row.
- Dragging a card to another column sets the property to that option. Dragging inside a column changes the manual order, unless the view has a sort.
- "New" at the bottom of a column creates a row with that option.

### Calendar

- A month grid. The view shows each row on the day of one date property, chosen when the view is created. Rows without that date are not shown; the toolbar says how many there are.
- Dragging an entry to another day changes the date. Clicking a day creates a row with that date. Clicking an entry opens the row.
- Month and weekday names and the first day of the week follow the UI language.

## View configuration

```ts
type FilterOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'greaterThan'
  | 'lessThan'
  | 'before'
  | 'after'
  | 'isEmpty'
  | 'isNotEmpty';

type ViewFilter = {
  propertyId: string;
  operator: FilterOperator;
  value: string | number | null; // date as yyyy-MM-dd, select as option id, relation as row id
};
type ViewSort = { propertyId: string; direction: 'asc' | 'desc' };
type ViewProperty = { propertyId: string; visible: boolean; width: number | null }; // array order = display order

type ViewBase = {
  version: 1;
  filters: ViewFilter[];
  sorts: ViewSort[];
  properties: ViewProperty[];
};

type ViewConfig =
  | (ViewBase & { type: 'table'; groupBy: { propertyId: string; collapsed: string[] } | null })
  | (ViewBase & { type: 'kanban'; groupPropertyId: string | null; hiddenGroups: string[] })
  | (ViewBase & { type: 'calendar'; datePropertyId: string | null });

type View = { id: string; databaseId: string; name: string; position: number; config: ViewConfig };
```

- The configuration is plain JSON with `null` instead of missing keys. The backend parses it into a Rust enum tagged by `type` and refuses shapes it does not know.
- A configuration may mention a property or option that has been deleted. Readers skip such entries; `delete_property` also removes them (#59).
- The title column is addressed with the reserved property id `title`.

## Commands

| Command       | Arguments                                                  | Returns | Package |
| ------------- | ---------------------------------------------------------- | ------- | ------- |
| `create_view` | `databaseId`, `name`, `config: ViewConfig`                 | `View`  | #58     |
| `update_view` | `id`, `name: string \| null`, `config: ViewConfig \| null` | `View`  | #58     |
| `delete_view` | `id`                                                       | nothing | #58     |
| `move_row`    | `rowId`, `afterRowId: string \| null`                      | nothing | #64     |

- `load_database` returns the views in order.
- `delete_view` refuses to delete the last view of a database.
- `move_row` gives the row a position between its new neighbours and touches no other row.

## Project structure

```
src-tauri/src/
  domain/view.rs           → `View`, `ViewConfig`
  storage/views.rs
  commands/views.rs
src/features/databases/
  ViewTabs.tsx
  viewState.ts             → `ViewConfig` ↔ TanStack table state
  toolbar/                 → FilterMenu, SortMenu, GroupMenu, PropertiesMenu
  dnd/                     → the only place that imports `@dnd-kit`
  table/GroupRow.tsx
  kanban/                  → KanbanView, KanbanColumn, KanbanCard, moveCard.ts
  calendar/                → CalendarView, toEvents.ts
e2e/support/drag.ts        → drags with real pointer movement
```

Where state lives:

| State                                                                 | Home                                    |
| --------------------------------------------------------------------- | --------------------------------------- |
| Database, properties, views, rows                                     | TanStack Query                          |
| Filters, sorts, grouping, collapsed groups, property order and widths | the stored view, updated optimistically |
| Active and edited cell                                                | Zustand                                 |
| Open menus, a width while it is being dragged, the visible month      | component state                         |
| Active view                                                           | the address                             |

## Testing strategy

- **Repository tests**: a configuration of every type round-trips; unknown shapes are refused; order of views; the last view; `move_row`.
- **Unit tests**: `viewState` round trip; `moveCard`; `toEvents`.
- **Component tests** against the fake backend: adding a filter, a sort and a grouping through the menus changes what the table shows.
- **End-to-end** in WebKit: two views with different settings survive a reload; a card moved in the kanban changes the value in the table; an entry moved in the calendar changes the date. Drags use real pointer movement (`page.mouse`), because neither library reacts to synthetic drag events.
- **Regression**: with a database open, dragging in the sidebar tree and dragging a block still work.

## Boundaries

- **Always:** Mount the drag provider inside the database view. Import `@dnd-kit` only in `dnd/`. Skip deleted properties and options when reading a configuration.
- **Ask first:** A premium part of FullCalendar. Filter groups with "or". A view type beyond the three.
- **Never:** Put a `@dnd-kit` draggable into the sidebar or the editor.

## Success criteria

- [ ] A database can have several views, and each keeps its own settings across a restart (#58, #63)
- [ ] The table can be filtered, sorted and grouped, and properties can be hidden (#63)
- [ ] Columns can be resized and reordered and rows reordered by dragging (#64)
- [ ] The kanban view moves rows between the options of a select property (#65)
- [ ] The calendar view shows rows on their date and moves them by dragging (#66)
- [ ] Dragging in the sidebar and in the editor is unaffected (#64)

## Open questions

- Whether the calendar is FullCalendar or a grid of our own is decided by the trial in #66.
- Keyboard handling of `@dnd-kit/react` and whether FullCalendar drags with pointer events were not verified.
- A side panel that shows a row beside the view, instead of navigating to its page, is left for later.
