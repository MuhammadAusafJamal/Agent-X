# Phase 4 — Verification

**Goal:** a run means something.

**Demo:** an intentionally broken step reports `FAIL` with the exact evidence that proves it.

Until this phase, a run reports only whether Playwright threw. That is not a test result — a click that lands on the wrong button and navigates nowhere is a green run. Verification is what turns execution into a verdict.

The ordering principle: **deterministic checks run always and decide most steps alone.** They are free, fast, and not subject to a model's opinion. The LLM is the fallback, not the default.

---

## E4.1 — Deterministic verifier · `TODO`

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

- [ ] Each checker is unit-tested as a pure function against fixture observations.
- [ ] A false expectation produces `FAIL` naming the actual value.
- [ ] An unevaluatable expectation returns `INCONCLUSIVE`, never a default `PASS`.
- [ ] Allowlisted console noise does not fail a step.

---

## E4.2 — Semantic verifier · `TODO`

**Goal:** judgment calls that the DOM cannot settle.

**Depends on:** E4.1, E2.4's minimal LLM client.

**Deliverables**

- Runs **only** on `INCONCLUSIVE`, or on an expectation of kind `SEMANTIC`.
- Input: the step's `intent`, its expectation, the pruned a11y snapshot, the URL, and any console errors. Not the raw DOM — a 500KB HTML blob is both expensive and worse signal than the accessibility tree.
- Output validated against a zod schema: `{ status: PASS | FAIL | UNCERTAIN, rationale, evidenceRefs }`.
- The model is instructed to return `UNCERTAIN` rather than guess — a confident wrong verdict is the expensive failure mode here, and an `UNCERTAIN` surfaced to a human costs a click.
- Logged as an `LlmCall` with its prompt id and version, linked to the execution.

**Files:** `apps/api/src/verifier/semantic/**`, `apps/api/src/llm/prompts/verify.ts`

**Acceptance**

- [ ] A semantic expectation ("the order confirmation shows the right total") returns a verdict with a rationale.
- [ ] An ambiguous page returns `UNCERTAIN` rather than a coin-flip `PASS`.
- [ ] A step decided deterministically makes **zero** model calls — verified by the `LlmCall` count on the execution.
- [ ] Prompt input stays within a sane token budget on a large page.

---

## E4.3 — Three-state results · `TODO`

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

- [ ] An `UNCERTAIN` step never silently becomes a `PASS`.
- [ ] Roll-up rules are unit-tested against every combination.
- [ ] A failing optional step leaves the run green but visible.

---

## E4.4 — Evidence viewer · `TODO`

**Goal:** the human can check the verdict for themselves.

**Depends on:** E4.3, E3.4, E3.5.

**Deliverables**

- Per-step panel: screenshot, DOM snapshot, network table, console panel, verifier rationale, resolution strategy.
- Trace download; jump from a step to its position in the trace.
- Adjudication control on `UNCERTAIN` steps.

**Files:** `apps/web/src/app/executions/[id]/**`

**Acceptance**

- [ ] Every step's evidence is reachable in two clicks from the run view.
- [ ] The rationale is shown next to the evidence it cites, not on a separate screen.
- [ ] Adjudicating an `UNCERTAIN` step updates the run roll-up.
