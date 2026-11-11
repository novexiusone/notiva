# Notiva

Local-first Notion alternative for macOS. Tauri 2 (Rust backend, React frontend), data in embedded SurrealDB.

## Where things are

- `docs/en/specs/CAPABILITY-MAP.md`: modules, dependencies, build order, project-wide assumptions and boundaries. Read this first.
- `docs/en/specs/SPEC-<module-id>.md`: one spec per module. Read it before working on a module; when a decision changes, update the spec first.
- Backlog, ideas and tasks are GitHub issues in `novexlab/notiva`, never Markdown files.

## Language

Everything is English: code, identifiers, comments, commits, branches, issues, pull requests, docs. Documentation lives under `docs/<language>/`; `docs/en/` is the source of truth, `docs/de/` holds German translations. The UI defaults to English and ships a German locale.

## Workflow

- Use the `gh` CLI for GitHub.
- No commits on `main`. Branch `type/short-description` (`feat`, `fix`, `hotfix`, `release`, `chore`), then a pull request with `Closes #N`.
- Commits and PR titles follow Conventional Commits: `type(scope): description`. The scope is usually the module id.
- Squash merge. The PR title becomes the commit message on `main`.
- Never edit `CHANGELOG.md` or version numbers by hand; release-please and git-cliff own them.
