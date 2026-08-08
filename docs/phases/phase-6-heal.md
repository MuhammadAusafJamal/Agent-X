# Phase 6 — Diagnose, heal, reverify

**Goal:** close the loop the whole architecture is built around.

**Demo:** move a form field — the run self-heals and the change lands in a review queue. Break the app's logic instead — it files a bug rather than healing over it.

That asymmetry is the entire point of this phase. A tool that heals every failure is a tool that reports green while the application is broken. **The system heals its own drift; it never heals over a real defect.**

---

## Why a healer at all, when the resolver already has an LLM rung

This was the load-bearing question of the phase, and it is worth stating before the epics, because the answer shapes all four.

The resolver's LLM rung (E5.3) and the healer look like they do the same job. They do not, and the difference is **lifetime**:

| | Resolver's LLM rung | Healer |
| --- | --- | --- |
| Fixes | this run | the specification |
| Writes | a `SELECTOR_MEMORY`, which decays | a new `TestVersion`, which does not |
| Approved by | nobody | a human |
| Vocabulary | a role and a name | full `TargetHints`, including a **landmark** |

A rename rescued by the resolver leaves the spec still carrying hints that match nothing. Knowledge papers over it at rung 1, but knowledge decays, is scoped to one application, and is invisible in the test. The **specification is still wrong**, and will need a model call on every future run until someone fixes it. One saves the run; the other saves the test.

The vocabulary difference is what lets the healer succeed where the rung structurally cannot. The rung answers with a role and a name, and that answer faces the same "exactly one visible, enabled element" rule as every other rung — so a page with two `Continue` buttons is a target it must *refuse*. A landmark is the one hint that can **resolve** an ambiguity rather than merely detect it, and only the healer can propose one.

That gap turned out to be a real hole: the recorder had been capturing `landmark` since Phase 2 and the resolver ignored it entirely. Closing it is part of this phase.

---

## E6.1 — Diagnoser · `DONE`

**Goal:** classify *why* a step failed.

**Files:** `apps/api/src/agent/diagnoser/{signals.ts,diagnoser.service.ts}`, `apps/api/src/llm/prompts/diagnose-failure.prompt.ts`

**As built**

Signal collection and the classifications that follow from it are a **pure function** (`signals.ts`), and the model is asked only what is left over. A 500, a refused page load, and an unreachable host are all settled from a status code — instantly, free, and unit-tested without a browser.

The ordering inside `classifyDeterministically` is not by confidence but **by consequence**. A server error outranks an unresolvable target even when both are present, because the expensive mistake in this system runs one way: heal a step whose real problem was a broken server and you have manufactured a green run over a broken application. Refusing to heal something that turns out to be drift merely wastes a review.

**`FLAKE` is unreachable from the model by construction, not by instruction.** `modelDiagnosisSchema` is the diagnosis enum with `FLAKE` excluded, so the tool schema the model is handed cannot express it. It means "this passes sometimes", the only evidence for it is a retry that passed, and a model offered the option reaches for it whenever a failure looks timing-shaped. A QA tool able to explain away its own failures is worth nothing.

The runner concludes `FLAKE` itself, from **one reverification after a settle** — and it never re-runs the action. Re-running an action that already took effect is how a test framework charges a card twice. That means a flaky *resolution* is not detected as flake; only a flaky *outcome* is. That is the deliberate side of the trade.

**Acceptance**

