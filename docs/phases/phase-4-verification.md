# Phase 4 — Verification

**Goal:** a run means something.

**Demo:** an intentionally broken step reports `FAIL` with the exact evidence that proves it.

Until this phase, a run reports only whether Playwright threw. That is not a test result — a click that lands on the wrong button and navigates nowhere is a green run. Verification is what turns execution into a verdict.

The ordering principle: **deterministic checks run always and decide most steps alone.** They are free, fast, and not subject to a model's opinion. The LLM is the fallback, not the default.

---

## E4.1 — Deterministic verifier · `DONE`

**Goal:** most steps get a verdict with no model call.

**Depends on:** E3.1, E3.3.

**Deliverables**

- One checker per `Expectation` kind (shapes in [../data-model.md](../data-model.md)):

  | Kind | Check |
  | --- | --- |
  | `URL` | exact / prefix / pattern match against the post-action URL |
  | `VISIBLE` / `NOT_VISIBLE` | resolve the description via the E3.2 ladder, assert visibility |
  | `TEXT` | text present, optionally scoped to a container |
  | `NETWORK_OK` | no request matching the pattern returned above `maxStatus` |
  | `NO_CONSOLE_ERRORS` | no `error`-level console messages during the step |

- Each check returns `PASS`, `FAIL`, or **`INCONCLUSIVE`** — the third value is what routes a step to E4.2. A checker that cannot evaluate its own expectation must say so rather than guess.
- Every verdict carries a rationale naming the concrete observation behind it ("URL was `/login?error=1`, expected prefix `/dashboard`"), because a `FAIL` a human cannot act on is not much better than a green run.
- Console-error checking needs a per-application allowlist — real apps log noise, and a verifier that cries wolf gets ignored.

**Files:** `apps/api/src/verifier/{deterministic/**,verifier.service.ts}`

**Acceptance**

- [x] `checkUrl`, `checkNetwork`, `checkConsole`, and `rollUp` are pure functions of what was observed, unit-tested without a browser (18 tests).
- [x] A false expectation produces `FAIL` naming the actual value: *"Expected the URL to prefix "/dashboard", but it was "/login?error=1"."*
- [x] **"No evidence of failure" is not "evidence of success."** A `NETWORK_OK` check that matched no requests returns `INCONCLUSIVE` and escalates, rather than passing by default.
- [x] Allowlisted console noise does not fail a step.
- [x] A relative URL expectation is compared against the path, so a spec written against `localhost:4321` still means something on staging.
- [x] An unparseable regex fails the check instead of crashing the run.

---

## E4.2 — Semantic verifier · `DONE (real model unverified)`

**Goal:** judgment calls that the DOM cannot settle.

**Depends on:** E4.1, E2.4's minimal LLM client.

**Deliverables**

- Runs **only** on `INCONCLUSIVE`, or on an expectation of kind `SEMANTIC`.
- Input: the step's `intent`, its expectation, the pruned a11y snapshot, the URL, and any console errors. Not the raw DOM — a 500KB HTML blob is both expensive and worse signal than the accessibility tree.
- Output validated against a zod schema: `{ status: PASS | FAIL | UNCERTAIN, rationale, evidenceRefs }`.
- The model is instructed to return `UNCERTAIN` rather than guess — a confident wrong verdict is the expensive failure mode here, and an `UNCERTAIN` surfaced to a human costs a click.
- Logged as an `LlmCall` with its prompt id and version, linked to the execution.

**Files:** `apps/api/src/verifier/semantic/**`, `apps/api/src/llm/prompts/verify.ts`

**Acceptance** — model stubbed, so what is proven is the *routing*

