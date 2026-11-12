# Spec: export

## Objective

Notes must never be locked in. The user can write any page, with its subpages, or the whole workspace to disk as plain Markdown files that open in any editor and keep their structure, links and images.

## Behaviour

- **Export a page.** "Export as Markdown…" in a page's menu asks for a folder and exports that page together with its subpages.
- **Export everything.** "Export all pages…" in the settings menu asks for a folder and exports every page.
- **Never overwrites.** The export is written into a new folder inside the chosen one, named "Notiva export" (or "Notiva export 2", and so on, when that exists).
- **Feedback.** When it is done, a notice says how many pages were written and where. If it fails, the notice says why and nothing half-written is left behind as the result.

### Layout on disk

```
Notiva export/
  Reading list.md
  Reading list/
    Fiction.md            ← subpage of "Reading list"
    Fiction/
      Dune.md
  Projects.md
  assets/
    3f2a….png             ← images, shared by all pages
```

- A page becomes `<title>.md`. Its subpages go into a folder with the same name next to it.
- File names are the page titles with characters that are not allowed in file names replaced. An untitled page is called "Untitled". Pages with the same name under the same parent get a number.
- Pages keep their order only through their names; Markdown files have no order.

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

Inline formatting: bold `**`, italic `*`, strikethrough `~~`, code with backticks, links `[text](url)`. Underline has no Markdown form and is written as `<u>`. Colours are dropped. Characters that Markdown would read as formatting are escaped.

A link to another page becomes a relative Markdown link to that page's file when the page is part of the export, and plain text with the page title when it is not. A link to a deleted page becomes the text "Deleted page".

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
  layout.rs       → which page goes to which file, pure
  mod.rs          → reads pages, blocks and images and writes the files
src-tauri/src/commands/export.rs
src/features/export/
  useExport.ts    → folder dialog, command, notice
```

## Testing strategy

- **Unit tests** for the Markdown of every block type, nesting, inline formatting, escaping and the three kinds of page link.
- **Unit tests** for the layout: nesting, file-name cleaning, duplicate names, relative paths between pages at different depths.
- **Integration test**: a small workspace with subpages, links and an image is exported into a temporary directory and the files are read back.
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
