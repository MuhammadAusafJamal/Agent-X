# Phase 0 — Foundation

**Goal:** both apps boot against a real schema, share one typed contract, and the docs stop lying.

**Demo:** `npm run dev` serves a dashboard wired to a live API and a real database.

Starting point: a two-app npm-workspaces monorepo where both apps are still at their generator defaults. `apps/api` is NestJS 11 with `playwright`, `@anthropic-ai/sdk`, `zod`, and `@nestjs/config` already in `dependencies` but only the stock `app.controller/service/module`. `apps/web` is Next.js 16 + React 19 + Tailwind 4 + shadcn/Radix with the stock marketing `page.tsx`. `node_modules` is not installed.

---

## Versions — settled in E0.0 (2026-08-08)

| Package | Version | Note |
| --- | --- | --- |
| `prisma` / `@prisma/client` | **7.9.1** | Prisma 7 dropped the Rust engine in favour of the query compiler + driver adapters, so SQLite goes through `@prisma/adapter-better-sqlite3`. E0.3 must instantiate the client **with an adapter** — the Prisma 6 connection style will not work. |
| `@prisma/adapter-better-sqlite3` | 7.9.1 | |
| `better-sqlite3` | 13.0.3 | Native, but **verified to install from a prebuild** on Node 24 / Windows x64 — 26s, no `node-gyp`, binary loads and runs. The `prisma@6.19.3` fallback was therefore not needed. |
| `zod` | 4.4.3 | Standardized across api, web, and shared. Reminders for zod 4: `z.email()` replaces `z.string().email()`, and error customization uses `error`, not `message`. |
| `concurrently` | 10.0.4 | root `dev` script |

Toolchain: Node v24.12.0, npm 11.6.2.

> **Carried into E5.1:** `@anthropic-ai/sdk@0.71.2` depends on **zod 3.25.76** internally. Our first-party code is uniformly zod 4, and the two copies coexist fine — but do **not** hand an `@agentx/shared` zod-4 schema to an SDK helper that expects its own zod 3. Validate model responses with our own schemas against the returned text instead, which is what E5.1 specifies anyway.

---

## E0.0 — Workspace and dependencies · `DONE`

**Goal:** one `npm install` produces a working monorepo with a third workspace.

**Depends on:** nothing.

**Deliverables**

- Branch `feature/phase-0-foundation` off `develop` (already created).
- Root `package.json`: add `"packages/*"` to `workspaces` **before** `"apps/*"`, add `concurrently` to `devDependencies`, and add the scripts listed in E0.5.
- `apps/api`: add `@prisma/client` + the adapter deps; add `prisma` to `devDependencies`; move `zod` to `^4`.
- `apps/web`: **remove** `dexie` and `dexie-react-hooks`; add `zod` `^4`; add `transpilePackages: ['@agentx/shared']` to `next.config.ts`.
- Resolve the Prisma question above empirically — attempt the 7.x install, watch whether `better-sqlite3` fetches a prebuild or invokes `node-gyp`, and fall back to 6.19.3 if it compiles.

**Two changes made beyond the original scope, both cheap now and expensive later:**

- **`apps/api/tsconfig.json` now sets `strict: true`.** The Nest scaffold shipped `noImplicitAny: false` and `strictBindCallApply: false`, which quietly undercuts `CONTRIBUTING.md`'s "parse at the boundary, don't cast" rule — implicit `any` *is* an uncast boundary. Flipping it with an empty `src/` costs nothing; flipping it in Phase 5 would mean retrofitting the agent layer.
- **`apps/web`'s typecheck runs `next typegen` first.** This Next version generates `LayoutProps` and route types into `.next/types/`, so `tsc` alone fails on a clean clone with `Cannot find name 'LayoutProps'`. `next typegen` generates them without a full build.

**Acceptance**

- [x] `npm install` from a clean tree completes with no native compile step — 1271 packages, 6m, 0 vulnerabilities.
- [x] `npm ls zod` reports one version (4.4.3) across all three first-party workspaces. Vendor packages carry their own zod 3 internally; see the note above.
- [x] The chosen Prisma major is recorded at the top of this file.
- [x] Both apps resolve and typecheck against `@agentx/shared` — verified with a throwaway import in each app.
- [x] `npm run typecheck` passes across all three workspaces.

---

## E0.1 — Shared contract package · `DONE`

**Goal:** one place defines every wire payload, so the API and the dashboard cannot drift.

**Depends on:** E0.0.

**Deliverables**

