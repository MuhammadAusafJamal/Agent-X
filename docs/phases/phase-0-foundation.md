# Phase 0 — Foundation

**Goal:** both apps boot against a real schema, share one typed contract, and the docs stop lying.

**Demo:** `npm run dev` serves a dashboard wired to a live API and a real database.

Starting point: a two-app npm-workspaces monorepo where both apps are still at their generator defaults. `apps/api` is NestJS 11 with `playwright`, `@anthropic-ai/sdk`, `zod`, and `@nestjs/config` already in `dependencies` but only the stock `app.controller/service/module`. `apps/web` is Next.js 16 + React 19 + Tailwind 4 + shadcn/Radix with the stock marketing `page.tsx`. `node_modules` is not installed.

---

## Version decisions to settle in E0.0

Checked against the registry on 2026-08-08. Two of these change how E0.3 is written, so settle them **before** writing the schema.

| Package | Latest | Decision |
| --- | --- | --- |
| `prisma` / `@prisma/client` | 7.9.1 | **Try 7.x first.** Prisma 7 defaults to the query compiler + driver adapters and no longer ships the Rust engine, so SQLite needs `@prisma/adapter-better-sqlite3` (7.9.1) plus `better-sqlite3` (13.0.3) — a native module. |
| `better-sqlite3` | 13.0.3 | Needs a prebuilt binary for **Node 24 on Windows**. If `npm install` tries to compile from source, that is the signal to fall back. |
| **Fallback** | `prisma@6.19.3` | Prisma 6 bundles its own engine and speaks SQLite with no adapter and no native module. Slower to start, zero install risk. |
| `zod` | 4.4.3 | `apps/api` currently pins `^3.24.1`. Nothing is written against it yet, so **standardize on `^4` across api, web, and shared** — one zod copy, one set of types. Note the zod 4 differences: `z.email()` replaces `z.string().email()`, and error customization uses `error` rather than `message`. |
| `concurrently` | 10.0.4 | For the root `dev` script. |

Local toolchain confirmed: Node v24.12.0, npm 11.6.2.

---

## E0.0 — Workspace and dependencies · `TODO`

**Goal:** one `npm install` produces a working monorepo with a third workspace.

**Depends on:** nothing.

**Deliverables**

- Branch `feature/phase-0-foundation` off `develop` (already created).
- Root `package.json`: add `"packages/*"` to `workspaces` **before** `"apps/*"`, add `concurrently` to `devDependencies`, and add the scripts listed in E0.5.
- `apps/api`: add `@prisma/client` + the adapter deps; add `prisma` to `devDependencies`; move `zod` to `^4`.
- `apps/web`: **remove** `dexie` and `dexie-react-hooks`; add `zod` `^4`; add `transpilePackages: ['@agentx/shared']` to `next.config.ts`.
- Resolve the Prisma question above empirically — attempt the 7.x install, watch whether `better-sqlite3` fetches a prebuild or invokes `node-gyp`, and fall back to 6.19.3 if it compiles.

**Acceptance**

- [ ] `npm install` from a clean tree completes with no native compile step.
- [ ] `npm ls zod` reports exactly one version across all workspaces.
- [ ] The chosen Prisma major is recorded at the top of this file, replacing the decision table.

---

## E0.1 — Shared contract package · `TODO`

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

**Acceptance**

- [ ] `npm run build --workspace @agentx/shared` emits `dist` with declaration files.
- [ ] Both apps import a type from `@agentx/shared` and typecheck.
- [ ] `parseJson` rejects a malformed JSON column with a readable error rather than throwing a raw `SyntaxError`.

---

## E0.2 — API baseline · `TODO`

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

**Acceptance**

- [ ] Booting with `ANTHROPIC_API_KEY` unset prints the missing key by name and exits non-zero — it does not boot and fail later.
- [ ] `GET /health` returns 200 with a reachable-database flag.
- [ ] A request with an invalid body returns 400 with the offending field path.
- [ ] A request from an origin other than `WEB_ORIGIN` is rejected.

