# Notiva

Lokale Notion-Alternative für macOS. Tauri 2 (Rust-Backend, React-Frontend), Daten in SurrealDB embedded.

## Wo was steht

- `docs/specs/CAPABILITY-MAP.md`: Module, Abhängigkeiten, Reihenfolge, projektweite Annahmen und Grenzen. Zuerst lesen.
- `docs/specs/SPEC-<modul-id>.md`: Spec je Modul. Vor der Arbeit an einem Modul lesen, bei geänderten Entscheidungen zuerst die Spec anpassen.
- Backlog, Ideen und Aufgaben sind GitHub-Issues in `novexlab/notiva`, nie Markdown-Dateien.

## Arbeitsablauf

- GitHub wird über die `gh` CLI bedient.
- Kein Commit auf `main`. Branch `type/kurze-beschreibung` (`feat`, `fix`, `hotfix`, `release`, `chore`), dann PR mit `Closes #N`.
- Commits und PR-Titel nach Conventional Commits, englisch: `type(scope): description`. Scope ist in der Regel die Modul-ID.
- Merge per Squash. Der PR-Titel wird zur Commit-Message auf `main`.
- `CHANGELOG.md` und Versionsnummern nie von Hand ändern, das übernehmen release-please und git-cliff.

## Sprache

Code, Bezeichner, Commits: englisch. UI-Texte, Specs, Issues: deutsch.
