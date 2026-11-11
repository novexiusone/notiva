# Spec: repo-workflow

## Objective

The repository enforces the agreed workflow itself instead of relying on discipline: every change starts as an issue, reaches `main` through a properly named branch and a pull request, and version, release and changelog are produced automatically from the commits.

## Tools

| Purpose | Tool |
|---|---|
| Check PR titles | `amannn/action-semantic-pull-request` |
| Check commit messages | `wagoid/commitlint-github-action` with `@commitlint/config-conventional` |
| Check branch names | Shell step with a regex |
| Version, tag, GitHub release | `googleapis/release-please-action` (manifest mode) |
| `CHANGELOG.md` in Keep a Changelog format | `orhun/git-cliff-action` |
| Branch protection | GitHub ruleset on `main` |

## Workflow

1. Open an issue (form: bug, feature, idea or task).
2. Branch `type/short-description` from `main`. Allowed types: `feat`, `fix`, `hotfix`, `release`, `chore`.
3. Commit using Conventional Commits: `type(scope): description`. The scope is optional and usually the module id.
4. Open a pull request with a Conventional Commit title and `Closes #N` in the body.
5. Squash merge. The PR title becomes the commit message on `main`, which makes it the source for version and changelog.
6. release-please keeps a release PR open. git-cliff writes `CHANGELOG.md` into it. Merging the release PR creates the tag and the GitHub release.

### Versioning

- Semantic Versioning. Before `1.0.0`, `feat` bumps the minor and `fix` the patch version; breaking changes bump the minor version.
- The version lives in `package.json`. release-please also updates `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`; `tauri.conf.json` reads the version from `package.json`.
- Release automation is therefore set up once the app scaffold (`app-shell`) exists.

### Known limitation

Pull requests created with the `GITHUB_TOKEN` do not trigger workflows, so the required checks never run on the release PR. Admins may bypass the ruleset through a pull request and can still merge it. A direct push to `main` stays blocked for admins too.

## Commands

```bash
# Preview the changelog for unreleased changes
git cliff --unreleased

# Show the lint results of a pull request
gh pr checks <number>

# Show the ruleset
gh api repos/novexlab/notiva/rulesets
```

## Project structure

```
.github/ISSUE_TEMPLATE/         → issue forms: bug, feature, idea, task; config.yml
.github/pull_request_template.md
.github/workflows/lint-pr.yml   → PR title, commits, branch name
.github/workflows/release.yml   → release-please and git-cliff
commitlint.config.mjs
cliff.toml
release-please-config.json
.release-please-manifest.json
```

Labels, the ruleset and merge settings are repository settings and do not exist as files.

## Style

```
feat(editor): add slash menu with markdown hints
fix(links): keep backlinks when a page is renamed
chore(ci): cache cargo registry
```

The description is lowercase, imperative and has no trailing period. Breaking changes carry a `!` after the type or scope.

## Testing strategy

This module is verified against the real repository, not with unit tests:

- The pull request that introduces the lint workflow must pass it.
- Negative test: a throwaway pull request with an invalid title and branch name must fail and is closed afterwards.
- A direct push to `main` must be rejected.
- After the first `feat` merge a release PR with a correct `CHANGELOG.md` must appear.

## Boundaries

- **Always:** Pin actions to a major version. Give workflows only the permissions they need.
- **Ask first:** Introducing personal access tokens or GitHub Apps, changing repository visibility, loosening the ruleset.
- **Never:** Edit `CHANGELOG.md` or version numbers by hand. Use `pull_request_target` together with a checkout of pull request code.

## Success criteria

- [ ] Four issue forms set their `type:` label and `status: triage`; blank issues are disabled (#2)
- [ ] A PR titled `update stuff` fails (#3)
- [ ] A branch `my-branch` fails, `feat/slash-menu` passes (#3)
- [ ] A commit that is not a Conventional Commit fails (#3)
- [ ] A direct push to `main` is rejected; force-push and deletion are blocked (#5)
- [ ] Only squash merge is allowed and branches are deleted after merge (#5)
- [ ] After a `feat` merge a release PR with `CHANGELOG.md` in Keep a Changelog format appears (#4)
- [ ] Merging the release PR creates the tag and the GitHub release (#4)

## Open questions

- The GitHub Project (board) needs the `project` token scope (#6).
- Attaching release builds (`.dmg`) to the GitHub release comes with `app-shell`; signing comes later (#27).
