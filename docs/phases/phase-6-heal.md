# Phase 6 — Diagnose, heal, reverify

**Goal:** close the loop the whole architecture is built around.

**Demo:** move a form field — the run self-heals and the change lands in a review queue. Break the app's logic instead — it files a bug rather than healing over it.

That asymmetry is the entire point of this phase. A tool that heals every failure is a tool that reports green while the application is broken. **The system heals its own drift; it never heals over a real defect.**

---

## E6.1 — Diagnoser · `TODO`

**Goal:** classify *why* a step failed.

**Depends on:** E4.3, E5.2.

**Deliverables**

- Triggered on `FAIL`. Input bundle: the failing step, its observations, the steps that passed before it, the spec's intent, and the application's knowledge.
- Output, zod-validated: `{ diagnosis, confidence, rationale }` over `APP_BUG | TEST_DRIFT | ENVIRONMENT | FLAKE | UNKNOWN`.
- Signals that separate the classes, gathered before the model is asked:

  | Class | Typical signal |
  | --- | --- |
  | `TEST_DRIFT` | target unresolvable, but the page is healthy and an equivalent control exists |
  | `APP_BUG` | target resolved and acted on, but the outcome is wrong; 5xx responses; console exceptions |
  | `ENVIRONMENT` | navigation failure, DNS, auth rejected at the boundary, 4xx on load |
  | `FLAKE` | timing-dependent, and a retry passes |

- `FLAKE` is only ever concluded **after** a retry actually passes — otherwise it is an excuse that hides real failures.
- `UNKNOWN` is a valid answer and routes to a human. A forced classification is worse than an honest one.

**Files:** `apps/api/src/agent/diagnoser/**`, `apps/api/src/llm/prompts/diagnose.ts`

**Acceptance**

- [ ] A renamed control classifies as `TEST_DRIFT`.
- [ ] A 500 on submit classifies as `APP_BUG`, not drift.
- [ ] An unreachable base URL classifies as `ENVIRONMENT` before the model is called at all.
- [ ] `FLAKE` is never returned without a passing retry as evidence.
- [ ] Every diagnosis carries a rationale citing the observation behind it.

---

## E6.2 — Healer · `TODO`

**Goal:** fix drift in-run, and prove the fix.

**Depends on:** E6.1, E5.3.

**Deliverables**

- Runs **only** on `TEST_DRIFT` — never on `APP_BUG`. This gate is the safety property of the whole phase and belongs in code, not in a prompt.
- Proposes a corrected `targetDescription` / `targetHints`, or a corrected step, with a rationale.
- Writes a `HealingRecord` (`PROPOSED`), applies it in-run, and **reverifies** through the Phase 4 verifier.
- Reverify passes → status `APPLIED`, step status `HEALED`, record queued for human approval. Reverify fails → `REVERIFY_FAILED`, run fails. **Not retried blindly** — a healer allowed to keep guessing will eventually find something that passes for the wrong reason.
- One heal attempt per step per run, enforced by the orchestrator's budget.

**Files:** `apps/api/src/agent/healer/**`, `apps/api/src/llm/prompts/heal.ts`

**Acceptance**

- [ ] A moved field heals, reverifies, and the run completes with the step marked `HEALED`.
- [ ] A heal whose reverify fails is recorded as `REVERIFY_FAILED` and does not retry.
- [ ] A step diagnosed `APP_BUG` is never sent to the healer — asserted by a test, not by inspection.
- [ ] The healed run's evidence shows both the original failure and the post-heal state.

---

## E6.3 — Healing review queue · `TODO`

**Goal:** a human decides what enters a spec.

**Depends on:** E6.2, E2.5.

**Deliverables**

- Queue of `PROPOSED` / `APPLIED` healings with the original target, the proposed target, the rationale, and before/after evidence.
- Approve → writes a **new `TestVersion`** with `source: HEALED` and a note. Reject → `REJECTED`, the spec is untouched.
- Specs are never mutated in place, so every automated change to a test is attributable and reversible.
- Bulk approve for a run that healed several steps for the same reason.

**Files:** `apps/web/src/app/healings/**`, `apps/api/src/healings/**`

**Acceptance**

- [ ] Approving produces version N+1 with `source: HEALED` and leaves N byte-identical.
- [ ] Rejecting leaves the spec unchanged and the next run fails the same way.
- [ ] Each queue entry shows the before/after screenshots side by side.
- [ ] An approved healing links to the execution that produced it.

---

## E6.4 — Bug reports · `TODO`

**Goal:** an application defect produces something a developer can act on.

**Depends on:** E6.1.

**Deliverables**

- Generated on `APP_BUG`: title, severity, summary, ordered reproduction steps, expected vs actual, evidence refs.
- Reproduction steps come from the **actual executed steps**, not the model's recollection — the model writes prose around a real step list.
- Severity from concrete signals (5xx, data loss, blocked flow) rather than vibes.
- Dedupe: the same defect recurring across runs updates the existing open report instead of filing a new one.
- Web view with evidence inline and copy-as-Markdown for pasting into an issue tracker.

**Files:** `apps/api/src/bugs/**`, `apps/web/src/app/bugs/**`

**Acceptance**

- [ ] A seeded application defect produces a report a developer could act on unchanged.
- [ ] Reproduction steps match the executed steps exactly.
- [ ] Re-running the same broken flow updates the existing report rather than filing a duplicate.
- [ ] Evidence links resolve from the report view.
