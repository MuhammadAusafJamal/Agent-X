# Phase 3 — Execution engine

**Goal:** specs run and produce evidence — **with no LLM in the loop**.

**Demo:** replay the recorded login end to end, with a downloadable Playwright trace.

The deliberate constraint of this phase is that no model is called. The first five rungs of the resolver ladder are pure DOM and accessibility work, and building them alone means that when the agent layer lands in Phase 5, a failure has one obvious question attached: did the deterministic path break, or did the model decide wrong?

---

## E3.1 — Runner service · `TODO`

**Goal:** a spec version executes against an environment, collecting evidence throughout.

**Depends on:** E0.3, E1.3, E2.5.

**Deliverables**

- Browser + context lifecycle with `recordVideo` and `tracing.start({ screenshots: true, snapshots: true })` — Playwright's built-in capture covers **all** of this phase's evidence needs, so write no custom instrumentation.
- Per-step collection: screenshot, pruned DOM snapshot, pruned a11y tree, network requests attributable to the step, console messages.
- Network and console listeners attached at context level with a step-boundary marker, so each observation is attributed to the right step.
- Timeouts at two levels — per step and per run — plus **cooperative cancellation** checked between steps.
- Credential resolution via E1.3, with redaction applied before anything is written to disk.
- Guaranteed teardown: browser, context, video, and trace are finalized on success, failure, cancellation, and API shutdown alike.

**Files:** `apps/api/src/runner/{runner.service.ts,observation-collector.ts,browser-pool.ts}`

**Acceptance**

- [ ] A run produces `trace.zip` openable in `npx playwright show-trace`.
- [ ] Every step has a screenshot, a DOM snapshot, and a network log.
- [ ] Cancelling mid-run stops within one step boundary and still finalizes the trace.
- [ ] A crashed page fails the run with a real error rather than hanging until the run timeout.
- [ ] No browser process survives a run, including a failed one.

---

## E3.2 — Action Resolver v1 · `TODO`

**Goal:** turn a `targetDescription` + `targetHints` into exactly one element, deterministically.

**Depends on:** E3.1.

**Deliverables**

- The ladder, tried in order — first strategy yielding **exactly one** visible, enabled element wins:

  | # | Strategy | Lookup |
  | --- | --- | --- |
  | 1 | `KNOWLEDGE` | last-known-good selector for this step key on this application |
  | 2 | `ROLE_NAME` | `getByRole(role, { name })` |
  | 3 | `TEST_ID` | `getByTestId` |
  | 4 | `TEXT` | `getByText` |
  | 5 | `CSS` | ranked candidates from capture time |

- Zero matches or multiple matches → fall to the next rung. Rung 5 exhausting without a unique match is a resolution failure, recorded as such. **No blind `.first()`** — silently taking the first of six matches is how a test passes against the wrong button.
- Every attempt records the winning strategy, the candidate count, and a confidence value on the `ExecutionStep`.
- Auto-waiting via Playwright locators rather than sleeps.
- Knowledge write-back on success (the store itself lands in E5.4; here it is written and read as a plain table).

**Files:** `apps/api/src/resolver/{resolver.service.ts,strategies/**}`

> `resolutionStrategy` and `candidateCount` are the feedback signal the whole intelligence layer later reads, not diagnostics. Record them accurately from the start — retrofitting them once Phase 5 depends on them means re-running everything.

**Acceptance**

- [ ] A step resolving via `ROLE_NAME` records that strategy, not a generic success.
- [ ] An ambiguous target records `candidateCount > 1` and moves down the ladder instead of guessing.
- [ ] A resolution failure names what it looked for and what it found.
- [ ] The ranker and each strategy are unit-tested as pure functions.

---

## E3.3 — Execution API · `TODO`

**Goal:** runs are startable, observable, and cancellable.

**Depends on:** E3.1, E3.2.

**Deliverables**

- `POST /executions` (spec version + environment + mode), `GET /executions/:id/events` (**SSE**), `POST /executions/:id/cancel`, plus list and detail.
- `ExecutionStep` and `Observation` rows written **as they happen** — a crashed run must still leave a readable timeline.
- A run queue that serializes executions in the MVP. Parallel workers are Phase 8; two headed browsers fighting over the same demo is worse than a wait.
- Status roll-up onto `Execution` from its steps.

**Files:** `apps/api/src/executions/**`

**Acceptance**

- [ ] SSE emits a step event per transition, live.
- [ ] Killing the API mid-run leaves the completed steps queryable.
- [ ] Cancel returns promptly and the final status is `CANCELLED`, not `FAILED`.
- [ ] A second execution queues rather than launching a competing browser.

---

## E3.4 — Evidence store · `TODO`

**Goal:** artifacts are on disk, addressable, and portable.

**Depends on:** E3.1.

**Deliverables**

- The layout from [../architecture.md](../architecture.md): `data/evidence/<executionId>/{trace.zip,video.webm,step-<n>/…}`.
- `Artifact` rows holding **relative** paths, so the directory can be moved or zipped without rewriting the database.
- Read-only static serving at `/evidence`, with **path traversal rejected** — the id is validated against the database before any path is joined, and the resolved path is confirmed to sit inside `EVIDENCE_DIR`.
- A retention command to delete evidence for old executions, since traces and video are the bulk of disk use.

**Files:** `apps/api/src/evidence/**`

**Acceptance**

- [ ] Every artifact row resolves to a file that exists.
- [ ] `GET /evidence/../../.env` is rejected.
- [ ] Moving `data/evidence` to a new path and updating `EVIDENCE_DIR` keeps every artifact reachable.

---

## E3.5 — Run view · `TODO`

**Goal:** watch a run happen.

**Depends on:** E3.3, E3.4, E0.4.

**Deliverables**

- Live step timeline over SSE with status chips, per-step duration, and the resolution strategy used.
- Per-step evidence links; trace download.
- Run list with status and duration; re-run from a previous execution.

**Files:** `apps/web/src/app/executions/**`

**Acceptance**

- [ ] Steps update live without a refresh.
- [ ] Opening a run that finished before the page loaded shows the full timeline from history.
- [ ] The trace downloads and opens in the Playwright trace viewer.
