# Phase 3 — Execution engine

**Goal:** specs run and produce evidence — **with no LLM in the loop**.

**Demo:** replay the recorded login end to end, with a downloadable Playwright trace.

The deliberate constraint of this phase is that no model is called. The first five rungs of the resolver ladder are pure DOM and accessibility work, and building them alone means that when the agent layer lands in Phase 5, a failure has one obvious question attached: did the deterministic path break, or did the model decide wrong?

---

## E3.1 — Runner service · `DONE`

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

**The bug this epic found — and the reason its test earned its keep**

The first run of the redaction test failed on `step-2/a11y.yaml`: **the password was in the accessibility snapshot.** Playwright's `ariaSnapshot()` reports a textbox's value, and for a password field that value is the real password. The redactor was wired into network and console collection but not into the DOM and ARIA artifacts.

Every text artifact now passes through the redactor. Screenshots need none — the browser renders a password field as dots.

That is the deferred half of E1.3, closed here because this is the first phase where a credential is typed into a real form.

**Acceptance**

- [x] A run produces `trace.zip`, plus a video, plus per-step screenshot, DOM, ARIA, network, and console artifacts — all verified present, rowed, and fetchable over HTTP.
- [x] Every step carries `URL`, `NETWORK`, and `CONSOLE` observations, which is exactly what Phase 4's verifier will read.
- [x] Trace and video are finalized in a `finally`, so a failed run keeps the evidence that explains it.
- [x] Credentials resolve **before** the browser opens; a missing one ends the run as `ERROR` naming the variable, with zero steps recorded.
- [x] No credential value appears anywhere in the text evidence tree — asserted by walking every `.json`/`.html`/`.yaml` file the run produced.
- [x] A failing non-optional step stops the run; a failing **optional** step is surfaced and the run continues.
- [ ] Cancelling mid-run — the flag, the between-step check, and the endpoint are all in place, but a run against the demo app finishes in under a second, so there was no window in which to cancel one. Untested rather than unbuilt.

---

## E3.2 — Action Resolver v1 · `DONE`

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

**As built**

- The **whole ladder** is retried until a deadline, which is what gives it Playwright's auto-waiting behaviour: an element that has not rendered yet gets a chance to appear rather than failing the step instantly.
- Confidence is reduced when a match was ambiguous and visibility settled it. A unique match and a narrowed-down one are not the same result, and recording the difference is what lets Phase 5 spot decaying hints.
- An invalid selector kills the rung, not the run.

**Acceptance** — 13 tests against real Chromium

- [x] A step resolving via `ROLE_NAME` records that strategy, its candidate count, and its confidence.
- [x] Two visible "Save" buttons produce a **failure**, not a guess: `Could not uniquely identify …`. Picking one would be a coin flip that looks like a pass.
- [x] A disabled element is skipped in favour of the enabled one.
- [x] A stale stored selector is skipped and the ladder carries on.
- [x] An element that appears 700 ms late is still found.
- [x] A failure names what it looked for and every strategy it tried.
- [x] A step with no hints at all says so plainly instead of failing obscurely.

> **`getByRole` consults the accessibility tree, which already excludes hidden elements** — so a hidden element never even reaches the visibility filter. Only the raw strategies (CSS, text) can produce the "several matched, one visible" case. This cost a wrong test assumption to discover, and both behaviours now have their own test.

---

## E3.3 — Execution API · `DONE`

**Goal:** runs are startable, observable, and cancellable.

**Depends on:** E3.1, E3.2.

**Deliverables**

- `POST /executions` (spec version + environment + mode), `GET /executions/:id/events` (**SSE**), `POST /executions/:id/cancel`, plus list and detail.
- `ExecutionStep` and `Observation` rows written **as they happen** — a crashed run must still leave a readable timeline.
- A run queue that serializes executions in the MVP. Parallel workers are Phase 8; two headed browsers fighting over the same demo is worse than a wait.
- Status roll-up onto `Execution` from its steps.

**Files:** `apps/api/src/executions/**`

**Acceptance**

- [x] `POST /executions` returns an id immediately and queues the run, rather than holding an HTTP request open for its duration.
- [x] Steps and observations are written as they happen, so a crashed run still leaves a readable timeline.
- [x] Runs are serialized through a single promise chain — a second execution queues rather than launching a competing browser.
- [x] A spec with no version, or a version with no steps, is refused with a 400 before anything starts.
- [x] `totals` are computed from `LlmCall` rows on read; a Phase 3 run reports `llmCallCount: 0`, which is the point.
- [ ] Cancel producing a `CANCELLED` final status — see the note under E3.1; the path exists but no run lasted long enough to cancel.

---

## E3.4 — Evidence store · `DONE (retention deferred)`

**Goal:** artifacts are on disk, addressable, and portable.

**Depends on:** E3.1.

**Deliverables**

- The layout from [../architecture.md](../architecture.md): `data/evidence/<executionId>/{trace.zip,video.webm,step-<n>/…}`.
- `Artifact` rows holding **relative** paths, so the directory can be moved or zipped without rewriting the database.
- Read-only static serving at `/evidence`, with **path traversal rejected** — the id is validated against the database before any path is joined, and the resolved path is confirmed to sit inside `EVIDENCE_DIR`.
- A retention command to delete evidence for old executions, since traces and video are the bulk of disk use.

**Files:** `apps/api/src/evidence/**`

**Acceptance**

- [x] Every artifact row resolves to a file that exists and is fetchable over HTTP.
- [x] `GET /evidence/../../.env` is rejected, percent-encoded traversal included.
- [x] Paths are stored relative to `EVIDENCE_DIR`, so moving the tree keeps every artifact reachable.
- [x] Snapshots are served as `text/plain` with `nosniff` — they come from the application under test, and rendering one as HTML would run its scripts on our origin.
- [ ] **Retention command — not built.** Traces and video are the bulk of disk use and nothing prunes them yet. `EvidenceService.removeDir` exists as the primitive. Left undone rather than half-done; it belongs with E7.1's reporting work, where the question of what an old run is still worth becomes concrete.

---

## E3.5 — Run view · `DONE`

**Goal:** watch a run happen.

**Depends on:** E3.3, E3.4, E0.4.

**Deliverables**

- Live step timeline over SSE with status chips, per-step duration, and the resolution strategy used.
- Per-step evidence links; trace download.
- Run list with status and duration; re-run from a previous execution.

**Files:** `apps/web/src/app/executions/**`

**Acceptance**

- [x] Each step shows its status, action, **which rung of the ladder resolved it**, duration, screenshot, and links to its DOM, ARIA, network, and console evidence.
- [x] Whole-run evidence (trace, video) is one click away, next to the model-call count — which reads "no model calls" for a Phase 3 run.
- [x] Opening a finished run renders the full timeline from history; live step events merge over stored ones **by index**, so a running step updates in place instead of appearing twice.
- [x] `UNCERTAIN` has its own colour rather than being folded into pass or fail — it is a real outcome that needs a human, and Phase 4 will start producing it.
- [x] Verified in a real browser: a run started from the spec page passed all 5 steps, and its observations show the click actually produced the login redirect to `/dashboard?email=demo%40example.com`.
- [ ] Live updating observed in the browser — the run finished faster than the page could show it mid-flight. Same limitation as the recorder's live timeline.

---

## What Phase 3 deliberately does not do

A step here passes when its **action completed**, not when its outcome was correct. A click that lands on the right button and navigates nowhere useful is still a `PASS` at this stage. That is Phase 4's entire job, and separating them is what makes a Phase 5 failure diagnosable: the deterministic path is already known to work.
