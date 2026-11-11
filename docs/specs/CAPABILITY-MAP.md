# Capability Map: Notiva MVP

Notiva ist eine lokale Notion-Alternative für macOS: ein Nutzer, keine Kollaboration, kein Cloud-Zwang. Diese Map ist der Index aller Modul-Specs. Jedes Modul bekommt vor seiner Umsetzung eine eigene Spec (`SPEC-<modul-id>.md`) in diesem Ordner.

## Module

| Modul-ID | Verantwortung | Hängt ab von | Spec |
|---|---|---|---|
| `repo-workflow` | Issue-Templates, Labels, CI-Linting (Commits, PR-Titel, Branch-Namen), Release- und Changelog-Automatik, Branch-Schutz | — | [SPEC-repo-workflow.md](SPEC-repo-workflow.md) |
| `app-shell` | Tauri + React + Vite-Gerüst, Tailwind/shadcn, Theme, Layout mit Sidebar und Hauptbereich, Build-CI | `repo-workflow` | folgt |
| `storage` | SurrealDB embedded, Repository-Schicht, Schema, Migrationen, Benchmark | `app-shell` | folgt |
| `pages` | Seiten anlegen, umbenennen, verschieben, löschen; Hierarchie; Sidebar-Baum | `storage` | folgt |
| `editor` | BlockNote, Abbildung Block-JSON auf Block-Records, Autosave, Slash-Menü, Bilder, Undo/Redo, Shortcuts | `pages` | folgt |
| `links` | `[[...]]`-Verlinkung und Backlinks über Graph-Relationen | `editor` | folgt |
| `search` | Volltextsuche samt Such-UI | `editor` | folgt |
| `export` | Export nach Markdown | `editor` | folgt |

Reihenfolge: `repo-workflow` → `app-shell` → `storage` → `pages` → `editor` → `links`, `search`, `export`.

Die Modul-IDs sind stabil. Sie tauchen als Label (`area: <modul-id>`), als Commit-Scope und im Dateinamen der Spec auf.

## Nicht im MVP

Datenbanken und ihre Ansichten, Tags, Favoriten, Zuletzt geöffnet, Quick Switcher, Templates, Import, Papierkorb, Versionshistorie, Backup und Verschlüsselung haben jeweils ein Issue mit `priority: low` und bekommen erst nach dem MVP eine Spec.

Bewusst nicht enthalten: Echtzeit-Sync, Rechteverwaltung, Kommentare, Web-Clipper.

## Gilt für alle Module

### Architektur

- App-Shell ist Tauri 2: Rust-Backend, React-Frontend im WebView.
- Das Frontend spricht ausschließlich über Tauri-Commands (`invoke`) mit dem Backend. SurrealDB wird nie aus dem WebView angesprochen.
- Der Datenbankzugriff liegt hinter einer Repository-Schicht im Rust-Backend. Außerhalb dieser Schicht tauchen keine SurrealDB-Typen auf.
- Frontend-Funktionen werden zuerst mit einer bestehenden Library gelöst (BlockNote, shadcn/ui, react-arborist, cmdk, TanStack Query, Zustand). Eine Library wird nur ersetzt, wenn sie eine Anforderung nachweislich nicht erfüllt.

### Festgelegte Annahmen

- Paketmanager ist pnpm.
- UI-Texte sind deutsch und liegen zentral, damit eine Übersetzung möglich bleibt.
- Code, Bezeichner und Commit-Messages sind englisch. Specs und Issues sind deutsch.
- Im MVP öffnet das Suchfeld der Sidebar (Cmd+K) die Volltextsuche. Favoriten und Quick Switcher kommen danach.
- Bilder liegen als Dateien im App-Datenordner, Blöcke speichern nur die Referenz.
- Undo/Redo gilt innerhalb einer Editor-Sitzung.
- Builds sind im MVP unsigniert.

### Grenzen

- **Immer:** Arbeit beginnt mit einem Issue. Änderungen kommen über einen Branch `type/kurze-beschreibung` und einen PR mit `Closes #N`. Tests und Lint laufen vor dem Commit.
- **Vorher fragen:** Wechsel einer festgelegten Library oder der Datenbank, Änderungen an veröffentlichten Releases, alles, was Nutzerdaten löscht oder migriert.
- **Nie:** Direkt auf `main` committen. Backlog, Ideen oder Aufgaben in Markdown-Dateien pflegen (`TODO.md`, `BACKLOG.md`, `IDEAS.md`). `CHANGELOG.md` oder Versionsnummern von Hand ändern. Secrets committen.