- [x] A 500 on submit classifies as `APP_BUG`, not drift — settled deterministically, with the model never asked (`signals.spec.ts`, and asserted end to end in `heal-run.e2e-spec.ts`).
- [x] An unreachable base URL classifies as `ENVIRONMENT` before the model is called at all.
- [x] `FLAKE` is never returned without a passing retry as evidence — the schema handed to the model cannot express it, which is asserted directly.
- [x] Every deterministic diagnosis carries a rationale quoting the observation behind it — the method, URL, and status that produced it.
- [x] A step's diagnosis and its rationale are stored on the `ExecutionStep` and shown next to the evidence on the run view. A classification nobody can audit is one people learn to ignore.
- [x] **A renamed control classifies as `TEST_DRIFT`** — verified against `claude-sonnet-5` in Phase 7: a redesigned form whose submit button was renamed and duplicated was classified `TEST_DRIFT`, healed with a landmark, and reverified. See [phase 7](phase-7-reports.md#verified-against-the-live-model).

---

## E6.2 — Healer · `DONE`

**Goal:** fix drift in-run, and prove the fix.

**Files:** `apps/api/src/agent/healer/healer.service.ts`, `apps/api/src/llm/prompts/heal-step.prompt.ts`

**As built**

Two properties carry this file:

**The `TEST_DRIFT` gate is code.** `propose()` returns early on any other classification, before the page is read and before a token is spent. A prompt asking a model to be careful is not a control; an early return is. `healer.service.spec.ts` asserts the refusal for all four other classifications *and* asserts that `TEST_DRIFT` does reach the model — otherwise the test would pass just as well against a service that was simply broken.

**A proposal is resolved before it is written down.** The model names a role, a name, and usually a landmark; those go back through the resolver — deliberately with **no `llm` option**, because a proposal that needs the model to find it is not a repair, it is the same problem written down again. A proposal that cannot be uniquely resolved is recorded as `REVERIFY_FAILED` and never enters the queue.

The split between `propose()` and `settle()` exists because the healer has no business acting on a page. The runner re-runs the action against the proposed target, reverifies through the Phase 4 verifier, and hands back the verdict. `UNCERTAIN` is not proof: only `PASS` settles a heal as `APPLIED`.

**A second, cheaper trigger.** A step that **passed** via the `LLM` rung is drift by definition — the recorded hints resolved nothing and the model found the control from its description. The runner queues a repair for it directly from `ResolutionSuccess.learnedHints`, with **no second model call**, already marked `APPLIED`/`PASS` because the step demonstrably ran against that target and verified. It is the safest kind of heal there is and the one the rename demo produces.

`TEXT` and `CSS` wins are deliberately *not* treated this way. Those rungs used the spec's own hints, so there is nothing new to propose.

**Acceptance**

- [x] A drifted step heals, reverifies, and the run completes with the step marked `HEALED`, and the run itself `PASSED`.
- [x] The healed step records the scoped selector that worked — `role=form[name="Account access"] >> role=button[name="Continue"]` — which the resolver's own rung could not produce.
- [x] A heal whose reverify fails is recorded as `REVERIFY_FAILED`, leaves the step failed, is asked exactly once, and never reaches the queue.
- [x] A step diagnosed `APP_BUG` is never sent to the healer — asserted by a unit test on the gate and again end to end, where the heal prompt is never invoked.
- [x] A change no re-targeting can express (a field moved behind a new page) is **declined**, with the model's reason kept on the step and nothing queued.
- [x] The healed run's evidence shows both the original failure and the post-heal state — two screenshots, `shot.jpg` then `healed-shot.jpg`.
- [x] One heal attempt per step per run, and none at all once the run's model budget is spent.

---

## E6.3 — Healing review queue · `DONE`

**Goal:** a human decides what enters a spec.

**Files:** `apps/api/src/healings/**`, `apps/web/src/app/healings/**`

**As built**

Approval routes through `SpecsService.createVersion`, which is the only thing that writes a version, so immutability is inherited rather than re-implemented. A batch of heals from one run lands in **one** new version: approving four repairs one at a time would write four versions, three of which nobody ever ran, and the spec's history would record a migration that never happened that way.

The queue defaults to `PROPOSED` and `APPLIED` only. A heal that could not prove itself is visible on its run, not in a list of things asking for a decision.

**Acceptance**

- [x] Approving produces version N+1 with `source: HEALED` and a note, and version N compares byte-identical to what it was before.
- [x] Steps the heal did not touch are carried across unchanged.
- [x] Rejecting leaves the specification untouched — asserted by comparing the version and counting that no new one appeared — so the next run fails the same way. That is the point of rejecting, not a shortcoming of it.
- [x] An approved healing links to both the execution that produced it and the version it produced.
- [x] Reviewing the same healing twice is refused rather than silently writing a second version.
- [x] Bulk approve for a run that healed several steps for the same reason.
- [x] Each queue entry shows the original target against the proposed one, the rationale, and the before/after screenshots side by side. The API resolves those paths; the layout has not been checked in a browser.

---

## E6.4 — Bug reports · `DONE`

**Goal:** an application defect produces something a developer can act on.

**Files:** `apps/api/src/bugs/**`, `apps/web/src/app/bugs/**`

**As built**

Two things are kept away from the model on purpose.

**Reproduction steps are the steps that actually executed**, passed down from the runner. A model asked to recall a sequence it was merely told about produces a plausible one, and a reproduction that does not reproduce costs a developer an afternoon and teaches them to distrust the tool.

**Severity is computed** (`severity.ts`) from concrete signals — a server error, whether the flow was blocked, whether the step was optional. A model grading its own findings grades on how alarming they read; everything becomes HIGH and the field stops telling anyone what to look at first.

Dedupe is a `fingerprint` column: the spec, the step index, and the signal, with record ids, query strings, and hosts normalized out. `/invoices/8891` and `/invoices/8892` are one endpoint failing twice. A recurrence raises `occurrences` and `lastSeenAt` and **does not rewrite the report a developer is already reading** — nor spend a model call. Dedupe is scoped to reports that are still `OPEN`, so a defect that returns after someone closed it is news again.

If the model is unreachable or out of budget, the report is still filed from a plain evidence-only write-up. A defect going unrecorded because a model was unavailable is the one outcome this phase cannot allow.

**Acceptance**

- [x] A seeded application defect produces a report with a title, summary, expected, actual, severity, and evidence.
- [x] Reproduction steps match the executed steps exactly.
- [x] Re-running the same broken flow updates the existing report rather than filing a duplicate, and costs no model call.
- [x] A different defect in the same run files its own report.
- [x] Severity comes from the evidence — a 500 that blocked the flow is `CRITICAL`, an optional step is `LOW` however loud the failure.
- [x] A report is still filed when the model cannot be reached.
- [x] Evidence ids captured at the moment of failure resolve to paths on the report; acknowledging or dismissing never deletes a report.

---

## What this phase changed elsewhere

**The resolver now scopes to a landmark** (`ROLE_NAME`, `TEST_ID`, `TEXT`, `CSS`, and the model's own answer). Each rung tries scoped first and then the whole page, so a landmark that has itself been redesigned away narrows nothing rather than failing the step. Scoped matches are recorded as chained Playwright selectors — `role=dialog[name="Preferences"] >> role=button[name="Save"]` — so they remain something `page.locator()` can parse, remember, and replay at rung 1. Anything unparseable as a landmark is ignored rather than treated as an error.

**A failing run now costs one model call for the diagnosis.** Phase 4's property was "a deterministic run makes zero model calls"; it should now be read as **a run whose steps all pass deterministically makes zero model calls**. A failure buys an explanation. The two Phase 4 tests that asserted the old wording now count calls *per prompt*, so they still pin what they were written to pin — that the verifier decided without help.

**The demo app gained `BREAK_REDESIGN`** — the submit renamed, the form relabelled, and a consent banner adding a second `Continue`. Each change alone is survivable; together the model can still name the control but the name is no longer unique and the recorded landmark no longer narrows it, so the ladder correctly refuses. It is the case only a landmark-bearing proposal resolves. `BREAK_MOVE_FIELD` is now the *decline* demo: a field behind a new page is a structural change no re-target expresses.

## Not built

- **A version diff view.** Deferred from E2.5 and expected to land here. The queue shows the original target against the proposed one, which is the diff that matters for a heal, but comparing two whole versions still means reading two pages.
- **Evidence retention.** Still unbuilt, and now growing faster: a healed step writes a second screenshot.
- **`ENVIRONMENT` and `UNKNOWN` have no destination.** They are recorded on the step and shown on the run, but nothing routes them anywhere a person would look, the way drift has a queue and a defect has a tracker.
- ~~**Live-model verification.**~~ Closed in Phase 7: the diagnose → heal → reverify → approve → cheaper-rerun loop was run by hand against `claude-sonnet-5`. Every Phase 6 *test* still stubs the model, which is the right place for a test to sit — the live run is recorded in [phase 7](phase-7-reports.md#verified-against-the-live-model).
