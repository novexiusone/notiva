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

Databases and their views, tags, favourites, recently opened, quick switcher, templates, import, trash, version history, backup and encryption each have an issue labelled `priority: low` and only get a spec after the MVP.

Deliberately excluded: real-time sync, permissions, comments, web clipper.

## Applies to every module

### Architecture

- The app shell is Tauri 2: Rust backend, React frontend in the WebView.
- The frontend talks to the backend only through Tauri commands (`invoke`). SurrealDB is never accessed from the WebView.
- Database access sits behind a repository layer in the Rust backend. No SurrealDB types appear outside that layer.
- Frontend features are solved with an existing library first (BlockNote, shadcn/ui, react-arborist, cmdk, TanStack Query, Zustand). A library is only replaced when it demonstrably fails a requirement.

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
