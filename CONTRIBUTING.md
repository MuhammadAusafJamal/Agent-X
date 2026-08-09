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

The standing rules:

- **Parse at the boundary, don't cast.** Untrusted input (HTTP body, LLM response, JSON column, CLI arg) is narrowed by a validating parser before it reaches anything that trusts it. A cast on request data is how unvalidated input reaches a query or a shell.
- **Secrets from the environment only, never flags or committed files.** Add every new key to `.env.example`; keep `.env` gitignored.
- **Validate config up front** and print exactly what's missing before doing any work.
- **Document the _why_.** Non-trivial functions carry a doc comment explaining intent and trade-offs, not just mechanics.
- **Deterministic output.** Anything generated (reports, fixtures, test artifacts) is sorted so repeat runs produce identical bytes.

How they apply in this codebase:

- **One schema, two apps.** Every wire payload is a zod schema in `packages/shared`. The API validates requests against it and the dashboard parses responses against it, so the contract cannot drift. Do not redeclare a shape locally.
- **`ZodValidationPipe` at every controller boundary.** `@Body(new ZodValidationPipe(createProjectSchema))` — never an untyped `@Body()`.
- **JSON columns go through `parseJson` / `stringifyJson`.** SQLite has no JSON type, so these columns are TEXT. `JSON.parse(row.targetHints) as TargetHints` is a cast wearing a parse's clothes; it is a bug.
- **Enum-backed columns are TEXT too.** Their allowed values live in `@agentx/shared`, and `schema-contract.spec.ts` asserts the Prisma schema and the zod enums stay in step.
- **Credentials never enter the database.** `Environment.credentialRefs` stores environment variable *names*. Resolved values are redacted before anything reaches evidence files, logs, reports, or a prompt.
- **`strict: true` everywhere.** Implicit `any` is an uncast boundary.
- **Errors carry a code.** Throw the `AppException` subclasses in `apps/api/src/common/errors.ts` so the dashboard branches on `code`, not on a message string. Never forward a raw database error to a client — it can quote row data.

## Local checks before a PR

```bash
npm run typecheck && npm run lint && npm test
npm run test:e2e --workspace @agentx/api   # needs a migrated database
```

Also confirm a clean clone still works, in full:

```bash
npm install                  # postinstall generates the Prisma client
npm run playwright:install
npm run db:migrate
npm run dev
```

CI gates on the same set for every PR into `main`/`develop` —
[`.github/workflows/ci.yml`](.github/workflows/ci.yml). It runs typecheck, lint,
unit tests, and the e2e suite against a real browser, with a placeholder
`ANTHROPIC_API_KEY`: every test either overrides the LLM client or asserts that
no model call was made, so nothing in CI reaches Anthropic.

The real-model path is `npm run smoke`, which is **not** in CI because it costs
credits. Run it by hand before a demo — it is the only thing that exercises the
eight prompts under `apps/api/src/llm/prompts/`.
