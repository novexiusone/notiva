# Capability Map: Notiva MVP

Notiva is a local-first Notion alternative for macOS: one user, no collaboration, no cloud requirement. This map is the index of all module specs. Every module gets its own spec (`SPEC-<module-id>.md`) in this folder before it is built.

## Modules

| Module id       | Responsibility                                                                                                          | Depends on      | Spec                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------- |
| `repo-workflow` | Issue forms, labels, CI linting (commits, PR titles, branch names), release and changelog automation, branch protection | —               | [SPEC-repo-workflow.md](SPEC-repo-workflow.md) |
| `app-shell`     | Tauri + React + Vite scaffold, Tailwind/shadcn, theme, layout with sidebar and main area, build CI                      | `repo-workflow` | [SPEC-app-shell.md](SPEC-app-shell.md)         |
| `storage`       | Embedded SurrealDB, repository layer, schema, migrations, benchmark                                                     | `app-shell`     | [SPEC-storage.md](SPEC-storage.md)             |
| `pages`         | Create, rename, move and delete pages; hierarchy; sidebar tree                                                          | `storage`       | [SPEC-pages.md](SPEC-pages.md)                 |
| `editor`        | BlockNote, mapping block JSON to block records, autosave, slash menu, images, undo/redo, shortcuts                      | `pages`         | [SPEC-editor.md](SPEC-editor.md)               |
| `links`         | `[[...]]` links and backlinks through graph relations                                                                   | `editor`        | [SPEC-links.md](SPEC-links.md)                 |
| `search`        | Full-text search including the search UI                                                                                | `editor`        | to follow                                      |
| `export`        | Export to Markdown                                                                                                      | `editor`        | to follow                                      |

Build order: `repo-workflow` → `app-shell` → `storage` → `pages` → `editor` → `links`, `search`, `export`.

Module ids are stable. They appear as a label (`area: <module-id>`), as the commit scope and in the spec's file name.

## Not in the MVP

Tags, favourites, recently opened, quick switcher, templates, import, trash, version history, backup and encryption each have an issue labelled `priority: low` and only get a spec after the MVP. Databases are planned below.

Deliberately excluded: real-time sync, permissions, comments, web clipper.

## After the MVP: databases

Notion-style databases are the first feature after the MVP (#19, #20). They are three modules:

| Module id        | Responsibility                                                                        | Depends on            | Spec                                             |
| ---------------- | ------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------ |
| `databases`      | Database pages, typed properties, rows as pages, cells, relations, the table          | `pages`, `storage`    | [SPEC-databases.md](SPEC-databases.md)           |
| `database-views` | Stored views per database; filter, sort and group; drag and drop; kanban and calendar | `databases`           | [SPEC-database-views.md](SPEC-database-views.md) |
| `database-embed` | A database as a block inside a normal page, inserted from the slash menu              | `databases`, `editor` | [SPEC-database-embed.md](SPEC-database-embed.md) |

Build order: `databases` → `database-views`, `database-embed`. `search` and `export` each get one extension (#69, #68).

### Work packages

Each package is one issue, built by one subagent on its own branch and delivered as one pull request. The issue lists the files the package owns. Packages in the same wave own different files and can be built at the same time; a wave starts when the packages it depends on are merged.

| Wave | Packages                                                                                                                                 | Needs                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1    | #52 spike: interactive block in BlockNote · #53 schema version 5 and database pages · #55 frontend commands, fake backend and page shell | the MVP on `main`                 |
| 2    | #54 properties, rows and cells · #58 stored views in the backend · #56 property types                                                    | #53; #53; #55                     |
| 3    | #57 table view · #59 deleting and converting properties · #62 benchmark                                                                  | #55, #56; #54, #58; #54           |
| 4    | #60 row pages · #63 view tabs and toolbar · #67 inline block · #68 export · #69 search                                                   | #57; #57, #58; #52, #57; #54; #54 |
| 5    | #64 drag and drop in the table · #66 calendar view                                                                                       | #63                               |
| 6    | #65 kanban view · #61 relation property                                                                                                  | #64; #60, #64                     |

Three files are shared by many packages and are not owned by one: the command registration in `src-tauri/src/lib.rs`, the two locale files, and `pnpm-lock.yaml`. A package adds its lines there; whichever pull request is merged second takes `main` in first and, for the lock file, runs `pnpm install` again.

The spec is the contract between frontend and backend, which is why #55 does not wait for #53 and #54.

## Applies to every module

### Architecture

- The app shell is Tauri 2: Rust backend, React frontend in the WebView.
- The frontend talks to the backend only through Tauri commands (`invoke`). SurrealDB is never accessed from the WebView.
- Database access sits behind a repository layer in the Rust backend. No SurrealDB types appear outside that layer.
- Frontend features are solved with an existing library first (BlockNote, shadcn/ui, react-arborist, cmdk, TanStack Query, TanStack Table, dnd-kit, Zustand). A library is only replaced when it demonstrably fails a requirement.

### Language

- Everything is English: code, identifiers, comments, commits, branches, issues, pull requests and documentation.
- Documentation lives under `docs/<language>/`. `docs/en/` is the source of truth. `docs/de/` holds German translations; more languages may follow.
- Specs exist in English only.
- The UI defaults to English and ships a German locale. Strings live in locale files, never inline in components.

### Fixed assumptions

- The package manager is pnpm.
- In the MVP the sidebar search field (Cmd+K) opens full-text search. Favourites and the quick switcher come later.
- Images are stored as files in the app data directory; blocks only store the reference.
- Undo/redo applies within one editor session.
- MVP builds are unsigned.

### Boundaries

- **Always:** Work starts with an issue. Changes arrive through a branch `type/short-description` and a pull request with `Closes #N`. Tests and lint run before committing.
- **Ask first:** Replacing a chosen library or the database, changing published releases, anything that deletes or migrates user data.
- **Never:** Commit directly to `main`. Keep a backlog, ideas or tasks in Markdown files (`TODO.md`, `BACKLOG.md`, `IDEAS.md`). Edit `CHANGELOG.md` or version numbers by hand. Commit secrets.