- `packages/shared` published as `@agentx/shared`, CommonJS (`"type": "commonjs"`) so Nest consumes it without interop friction; Next handles CJS fine.
- `main`/`types`/`exports` point at `dist`. A `prepare` script builds on install so a fresh clone needs no extra step, and `dev` runs `tsc --watch`.
- Contents, mirroring [../data-model.md](../data-model.md):
  - `enums.ts` — every zod enum from the enum table
  - `json.ts` — the JSON-column parse helpers (`parseJson(schema, raw)`, `stringifyJson(schema, value)`) that make casting unnecessary
  - `domain/` — entity schemas
  - `dto/` — request/response schemas, Phase 0–1 scope only (`Project`, `Application`, `Environment`)
  - `events.ts` — the SSE discriminated union
  - `api.ts` — the shared error shape and pagination envelope

**Files:** `packages/shared/{package.json,tsconfig.json,src/**}`

**As built**

- Layout: `primitives.ts`, `enums.ts`, `shapes.ts`, `json.ts`, `api.ts`, `events.ts`, `domain/{catalog,recording,spec,execution,intelligence}.ts`, `dto/catalog.dto.ts`.
- **Dates are ISO strings, not `Date`.** These schemas describe the wire shape; Prisma returns `Date`, so a mapping layer converts at the boundary. That layer is also where JSON columns get parsed and credentials get redacted, so it earns its place rather than being overhead.
- **Execution token/cost totals are computed, not stored.** `executionTotalsSchema` aggregates over `LlmCall` rows on read, so the totals E5.1 surfaces cannot drift from the audit rows they summarize. No denormalized columns on `Execution`.
- Added `RESOLUTION_LADDER` — the ladder as an ordered array the resolver walks, rather than an order hardcoded in control flow. Its test asserts every strategy appears, so no rung can become silently unreachable.
- Added `draftTestSpecSchema` / `draftTestStepSchema` — the id-less shape the E2.4 compiler emits, since nothing is persisted until a whole compilation validates.
- Jest added to this workspace (30 tests). `json.ts` and, later, the knowledge confidence math are real logic and needed a home for tests.

**Acceptance**

- [x] `npm run build --workspace @agentx/shared` emits `dist` with declaration files; `.spec.ts` files are excluded from the build.
- [x] Both apps import from `@agentx/shared` and typecheck — verified for types and at runtime (`require` from `apps/api`).
- [x] `parseJson` rejects a malformed JSON column with a readable error naming the column and the field: `TestStep.expectation#x1: JSON did not match the expected shape — kind: Invalid discriminator value…`, thrown as `JsonColumnError` rather than a raw `SyntaxError` or `ZodError`.
- [x] `npm test` green: 30 tests across 2 suites.

---

## E0.2 — API baseline · `DONE`

**Goal:** the API fails fast on bad config and returns consistent errors.

**Depends on:** E0.1.

**Deliverables**

- `ConfigModule` with a **zod-validated** env schema. On a missing or malformed key it prints exactly what is wrong and exits — per `CONTRIBUTING.md`, "validate config up front and print exactly what's missing before doing any work."

  | Key | Default | Notes |
  | --- | --- | --- |
  | `PORT` | `3001` | web dev server already holds 3000 |
  | `WEB_ORIGIN` | `http://localhost:3000` | CORS allowlist |
  | `DATABASE_URL` | `file:../data/agentx.db` | relative to `apps/api/prisma` |
  | `EVIDENCE_DIR` | `../../data/evidence` | |
  | `ANTHROPIC_API_KEY` | — | **required**, no default |
  | `ANTHROPIC_MODEL` | `claude-sonnet-5` | |
  | `PLAYWRIGHT_HEADLESS` | `false` | the recorder needs a headed browser |

- `.env.example` covering every key. `.env` is already gitignored.
- CORS restricted to `WEB_ORIGIN`.
- A global exception filter returning the `api.ts` error shape, and a `ZodValidationPipe` so a bad body is a 400 with field paths, not a 500.
- `GET /health` returning `{ status, version, db }`.
- Delete the stock `app.controller.ts`, `app.service.ts`, and `app.controller.spec.ts`.

**Files:** `apps/api/src/config/**`, `apps/api/src/common/{filters,pipes}/**`, `apps/api/src/health/**`, `apps/api/src/main.ts`, `.env.example`

**As built**

- **`main.ts` validates the environment before loading the module graph, then imports `AppModule` dynamically.** `ConfigModule.forRoot({ validate })` runs at module-*evaluation* time, so a static import throws during `require`, where Nest's own handler prints a dependency-injection stack trace over the list of missing keys. Validating first and importing after is what makes the config error readable. For the same reason `TypedConfigService` lives in its own file — importing it from `config.module.ts` would re-trigger validation as an import side effect.
- `urlSchema` (shared) rejects `localhost:3000`. Plain `z.url()` accepts it, because WHATWG parses it as the scheme `localhost:` — and it would then break CORS and Playwright navigation. Implemented as `z.url({ protocol: /^https?$/ })`.
- The exception filter never forwards an unrecognized error's message. Prisma errors quote the failing query, which can include row data.
- **`/health` counts a real table instead of running `SELECT 1`.** SQLite silently *creates* an empty file for a missing database, so `SELECT 1` returns green against a schema-less one. This was not hypothetical — with `DATABASE_URL` still at Prisma's `./dev.db` default, the API connected to an empty root-level `dev.db` and reported healthy. Counting a table fails immediately, and the startup log now prints the resolved absolute path. `test/setup-e2e.ts` pins `DATABASE_URL` for the same reason, so tests never inherit a developer's misconfiguration.

