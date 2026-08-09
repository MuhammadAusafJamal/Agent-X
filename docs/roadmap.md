# Roadmap

Nine phases. Each ends at something demoable, so if the clock runs out mid-plan the last completed phase still shows.

| Phase | Goal | Demo at the end | Status |
| --- | --- | --- | --- |
| [0 — Foundation](phases/phase-0-foundation.md) | Both apps boot against a real schema and share one typed contract | `npm run dev` serves a dashboard wired to a live API and database | **`DONE`** |
| [1 — Catalog](phases/phase-1-catalog.md) | Somewhere to hang tests | Create project → application → environment | **`DONE`** |
| [2 — Recorder](phases/phase-2-recorder.md) | The headline input path | Record a login by hand; watch it become an editable English spec | **`DONE`** |
| [3 — Execution](phases/phase-3-execution.md) | Specs run and produce evidence | Replay that login end to end with a downloadable trace | **`DONE`** |
| [4 — Verification](phases/phase-4-verification.md) | A run means something | A broken step reports FAIL with the evidence that proves it | **`DONE`** |
| [5 — Agent](phases/phase-5-agent.md) | The intelligence layer | Rename a button; the agent still finds it, and remembers | **`DONE`** (E5.2 orchestrator partly — see phase file) |
| [6 — Heal](phases/phase-6-heal.md) | Close the loop | Move a field → self-heal. Break logic → file a bug instead | **`DONE`** (verified against the live model in Phase 7) |
| [7 — Reports](phases/phase-7-reports.md) | Ship-quality output | Deterministic reports, explorer agent, one-command demo | **`DONE`** (explorer is API-only — see the audit below) |
| [8 — Stretch](phases/phase-8-stretch.md) | Only if the above lands | Vision resolution, multi-browser, auth | `TODO` |

## Audit — 2026-08-09

A strict pass over the whole repository against the original scope, because
`DONE` had started to mean "the code was written" rather than "a stranger can
use it". What it found, and what was done about it.

**The backend held up.** 48 routes, no stubs, no `NotImplemented`, no
hardcoded returns. The resolver ladder, the three-state verifier, the
deterministic-first diagnoser, the `TEST_DRIFT` gate, the confidence curve, the
explorer's bounds, and report determinism are all genuinely built and match what
their phase files claim.

**Three claims did not hold, and are now corrected in place:**

- **The explorer has no UI.** `POST /explorations` works and is tested; nothing
  in `apps/web` calls it, so `EXPLORED` is a spec source a user cannot produce.
  Phase 7 is `DONE` on the agent, not on the feature.
- **Two knowledge kinds, not four.** `SELECTOR_MEMORY` and `FLOW` are written.
  `ELEMENT_ALIAS` and `DOMAIN_FACT` exist in the enum and nothing writes them.
  E5.4 claimed all four.
- **CI was a sentence.** `CONTRIBUTING.md` said CI gated every PR; `.github/`
  did not exist. It does now.

**Five defects that would have shown up in a demo, now fixed:**

1. Evidence was written **two directories above the repository**.
   `EVIDENCE_DIR` defaulted to `../../data/evidence` while `EvidenceService`
   resolved it from the repo root, so screenshots, traces, and video landed
   outside the checkout and outside `.gitignore`.
2. A run could **strand in `RUNNING` forever**. `chromium.launch` sat outside
   the runner's `try`, after the status had already been set, so a missing
   Playwright browser skipped `finish()` entirely and leaked the browser.
3. **A fresh clone could not build.** The Prisma client is gitignored,
   `@prisma/client` has no `postinstall`, and `db:generate` was documented only
   as something to run after a schema change. `npm run demo` died at `db:seed`.
4. **Errored runs never closed their stream.** The dashboard's terminal-event
   check named `execution.finished` and missed `execution.error`, so a failed
   run sat on an empty timeline indefinitely.
5. **The explorer's prompts were not redacted.** Its redactor was built from an
   empty credential set, which makes `redact()` a silent no-op — so every page
   it read reached the model verbatim.

**The dashboard was measured, not guessed.** Empty database to first passing
run was 7 screens, 5 dialogs, 12 fields, **15 clicks**, plus one step with no UI
at all. It is now 4 screens, 1 dialog, 3 fields, **5 clicks** — and one click on
a seeded database, which is the number a demo actually runs on.

What remains deliberately unbuilt is listed under **Not built** in each phase
file. The rule going forward: a `DONE` means a stranger can clone the repository
and use the thing, not that the code exists.

## Sequencing rationale

**Why the runner is fully deterministic before any LLM touches it (Phase 3 before Phase 5).** The Action Resolver ladder's first five rungs need no model. Building them first means that when the agent layer lands, a failure has one obvious question attached: did the deterministic path break, or did the model decide wrong? Invert the order and every demo failure is a coin flip between a Playwright problem and a prompt problem.

**Why verification (Phase 4) precedes the agent (Phase 5).** Diagnosis and healing are reactions to a verdict. Without a trustworthy verdict there is nothing to react to, and a healer wired to a bad verifier will confidently heal working code.

**Why the intent compiler (E2.4) lands with the recorder rather than with the agent.** It is the step that makes the whole premise visible — a recording becoming readable English is the moment the tool stops looking like Playwright codegen. It also produces the fixture every later phase tests against.

**Why healing is split from diagnosis (E6.1 vs E6.2).** Classification is the hard part and is useful alone: a run that says "this is an application bug, not a broken test" already beats a red X. Healing rides on top of a classifier that works.

## Dependency graph

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 ──► Phase 6 ──► Phase 7
                                                                │
                                          E7.4 (example app) ◄──┘  needed to demo 5 and 6
```

`E7.4` builds the deliberately-breakable example app. Phases 5 and 6 demo against it — renaming a button, moving a field — so **pull E7.4 forward if that demo is needed before Phase 7**. It is listed in Phase 7 because that is where its remaining polish belongs, not because the app can wait that long.

## Definition of done, per phase

1. `npm run typecheck && npm run lint && npm run test` clean from the repo root.
2. `npm run dev` — API `GET /health` returns ok, dashboard loads with no console errors.
3. Every epic's acceptance boxes checked.
4. The phase's demo runs end to end on a clean clone (`npm install && npm run db:migrate && npm run dev`).