- [x] A `SEMANTIC` expectation reaches the model and its rationale is stored on the step.
- [x] A step decided deterministically makes **zero** model calls — asserted by counting calls, not by inspection.
- [x] A `VISIBLE` expectation with no targeting hints escalates rather than guessing.
- [x] **An unreachable model does not become a `PASS`.** The step stays `UNCERTAIN` and the run reports `UNCERTAIN` — the failure mode that matters most here, since a broken verifier that reports green is worse than no verifier.
- [x] Prompt input is capped: the ARIA snapshot is truncated at 6000 characters and redacted before it leaves.
- [x] **A real model returning a sensible verdict on a real page — VERIFIED.** Running the compiled spec against the demo app: 7/7 passed, **6 steps decided deterministically at zero cost**, and exactly one escalated. Its rationale: *"The accessibility snapshot shows the combobox "Account type" with option "Business" marked as [selected], confirming the Business account type was chosen as intended."* — grounded in the snapshot, as the prompt demands. One call, 1330 in / 155 out.
- [x] **The escalation path proved itself on an unplanned input.** That step escalated because the compiler had emitted `scope: 'form "Sign in"'` — not a valid CSS selector. `checkText` caught the throw and returned `INCONCLUSIVE` instead of crashing the run, which is exactly the degradation the three-state design exists for: a checker that cannot evaluate its own expectation hands over rather than guessing.

> The prompt's most important instruction is the licence to answer `UNCERTAIN`: a confident wrong verdict is the expensive failure, while an `UNCERTAIN` costs a human one glance.

---

## E4.3 — Three-state results · `DONE`

**Goal:** `UNCERTAIN` is a first-class outcome, not a rounding error.

**Depends on:** E4.1, E4.2.

**Deliverables**

- `StepStatus` on every `ExecutionStep`, rolled up to `ExecutionStatus` with explicit rules:
  - any `FAIL` on a non-optional step → run `FAILED`
  - no `FAIL`, at least one `UNCERTAIN` → run `UNCERTAIN`
  - otherwise → `PASSED`
- `UNCERTAIN` steps queue for human adjudication; the human's call is recorded and feeds knowledge in Phase 7.
- Optional steps (`TestStep.optional`) can fail without failing the run, but are still surfaced.

**Acceptance**

- [x] An `UNCERTAIN` step never silently becomes a `PASS` — asserted at the unit level and end to end.
- [x] Roll-up is a pure function, unit-tested across the combinations that matter: a known failure outranks an open question, and an **uncertain optional** step still makes the run uncertain. Optional means "need not succeed", not "need not be looked at".
- [x] A failing optional step leaves the run green but visible.
- [x] **`UNCERTAIN` does not stop the run**, unlike a failure: the remaining steps may still produce useful evidence, and the question is for a human afterwards.
- [x] Adjudication settles an open question and recomputes the run status; the verifier's original doubt and the human's decision are both kept on the record.
- [x] Adjudicating an already-decided step is refused with a 400 — this resolves questions, it is not an override switch.

---

## E4.4 — Evidence viewer · `DONE`

**Goal:** the human can check the verdict for themselves.

**Depends on:** E4.3, E3.4, E3.5.

**Deliverables**

- Per-step panel: screenshot, DOM snapshot, network table, console panel, verifier rationale, resolution strategy.
- Trace download; jump from a step to its position in the trace.
- Adjudication control on `UNCERTAIN` steps.

**Files:** `apps/web/src/app/executions/[id]/**`

**Acceptance**

- [x] Every step's evidence is one click from the run view; the trace and video are at the top.
- [x] The rationale renders inline on the step, next to the evidence it cites — a verdict you have to go hunting to understand is one people stop reading.
- [x] Failed requests and console errors are surfaced **inline** rather than only inside a downloadable file, so the reason for a `FAIL` is visible without opening anything.
- [x] An `UNCERTAIN` step shows "The verifier could not settle this. Your call:" with Passed/Failed controls, and adjudicating updates the run roll-up.
- [ ] A dedicated full-page evidence viewer (side-by-side DOM/network/console panels) — not built. The inline summary plus per-artifact links covers the diagnosis path; a richer viewer earns its keep in Phase 6, where a human reviews a proposed heal against before/after evidence.