**Acceptance**

- [x] Booting with `ANTHROPIC_API_KEY` unset prints the missing key by name and exits non-zero, with no stack trace:
      `Invalid environment configuration:` / `  - ANTHROPIC_API_KEY: Invalid input: expected string, received undefined` / `Copy .env.example to .env…` — exit code 1.
- [x] `GET /health` → `{"status":"ok","version":"0.0.1","db":true,"uptimeSeconds":12}`. Verified both ways: `db:true` against the migrated database, `db:false` against an unmigrated one.
- [x] A request with an invalid body returns 400 with the offending field path — unit-verified on `ZodValidationPipe` (issues carry `path`, all invalid fields reported at once, unknown keys stripped). The HTTP round-trip lands with E1.1's first real route.
- [x] Preflight from `http://evil.example.com` returns `Access-Control-Allow-Origin: http://localhost:3000` rather than echoing the origin, so the browser blocks it.
- [x] Unknown routes return the shared error shape — e2e-asserted by *parsing* the body through `apiErrorSchema`.

---

## E0.3 — Prisma + SQLite · `DONE`

**Goal:** the full domain model exists as a migrated database.

**Depends on:** E0.0 (Prisma major), E0.1 (enum values must match the zod enums exactly).

**Deliverables**

- `apps/api/prisma/schema.prisma` implementing every entity in [../data-model.md](../data-model.md) — all 17 models.
- Initial migration committed under `prisma/migrations/`.
- `PrismaService` + a **global** `PrismaModule`, so feature modules inject without re-importing.
- DB file at `data/agentx.db`; add `data/` to `.gitignore`.
- Scripts in `apps/api`: `db:generate`, `db:migrate`, `db:studio`, `db:reset`.

**Two constraints to honour, both from [../data-model.md](../data-model.md):** Prisma supports neither `enum` nor `Json` on SQLite. Enum fields are `String` validated by the shared zod enums; JSON fields are `String` read and written only through `parseJson`/`stringifyJson`. Index every foreign key used in a list query, and set `onDelete: Cascade` on every child relation so deleting a project does not strand rows.