---

## E0.3 — Prisma + SQLite · `TODO`

**Goal:** the full domain model exists as a migrated database.

**Depends on:** E0.0 (Prisma major), E0.1 (enum values must match the zod enums exactly).

**Deliverables**

- `apps/api/prisma/schema.prisma` implementing every entity in [../data-model.md](../data-model.md) — all 16 models.
- Initial migration committed under `prisma/migrations/`.
- `PrismaService` + a **global** `PrismaModule`, so feature modules inject without re-importing.
- DB file at `data/agentx.db`; add `data/` to `.gitignore`.
- Scripts in `apps/api`: `db:generate`, `db:migrate`, `db:studio`, `db:reset`.

**Two constraints to honour, both from [../data-model.md](../data-model.md):** Prisma supports neither `enum` nor `Json` on SQLite. Enum fields are `String` validated by the shared zod enums; JSON fields are `String` read and written only through `parseJson`/`stringifyJson`. Index every foreign key used in a list query, and set `onDelete: Cascade` on every child relation so deleting a project does not strand rows.

**Files:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/**`, `apps/api/src/prisma/**`

**Acceptance**

- [ ] `npm run db:migrate` creates the database from nothing.
- [ ] `npm run db:studio` lists all 16 models.
- [ ] Deleting a `Project` cascades to its applications, environments, specs, and executions.
- [ ] Every enum-backed column's allowed values match its zod enum in `@agentx/shared` — verified by a unit test, not by eye.

---

## E0.4 — Web baseline · `TODO`

**Goal:** an app shell that can talk to the API, including its event streams.

**Depends on:** E0.1, E0.2.

**Deliverables**

- App shell: sidebar nav (Projects / Runs / Knowledge / Bugs), header, dark mode.
- `lib/api.ts` — a typed `apiFetch` wrapper that parses responses through `@agentx/shared` schemas and surfaces the shared error shape.
- `lib/events.ts` — a `useEventStream` hook over `EventSource`, typed by the SSE union, handling reconnect and unmount cleanup.
- Delete the generator's marketing `page.tsx`; replace with a dashboard landing page.

**Files:** `apps/web/src/app/**`, `apps/web/src/lib/{api.ts,events.ts}`, `apps/web/next.config.ts`

> `apps/web/AGENTS.md` warns that this Next.js version differs from training data and that the relevant guide lives in `node_modules/next/dist/docs/`. **Read it before writing routes** — and note that block is regenerated by `next dev`, so commit it with the work rather than reverting it.

**Acceptance**

- [ ] Dashboard loads with no console errors and no hydration warnings.
- [ ] `apiFetch` surfaces a typed error when the API is down, rather than an unhandled rejection.
- [ ] `useEventStream` cleanly closes its connection on unmount — verified by navigating away mid-stream.
- [ ] `dexie` no longer appears anywhere in `apps/web`.

---

## E0.5 — Tooling and docs · `TODO`

**Goal:** one command runs everything; the docs describe what actually exists.

**Depends on:** E0.0–E0.4.

**Deliverables**

- Root scripts: `dev` (api + web via `concurrently`), `dev:shared`, `build`, `typecheck`, `lint`, `test`, `db:generate`, `db:migrate`, `db:studio`, `db:reset`, `playwright:install`.
- A `typecheck` script in each workspace (`tsc --noEmit`) — none exists today.
- Fill `CLAUDE.md` §Commands and §Architecture, which currently say the stack is undecided.
- Fill `CONTRIBUTING.md` §Coding conventions and §Local checks, which are placeholders.

**Acceptance**

- [ ] `npm run dev` starts both apps with distinguishable prefixed output.
- [ ] `npm run typecheck && npm run lint && npm run test` passes from the repo root.
- [ ] A clean clone runs `npm install && npm run db:migrate && npm run dev` with no undocumented step.
