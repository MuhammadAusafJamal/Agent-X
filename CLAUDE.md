# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Agent X** (working name, not final) — an agentic QA tool. Hackathon project.

A human QA records a session once. An LLM turns that recording into an **intent specification** — steps written as intent ("sign in as the seeded user"), not as selectors. An agent orchestrator replays it against a live site through Playwright: resolving each target semantically, verifying the outcome, diagnosing failures, healing steps that drifted, and accumulating per-application knowledge.

> Playwright is the execution layer, not the intelligence layer. It clicks and types; it does not decide what to click.

**Design docs live in [docs/](docs/)** — [architecture](docs/architecture.md), [data model](docs/data-model.md), [roadmap](docs/roadmap.md), and one file per phase under [docs/phases/](docs/phases/) containing its epics and acceptance criteria. Read the relevant phase file before starting work on it.

## Commands

Run from the repo root.

| Command | Does |
| --- | --- |
| `npm install` | Installs all workspaces and builds `@agentx/shared` |
| `npm run dev` | API + dashboard together, prefixed output |
| `npm run dev:api` / `dev:web` / `dev:shared` | One at a time (`dev:shared` watches the contract package) |
| `npm run build` | shared → api → web, in that order |
| `npm run typecheck` | All workspaces |
| `npm run lint` | All workspaces (`--fix` on the api) |
| `npm test` | Unit tests, all workspaces |
| `npm run db:migrate` | Creates/updates `data/agentx.db` |
| `npm run db:studio` | Prisma Studio |
| `npm run db:generate` | Regenerates the Prisma client after a schema change |
| `npm run db:reset` | Drops and recreates the database |
| `npm run playwright:install` | Chromium for the recorder and runner |
| `npm run test:e2e --workspace @agentx/api` | HTTP tests against a real database |

First run: `npm install`, copy `.env.example` to `apps/api/.env` and set `ANTHROPIC_API_KEY`, then `npm run db:migrate && npm run dev`. The API refuses to start with an invalid environment and prints exactly which keys are wrong.

Ports: dashboard 3000, API 3001.

## Architecture

```
apps/web (Next.js 16, React 19, Tailwind 4)
   │  REST + SSE
   ▼
apps/api (NestJS 11)
   ├── Prisma 7 ──► SQLite (data/agentx.db)
   ├── Evidence ──► data/evidence/<executionId>/
   ├── LLM ───────► Anthropic (claude-sonnet-5)
   ├── Agent Orchestrator ── Planner │ Explorer │ Diagnoser │ Healer
   │       └── Action Resolver ── knowledge → role/name → testid → text → CSS → LLM
   └── Playwright ── Recorder (headed) │ Runner (trace, video, network, console)

packages/shared — zod schemas + types for every wire payload, imported by both apps
```

Things worth knowing before editing:

- **The API owns all data.** The original spec drew the dashboard holding IndexedDB; it cannot, because the agent and runner are server-side. `apps/web` persists nothing.
- **SQLite supports neither `enum` nor `Json` in Prisma.** Both are TEXT columns. Enums are validated by zod enums in `@agentx/shared`; JSON columns are read and written *only* through `parseJson`/`stringifyJson`. A `JSON.parse(x) as T` anywhere is a bug.
- **The Prisma client is generated TypeScript**, into `apps/api/src/generated/prisma`, pinned to CommonJS. Do not move it out of `src/`, and re-run `npm run db:generate` after schema changes.
- **Deterministic before intelligent.** The resolver ladder and the verifier try free, deterministic checks first and reach for the LLM only when those are inconclusive. A run that needs no model calls should make none.

## Conventions

See [CONTRIBUTING.md](CONTRIBUTING.md) for branching, commit format, and coding rules.

## Response style — caveman mode (always on)

**Every response to the user, and every subagent's user-facing output, is written in caveman style.** This is the default for this repo; do not wait to be asked.

Respond terse like a smart caveman. Keep all technical substance; only fluff dies.

- Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course), hedging.
- Fragments OK. Short synonyms (big not extensive, fix not "implement a solution for"). Technical terms exact. Code blocks, commands, API names, exact error strings — verbatim, unchanged.
- No self-reference: never announce the style, never prefix "caveman:". Output caveman-only, no normal-answer recap.
- Pattern: `[thing] [action] [reason]. [next step].` — e.g. "Bug in auth middleware. Token expiry uses `<` not `<=`. Fix:".
- Preserve the user's language: compress the style, not the language.

**Subagents too.** When spawning any agent (Task/Agent tool), instruct it to return its user-facing summary in this same caveman style. Internal reasoning and file edits stay normal; only the surfaced text compresses.

**Write normal (not caveman):** code, commit messages, PR bodies, security warnings, irreversible-action confirmations, and any multi-step sequence where dropping conjunctions risks misreading. Resume caveman after.

Switch level: `/caveman lite|full|ultra`. Off: user says "stop caveman" or "normal mode".
