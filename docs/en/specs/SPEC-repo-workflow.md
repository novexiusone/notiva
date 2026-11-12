# Spec: repo-workflow

## Objective

The repository enforces the agreed workflow itself instead of relying on discipline: every change starts as an issue, reaches `main` through a properly named branch and a pull request, and version, release and changelog are produced automatically from the commits.

## Tools

| Purpose                                   | Tool                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| Check PR titles                           | `amannn/action-semantic-pull-request`                                    |
| Check commit messages                     | `wagoid/commitlint-github-action` with `@commitlint/config-conventional` |
| Check branch names                        | Shell step with a regex                                                  |
| Version, tag, GitHub release              | `googleapis/release-please-action` (manifest mode)                       |
| `CHANGELOG.md` in Keep a Changelog format | `orhun/git-cliff-action`                                                 |
| Branch protection                         | GitHub ruleset on `main`                                                 |

## Workflow

1. Open an issue (form: bug, feature, idea or task).
2. Branch `type/short-description` from `main`. Allowed types: `feat`, `fix`, `hotfix`, `release`, `chore`.
3. Commit using Conventional Commits: `type(scope): description`. The scope is optional and usually the module id.
4. Open a pull request with a Conventional Commit title and `Closes #N` in the body.
5. Squash merge. The PR title becomes the commit message on `main`, which makes it the source for version and changelog.
6. release-please keeps a release PR open. git-cliff writes `CHANGELOG.md` into it. Merging the release PR creates the tag and the GitHub release.

### Versioning

- Semantic Versioning. Before `1.0.0`, `feat` bumps the minor and `fix` the patch version; breaking changes bump the minor version.
- The version lives in `package.json` and nowhere else. `tauri.conf.json` reads it from there, so the app and its bundle carry the released version. The crate version in `src-tauri/Cargo.toml` stays at `0.0.0` and is not used.
- The first release is `0.1.0`.

### Known limitation

Pull requests created with the `GITHUB_TOKEN` do not trigger workflows, so the required checks do not start on the release PR by themselves. Close and reopen the release PR once: that event comes from a person and starts the checks. The ruleset stays strict and has no bypass.

### Repository settings the automation needs

- Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests" must be on, otherwise release-please cannot open the release PR.

### Release builds

When a release is created, the `bundle` job builds the app on macOS and attaches the `.dmg` to the GitHub release. The build is unsigned (#27).

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
- Release builds are unsigned until #27, so macOS warns when the downloaded app is opened.
