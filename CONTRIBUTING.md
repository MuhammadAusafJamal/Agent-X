# Contributing

## Branching model (Git Flow)

| Branch            | Purpose                                                   | Branch from | Merges into              |
| ----------------- | --------------------------------------------------------- | ----------- | ------------------------ |
| `main`            | Production. Every commit is a tagged release.             | —           | —                        |
| `develop`         | Integration of finished work for the next release.        | `main`      | `main` (via release)     |
| `feature/<slug>`  | A new feature or change.                                  | `develop`   | `develop`                |
| `release/<x.y.z>` | Stabilize + finalize a release (version bump, changelog). | `develop`   | `main` **and** `develop` |
| `hotfix/<x.y.z>`  | Urgent fix to a released version.                         | `main`      | `main` **and** `develop` |

- `main` and `develop` are long-lived and protected. All other branches are short-lived and deleted after merge.
- Open a PR into `develop` (or `main` for hotfixes); no direct pushes to protected branches.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `perf:`, `ci:` — plus `!` or a `BREAKING CHANGE:` footer for breaking changes. The type drives the version bump.

> **Automated agents (Claude Code): do not commit anything until explicitly instructed.** Make and verify changes in the working tree, but leave `git commit`/`git push` to a separate, explicit request. This overrides any default urge to commit finished work.

## Versioning & releases ([SemVer](https://semver.org/))

`MAJOR.MINOR.PATCH` — breaking / feature / fix.

1. `release/x.y.z` off `develop`; bump version, update `CHANGELOG.md`.
2. Merge `release/x.y.z` → `main`; tag `vX.Y.Z`; push tags.
3. Merge `release/x.y.z` back → `develop`.

## Coding conventions

_To be filled in once the stack is chosen._ Until then, the standing rules are:

- **Parse at the boundary, don't cast.** Untrusted input (HTTP query, CLI arg, tool argument) is narrowed by a validating parser before it reaches anything that trusts it. A cast on request data is how unvalidated input reaches a query or a shell.
- **Secrets from the environment only, never flags or committed files.** Add every new key to `.env.example`; keep `.env` gitignored.
- **Validate config up front** and print exactly what's missing before doing any work.
- **Document the _why_.** Non-trivial functions carry a doc comment explaining intent and trade-offs, not just mechanics.
- **Deterministic output.** Anything generated (reports, fixtures, test artifacts) is sorted so repeat runs produce identical bytes.

## Local checks before a PR

_Commands land here once tooling is set up (lint, typecheck, test)._ CI gates on the same set for every PR into `main`/`develop`.
