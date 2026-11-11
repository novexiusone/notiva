# Spec: repo-workflow

## Ziel

Das Repo erzwingt den vereinbarten Arbeitsablauf selbst, statt sich auf Disziplin zu verlassen: Jede Änderung beginnt als Issue, kommt über einen sauber benannten Branch und einen PR nach `main`, und Version, Release und Changelog entstehen automatisch aus den Commits.

## Werkzeuge

| Zweck | Werkzeug |
|---|---|
| PR-Titel prüfen | `amannn/action-semantic-pull-request` |
| Commit-Messages prüfen | `wagoid/commitlint-github-action` mit `@commitlint/config-conventional` |
| Branch-Namen prüfen | Shell-Schritt mit Regex |
| Version, Tag, GitHub-Release | `googleapis/release-please-action` (Manifest-Modus) |
| `CHANGELOG.md` im Keep-a-Changelog-Format | `orhun/git-cliff-action` |
| Branch-Schutz | GitHub Ruleset auf `main` |

## Ablauf

1. Issue anlegen (Template: Bug, Feature, Idee oder Aufgabe).
2. Branch `type/kurze-beschreibung` von `main`. Erlaubte Typen: `feat`, `fix`, `hotfix`, `release`, `chore`.
3. Commits nach Conventional Commits: `type(scope): description`. Der Scope ist optional und entspricht in der Regel der Modul-ID.
4. PR mit Conventional-Commit-Titel und `Closes #N` im Text.
5. Merge per Squash. Der PR-Titel wird zur Commit-Message auf `main` und ist damit die Quelle für Version und Changelog.
6. release-please hält einen Release-PR offen. git-cliff schreibt darin die `CHANGELOG.md`. Der Merge des Release-PR erzeugt Tag und GitHub-Release.

### Versionierung

- Semantic Versioning. Vor `1.0.0` erhöht `feat` die Minor- und `fix` die Patch-Version, Breaking Changes erhöhen die Minor-Version.
- Die Version steht in `package.json`. `src-tauri/Cargo.toml` und `src-tauri/Cargo.lock` werden von release-please mitgezogen, `tauri.conf.json` liest die Version aus `package.json`.
- Die Release-Automatik wird deshalb erst eingerichtet, wenn das App-Gerüst (`app-shell`) existiert.

### Bekannte Einschränkung

PRs, die mit dem `GITHUB_TOKEN` erstellt werden, lösen keine Workflows aus. Die Pflicht-Checks laufen im Release-PR daher nicht. Admins dürfen das Ruleset über einen PR umgehen und können den Release-PR trotzdem mergen. Ein direkter Push auf `main` bleibt auch für Admins gesperrt.

## Befehle

```bash
# Changelog lokal ansehen (unveröffentlichte Änderungen)
git cliff --unreleased

# Lint-Workflow eines PR ansehen
gh pr checks <nummer>

# Ruleset ansehen
gh api repos/novexlab/notiva/rulesets
```

## Struktur

```
.github/ISSUE_TEMPLATE/     → Issue-Forms: bug, feature, idea, task; config.yml
.github/pull_request_template.md
.github/workflows/lint-pr.yml   → PR-Titel, Commits, Branch-Name
.github/workflows/release.yml   → release-please und git-cliff
commitlint.config.mjs
cliff.toml
release-please-config.json
.release-please-manifest.json
```

Labels, Ruleset und Merge-Einstellungen sind Repo-Einstellungen und liegen nicht als Dateien vor.

## Stil

```
feat(editor): add slash menu with markdown hints
fix(links): keep backlinks when a page is renamed
chore(ci): cache cargo registry
```

Beschreibung klein geschrieben, im Imperativ, ohne Punkt am Ende. Breaking Changes mit `!` nach Typ oder Scope.

## Teststrategie

Geprüft wird am echten Repo, nicht mit Unit-Tests:

- Der PR, der die Lint-Workflows einführt, muss sie selbst bestehen.
- Negativtest: Ein Wegwerf-PR mit ungültigem Titel und Branch-Namen muss fehlschlagen und wird danach geschlossen.
- Ein direkter Push auf `main` muss abgelehnt werden.
- Nach dem ersten `feat`-Merge muss ein Release-PR mit korrekter `CHANGELOG.md` entstehen.

## Grenzen

- **Immer:** Actions auf eine Major-Version pinnen. Workflows bekommen nur die Rechte, die sie brauchen.
- **Vorher fragen:** Personal Access Tokens oder GitHub Apps einführen, Sichtbarkeit des Repos ändern, Ruleset lockern.
- **Nie:** `CHANGELOG.md` oder Versionsnummern von Hand ändern. Workflows mit `pull_request_target` und Checkout von PR-Code.

## Erfolgskriterien

- [ ] Vier Issue-Forms setzen ihr `type:`-Label und `status: triage`, leere Issues sind deaktiviert (#2)
- [ ] PR mit Titel `update stuff` schlägt fehl (#3)
- [ ] Branch `my-branch` schlägt fehl, `feat/slash-menu` besteht (#3)
- [ ] Commit ohne Conventional-Commit-Format schlägt fehl (#3)
- [ ] Direkter Push auf `main` wird abgelehnt, Force-Push und Löschen sind gesperrt (#5)
- [ ] Nur Squash-Merge ist erlaubt, Branches werden nach dem Merge gelöscht (#5)
- [ ] Nach einem `feat`-Merge entsteht ein Release-PR mit `CHANGELOG.md` im Keep-a-Changelog-Format (#4)
- [ ] Der Merge des Release-PR erzeugt Tag und GitHub-Release (#4)

## Offene Punkte

- Das GitHub Project (Board) braucht den Token-Scope `project` (#6).
- Release-Builds (`.dmg`) am GitHub-Release hängen kommt mit `app-shell`, Signierung später (#27).
