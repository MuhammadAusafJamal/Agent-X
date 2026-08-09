# Agent X

An agentic QA tool.

A human QA records a session once. An LLM turns that recording into an **intent specification** — steps written as intent ("sign in as the seeded user"), not as selectors. An agent replays it against a live site through Playwright: resolving each target semantically, verifying the outcome, diagnosing failures, healing steps that drifted, and accumulating per-application knowledge so later runs get cheaper.

> Playwright is the execution layer, not the intelligence layer. It clicks and types; it does not decide what to click.

The distinction the whole thing is built around: **the system heals its own drift, and never heals over a real defect.** A renamed button gets repaired and queued for review. A 500 on submit files a bug report instead.

---

## First run

Node 20.11 or newer. Everything below is run from the repository root.

```bash
git clone <this repo> && cd Agent-X

npm install                     # installs workspaces, builds @agentx/shared,
                                # and generates the Prisma client

cp .env.example .env            # or apps/api/.env — both are loaded
# then edit .env and set ANTHROPIC_API_KEY

npm run playwright:install      # Chromium, for the recorder and the runner
npm run db:migrate              # creates data/agentx.db

npm run dev                     # dashboard on 3000, API on 3001
```

`ANTHROPIC_API_KEY` is the only value with no default. The API validates its
environment before it boots and prints exactly which keys are wrong, so a
missing one fails in a second rather than ten minutes into a recording.

### The demo, in one command

```bash
npm run demo
```

Migrates, seeds a project, an application, an environment, and a five-step
specification, then starts the example app (port 4321) alongside both services
with demo credentials already in the environment.

Open <http://localhost:3000> and press **Run it** on the card the home page
shows. The run passes in five steps with exactly one model call — the semantic
step, and only that.

To watch it heal, stop the demo and restart the example app with a breakage
switch:

```bash
BREAK_REDESIGN=1 npm run demo:app
```

Re-run the same specification. The submit button has been renamed and
duplicated, the recorded landmark no longer narrows it, and the resolver
correctly refuses. The failure is diagnosed as `TEST_DRIFT`, repaired with a
landmark-scoped target, reverified, and queued under **Healing** for you to
approve. Approving writes version 2; the next run passes with one model call
again.

`BREAK_500_ON_SUBMIT=1` breaks the application's logic instead. That one files a
bug report and heals nothing — which is the asymmetry the whole design exists
for. `examples/demo-app/server.js` documents the rest of the switches at the
top of the file.

---

## Commands

| Command | Does |
| --- | --- |
| `npm install` | Installs all workspaces, builds `@agentx/shared`, generates the Prisma client |
| `npm run dev` | API + dashboard together, prefixed output |
| `npm run dev:api` / `dev:web` / `dev:shared` | One at a time (`dev:shared` watches the contract package) |
| `npm run build` | shared → api → web, in that order |
| `npm run typecheck` | All workspaces |
| `npm run lint` | All workspaces (`--fix` on the api) |
| `npm test` | Unit tests, all workspaces |
| `npm run test:e2e --workspace @agentx/api` | HTTP tests against a real database and a real browser |
| `npm run smoke` | The happy path against the **real model**. Costs API credits; not part of `npm test` |
| `npm run demo` | Migrates, seeds, then starts the example app + API + dashboard |
| `npm run demo:setup` | Just the generate-migrate-and-seed half |
| `npm run db:migrate` | Creates/updates the database (interactive; `db:deploy` is the non-interactive form) |
| `npm run db:seed` | Project, application, environment, and one recorded spec — idempotent |
| `npm run db:generate` | Regenerates the Prisma client after a schema change |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | Drops and recreates the database |
| `npm run playwright:install` | Chromium for the recorder and runner |

Ports: dashboard 3000, API 3001, example app 4321.

---

## Where things live

```
apps/web        Next.js 16 dashboard
apps/api        NestJS 11 — Prisma, Playwright, the agent, the LLM client
packages/shared zod schemas and types for every wire payload, imported by both
examples/demo-app  a deliberately breakable target app, no dependencies
docs/           architecture, data model, roadmap, and one file per phase
data/           the SQLite database and the evidence tree (gitignored)
```

Evidence — screenshots, traces, video, DOM and network logs — is written to
`data/evidence/<executionId>/`. `Artifact` rows store paths relative to that
root, so the whole directory can be moved or zipped without touching the
database.

---

## Credentials

`Environment.credentialRefs` stores **environment variable names, never
values.** The runner reads `process.env[name]` at execution time, so a secret
never reaches SQLite, the evidence tree, a report, or a model prompt. Values
that are set are also registered with a redactor that scrubs them from
everything on its way out of the process.

The dashboard shows which referenced variables are currently set and hands you
a block to paste into `apps/api/.env`, with the values left blank. It cannot
set them for you, and that is deliberate.

---

## Documentation

Start with [docs/architecture.md](docs/architecture.md). The
[roadmap](docs/roadmap.md) lists the phases, and each has its own file under
[docs/phases/](docs/phases/) with its epics and acceptance criteria.

[CONTRIBUTING.md](CONTRIBUTING.md) covers branching, commit format, and coding
rules.
