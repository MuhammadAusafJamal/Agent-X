# Phase 7 — Reports, knowledge, explorer

**Goal:** ship-quality output, and the demo that shows it.

**Demo:** run the same execution twice and `diff` the reports — identical bytes. Then let the explorer loose on the app and watch it propose tests nobody wrote.

---

## E7.1 — Report generation · `TODO`

**Goal:** a run produces an artifact someone can read without the dashboard.

**Depends on:** E4.3, E6.4.

**Deliverables**

- Per-execution Markdown + JSON summary: outcome, per-step verdicts with rationales, healings applied, bugs filed, timing, token/cost totals, evidence links.
- **Deterministic output.** Per `CONTRIBUTING.md`, every generated artifact is sorted so repeat runs produce identical bytes. That means sorted collections, no map-iteration order, and timestamps either omitted or clearly separated from the comparable body.
- Web report page and a static export for sharing.

**Files:** `apps/api/src/reports/**`, `apps/web/src/app/executions/[id]/report/**`

**Acceptance**

- [ ] Two runs of the same passing spec produce byte-identical report bodies.
- [ ] The report is readable standalone — outcomes and rationales, not just status codes.
- [ ] Evidence links resolve from the exported file.

---

## E7.2 — Post-run knowledge consolidation · `TODO`

**Goal:** one pass folds a run's lessons into knowledge.

**Depends on:** E5.4, E6.2.

**Deliverables**

- After each run: fold in successful resolutions, approved heals, verifier outcomes, and human adjudications of `UNCERTAIN` steps.
- Confidence updates and decay applied here rather than scattered through the loop, so the math has one home.
- Promotion: a target that has resolved the same way three runs running becomes a high-confidence `SELECTOR_MEMORY`. Demotion: repeated misses drop below the floor.
- Idempotent — consolidating the same run twice must not double-count.

**Files:** `apps/api/src/knowledge/consolidation.service.ts`

**Acceptance**

- [ ] A stable target's confidence climbs across runs.
- [ ] A target that stopped working decays below the floor and stops being tried at rung 1.
- [ ] Re-consolidating a run is a no-op.

---

## E7.3 — Explorer agent · `TODO`

**Goal:** find tests nobody wrote.

**Depends on:** E5.2, E5.4.

**Deliverables**

- Goal-driven crawl of an application ("find every path to checkout"), running in `EXPLORE` mode through the same orchestrator loop.
- **Hard bounds**: step budget, LLM call budget, wall-clock limit, and a URL allowlist scoped to the environment's `baseUrl`.
- Destructive-action avoidance — the explorer does not click "Delete account" to see what happens. Denylist by accessible name and role, plus a confirmation-dialog guard.
- Output: proposed `TestSpec`s with `source: EXPLORED`, queued for human review rather than saved as trusted tests.
- Discovered flows written as `FLOW` knowledge.

**Files:** `apps/api/src/agent/explorer/**`, `apps/api/src/llm/prompts/explore.ts`

> The explorer is the one component that acts on an application without a human having scripted it. Bound it in code — budgets, allowlist, denylist — not in prompt instructions. A model told not to click Delete will eventually click Delete.

**Acceptance**

- [ ] Exploration stops at its budget and reports what it covered.
- [ ] Navigation outside the allowlisted origin is refused.
- [ ] Destructive controls are not activated — verified against a seeded destructive button.
- [ ] Proposed specs land in review, never directly in the trusted set.

---

## E7.4 — Example app and demo polish · `TODO`

**Goal:** the demo never depends on a live third-party site.

**Depends on:** E1.1. **Pull forward** — Phases 5 and 6 demo against this app.

**Deliverables**

- A small deliberately-breakable web app in `examples/` with: a login, a form flow, a list/detail view, and a checkout-ish multi-step flow.
- **Breakage switches** driven by env vars or a control panel, so a demo can trigger each scenario on cue:

  | Switch | Demonstrates |
  | --- | --- |
  | rename a button's label | Phase 5 — LLM resolution + knowledge write-back |
  | move a field to another step | Phase 6 — heal + reverify |
  | return a 500 on submit | Phase 6 — bug report, no heal |
  | slow a response past a threshold | Phase 6 — flake detection |
  | change a success message's wording | Phase 4 — semantic verification |

- Seed script: a project, an application, an environment, and one recorded spec, so a fresh clone demos without a manual recording.
- One-command demo runner.

**Files:** `examples/**`, `apps/api/prisma/seed.ts`, root `demo` script

**Acceptance**

- [ ] `npm run demo` from a clean clone reaches a passing run with no manual steps.
- [ ] Each breakage switch produces its intended Agent X behaviour.
- [ ] The example app runs offline.
