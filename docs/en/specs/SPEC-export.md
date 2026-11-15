# Spec: export

## Objective

Notes must never be locked in. The user can write any page, with its subpages, or the whole workspace to disk as plain Markdown files that open in any editor and keep their structure, links and images. Databases are exported too: the table as a Markdown table, every row as a file of its own.

## Behaviour

- **Export a page.** "Export as Markdown…" in a page's menu asks for a folder and exports that page together with its subpages. For a database, the subpages are its rows.
- **Export everything.** "Export all pages…" in the settings menu asks for a folder and exports every page.
- **Never overwrites.** The export is written into a new folder inside the chosen one, named "Notiva export" (or "Notiva export 2", and so on, when that exists).
- **Feedback.** When it is done, a notice says how many pages were written and where. Databases and rows count as pages. If it fails, the notice says why and nothing half-written is left behind as the result.

### Layout on disk

```
Notiva export/
  Reading list.md
  Reading list/
    Fiction.md            ← subpage of "Reading list"
    Fiction/
      Dune.md
  Projects.md
  Projects/
    Books.md              ← database below "Projects": the table
    Books/
      Dune.md             ← row of "Books": its properties and content
      Dune/
        Notes.md          ← subpage of the row
  assets/
    3f2a….png             ← images, shared by all pages
```

- A page becomes `<title>.md`. Its subpages go into a folder with the same name next to it.
- A database is laid out like a page, and its rows like its subpages: the database becomes `<title>.md`, its rows go into the folder `<title>/`, and pages below a row go into a folder named after the row. This holds wherever the database is: at the top, below a page or below a row.
- File names are the page titles with characters that are not allowed in file names replaced. An untitled page is called "Untitled". Pages with the same name under the same parent get a number.
- Pages keep their order only through their names; Markdown files have no order. The rows of a database keep their manual order in the database's table.

### Markdown

Each file starts with the page title as a level 1 heading. Blocks map as follows:

| Block          | Markdown                                               |
| -------------- | ------------------------------------------------------ |
| Paragraph      | text, followed by a blank line                         |
| Heading 1 to 3 | `##` to `####`, one level below the page title         |
| Bullet list    | `- item`, nested items indented                        |
| Numbered list  | `1. item`, numbered in sequence, nested items indented |
| Check list     | `- [ ] item` and `- [x] item`                          |
| Quote          | `> text`                                               |
| Code block     | fenced with three backticks and the language           |
| Image          | `![caption](path)`, with the file copied to `assets/`  |
| Database       | a link to the database's file, on a line of its own    |

Inline formatting: bold `**`, italic `*`, strikethrough `~~`, code with backticks, links `[text](url)`. Underline has no Markdown form and is written as `<u>`. Colours are dropped. Characters that Markdown would read as formatting are escaped.

A link to another page becomes a relative Markdown link to that page's file when the page is part of the export, and plain text with the page title when it is not. A link to a deleted page becomes the text "Deleted page".

A database inside a page (a block `{ type: 'database', props: { databaseId } }`) follows the same rule: a link to the database's file with its title as the text, the plain title when the database is not part of the export, and the text "Deleted database" when no database with that id exists.

### Databases

A database becomes a file with its title and a table. The first column is the title of the row, with the header "Name" like in the app, and links to the row's file. Then comes one column per property, in the order of the properties. There is one line per row, in the rows' manual order. Every property is exported; views, their filters, sorting and hidden properties play no role. A database without properties has only the "Name" column, a database without rows only the header of the table.

Each row becomes a file like a page: its title, then a list of its properties with their values in the order of the properties, then its content. The list's items start with `*`, while lists in the content start with `-`, so a list at the top of the content stays a list of its own. Properties without a value are left out of the list; the table shows every property. A row without any value has no list. A row exported on its own, without its database, keeps its list.

Values are written as text:

| Type     | Value                                                                        |
| -------- | ---------------------------------------------------------------------------- |
| text     | the text                                                                     |
| number   | the number as a change of type to text writes it (`1.5`, `1000000`, `1e+21`) |
| date     | `yyyy-MM-dd`                                                                 |
| select   | the name of the option; empty when the option no longer exists               |
| relation | empty, until relations are built (#61)                                       |

A value that does not fit its property, such as an option that was deleted, is empty, and so is every value of a property type without a rule in this table. Such a value never stops the export.

Text in the table and in the list is plain text, never formatting:

- Characters that Markdown would read as formatting are escaped as in the rest of the page, `|` and `\` included. A link's target is URL-encoded, so it never contains `|`.
- A line break becomes `<br>` in the table and a hard line break in the list. Empty lines of a value are dropped in the list, and a further line that would start a list or underline a heading is escaped.
- Leading and trailing spaces are dropped, as Markdown drops them anyway.
- An empty title is written as "Untitled", an empty property name as "Untitled" as well.

A database "Books" with the properties "Pages" (number) and "Status" (select) becomes `Books.md`. The columns are not padded to the same width:

```text
# Books

| Name | Pages | Status |
| --- | --- | --- |
| [Dune](Books/Dune.md) | 412 | Read |
| [Untitled](Books/Untitled.md) |  |  |
```

Its row "Dune" becomes `Books/Dune.md`:

```text
# Dune

* Pages: 412
* Status: Read

A classic.
```

The export reads a database with a fixed number of queries, however many rows it has: the properties, the rows with their values and the content of all rows are each read at once.

## Commands

| Command       | Arguments                             | Returns         |
| ------------- | ------------------------------------- | --------------- |
| `export_page` | `pageId: string`, `directory: string` | `ExportSummary` |
| `export_all`  | `directory: string`                   | `ExportSummary` |

```ts
type ExportSummary = { directory: string; pages: number; images: number };
```

The folder is chosen with the system's folder dialog (`tauri-plugin-dialog`). The backend writes only inside the folder it creates.

## Project structure

```
src-tauri/src/export/
  markdown.rs     → blocks to Markdown, pure
  database.rs     → a database's table and a row's property list, pure
  layout.rs       → which page goes to which file, pure
  mod.rs          → reads pages, blocks and images and writes the files
src-tauri/src/commands/export.rs
src/features/export/
  useExport.ts    → folder dialog, command, notice
```

## Testing strategy

- **Unit tests** for the Markdown of every block type, nesting, inline formatting, escaping and the three kinds of page link and of database block.
- **Unit tests** for databases: the value of every property type, a deleted option, a value of the wrong type, and every kind of text that could break a table.
- **Unit tests** for the layout: nesting, file-name cleaning, duplicate names, relative paths between pages at different depths.
- **Integration test**: a small workspace with subpages, links and an image is exported into a temporary directory and the files are read back.
- **Integration tests** for databases: a database with a property of every type, rows and row content is exported and read back, and the links from the table lead to files that exist. Also a database without properties, one without rows, rows with an empty or the same title, databases below a page and below a row, and inline database blocks. A database with a few thousand rows is exported in a time the test prints.
- **End-to-end**: the menu entries, the notice on success and the notice on failure, against the fake backend. The fake backend does not write files.

## Boundaries

- **Always:** Write into a new folder. Clean every file name. Copy images instead of referring to the app's data directory.
- **Ask first:** Exporting to formats other than Markdown.
- **Never:** Overwrite or delete anything in the chosen folder. Follow a path taken from page content.

## Success criteria

- [ ] A page is exported as `.md`, subpages as a folder structure (#18)
- [ ] All MVP block types are mapped correctly (#18)
- [ ] Page links become relative Markdown links (#18)
- [ ] Images are included in the export (#15)
- [ ] A database is exported as a table, its rows as files with their properties (#68)