**Files:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/**`, `apps/api/src/prisma/**`, `apps/api/prisma.config.ts`

**Prisma 7 specifics that cost time — read before touching the schema**

- **The generated client is TypeScript source, not a compiled package**, and it defaults to ESM (`import.meta.url`, `./foo.js` specifiers). Nest compiles to CommonJS, so the generator is pinned with `moduleFormat = "cjs"` and `importFileExtension = ""`. Without those, the app fails at runtime with `Cannot use 'import.meta' outside a module`. The generated files carry `@ts-nocheck`, so `tsc` will *not* warn you — it fails only when something loads it.
- **Output goes to `src/generated/prisma`, not `generated/prisma`.** Anywhere outside `src/` pushes tsc's inferred rootDir up to the workspace root, which silently moves the build entrypoint from `dist/main.js` to `dist/src/main.js` and breaks `start:prod`. `prisma.config.ts` is excluded from `tsconfig.build.json` for the same reason.
- **The datasource URL now comes from `prisma.config.ts`**, not from `schema.prisma`. Both it and `PrismaService` call `resolveDatabaseUrl()`, which anchors a relative `file:` path to the **repo root** — the CLI, migrations, and the running API otherwise each resolve it against a different working directory.
- **The engine loads its WASM query compiler via dynamic `import()`**, which Jest cannot do in CommonJS. `test:e2e` runs under `cross-env NODE_OPTIONS=--experimental-vm-modules`.
- `prisma init` also installs ~60 files of vendored CLI documentation into `.claude/`, `.agents/`, and `.windsurf/`, plus `skills-lock.json`. Removed; re-runnable if ever wanted.

**Acceptance**

- [x] `npm run db:migrate` creates the database from nothing — `data/agentx.db`, migration `20260808175522_init`.
- [x] **17** model tables exist (the plan said 16 — a miscount; `Report` and `LlmCall` bring the total to 17).
- [x] Deleting a `Project` cascades to applications, environments, specs, versions, steps, executions, execution steps, and knowledge — verified against a scratch database, all counts 1 → 0, nothing stranded.
- [x] Every `-- enum X` annotation in `schema.prisma` resolves to a real zod enum in `@agentx/shared`, and every JSON column default parses against its schema — `schema-contract.spec.ts`, which reads the Prisma schema at test time rather than trusting a copy.

---

## E0.4 — Web baseline · `DONE`

**Goal:** an app shell that can talk to the API, including its event streams.

**Depends on:** E0.1, E0.2.

**Deliverables**

- App shell: sidebar nav (Projects / Runs / Knowledge / Bugs), header, dark mode.
- `lib/api.ts` — a typed `apiFetch` wrapper that parses responses through `@agentx/shared` schemas and surfaces the shared error shape.
- `lib/events.ts` — a `useEventStream` hook over `EventSource`, typed by the SSE union, handling reconnect and unmount cleanup.
- Delete the generator's marketing `page.tsx`; replace with a dashboard landing page.

**Files:** `apps/web/src/app/**`, `apps/web/src/lib/{api.ts,events.ts}`, `apps/web/next.config.ts`

> `apps/web/AGENTS.md` warns that this Next.js version differs from training data and that the relevant guide lives in `node_modules/next/dist/docs/`. **Read it before writing routes** — and note that block is regenerated by `next dev`, so commit it with the work rather than reverting it.

**As built**

- Placeholder routes exist for all four nav destinations, each naming the phase that fills it in — a nav with dead links is worse than one that says "arrives in Phase 3".
- **No shadcn components generated yet.** The shell uses the theme tokens already in `globals.css`. `Table`/`Dialog`/`Form` get added in E1.2, where forms and tables actually exist.
- **`ThemeToggle` holds no React state.** Which icon to show is a pure function of the `dark` class, so CSS decides it (`dark:block` / `dark:hidden`). Reading the DOM in an effect and calling `setState` would mean a cascading render and a first-paint mismatch — and this project has `reactCompiler: true`, whose lint rejects exactly that.
- **`useEventStream` resets during render, not in an effect** (React's documented pattern for adjusting state when a prop changes); an effect would render the previous stream's events once before clearing them. Refs are assigned in an effect, since writing a ref during render is disallowed.
- No bundled `node_modules/next/dist/docs` exists in this install, despite the note in `apps/web/AGENTS.md`.

**Acceptance**

- [x] Dashboard loads with **zero console messages** — no errors, no hydration warnings — verified in a real Chrome session, not just by curl.
- [x] All five routes return 200; `npm run build` prerenders all of them.
- [x] `apiFetch` surfaces a typed `ApiRequestError` when the API is down (`isUnreachable`, with the "Is it running?" hint) rather than an unhandled rejection, and rejects a response that does not match its schema.
- [x] `useEventStream` closes its `EventSource` on unmount and on a `path` change, via the effect's cleanup.
- [x] `dexie` and `dexie-react-hooks` no longer appear in `apps/web`.
- [x] The live dashboard shows the API's real health — endpoint, version, `database: connected`, uptime — which also proves CORS works from a browser origin.

---

## E0.5 — Tooling and docs · `DONE`

**Goal:** one command runs everything; the docs describe what actually exists.

**Depends on:** E0.0–E0.4.

**Deliverables**

- Root scripts: `dev` (api + web via `concurrently`), `dev:shared`, `build`, `typecheck`, `lint`, `test`, `db:generate`, `db:migrate`, `db:studio`, `db:reset`, `playwright:install`.
- A `typecheck` script in each workspace (`tsc --noEmit`) — none exists today.
- Fill `CLAUDE.md` §Commands and §Architecture, which currently say the stack is undecided.
- Fill `CONTRIBUTING.md` §Coding conventions and §Local checks, which are placeholders.

**As built**

- `apps/web`'s typecheck runs `next typegen` first — this Next version generates `LayoutProps` and route types into `.next/types/`, so `tsc` alone fails on a clean clone.
- `CONTRIBUTING.md` §Coding conventions now states how each standing rule lands in this codebase (one schema for both apps, `ZodValidationPipe` at every boundary, JSON columns through the helpers, credentials by reference, `strict: true`, coded errors).

**Acceptance**

- [x] `npm run dev` starts both apps with `concurrently`, prefixed `api` / `web`.
- [x] `npm run typecheck && npm run lint && npm test` passes from the repo root — **0 errors, 0 warnings, 81 unit tests** across 6 suites, plus 2 e2e.
- [x] `CLAUDE.md` §Commands and §Architecture and `CONTRIBUTING.md` §Coding conventions and §Local checks are filled in.
- [x] Startup path documented: `npm install`, copy `.env.example` → `apps/api/.env`, set `ANTHROPIC_API_KEY`, `npm run db:migrate && npm run dev`.
