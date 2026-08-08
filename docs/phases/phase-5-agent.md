# Phase 5 — Agent orchestrator

**Goal:** the intelligence layer, on top of a runner that already works without it.

**Demo:** rename a button in the target app; the agent still finds it by intent, and remembers the new name.

Everything before this phase was deliberately mechanical. This is where the tool stops replaying and starts reasoning — and it lands on foundations that already work, so a failure here is unambiguously a reasoning failure.

> Phase 5's demo needs the deliberately-breakable example app from **E7.4**. Pull that epic forward if this demo is needed on schedule.

---

## E5.1 — LLM module · `TODO`

**Goal:** one auditable path to the model.

**Depends on:** E2.4 (which builds the minimal version of this).

**Deliverables**

- An Anthropic wrapper over `@anthropic-ai/sdk`: one provider, model from `ANTHROPIC_MODEL`.
- Structured output helper — every call passes a zod schema and gets a parsed value back. One retry on validation failure with the error fed back to the model, then a hard error. **Never** a partial parse.
- Retry with backoff on transient API errors, distinguished from validation failures.
- A **prompt registry**: versioned prompt ids, not inline string literals. Each call records `promptId` + `promptVersion`.
- `LlmCall` audit rows: tokens, latency, cost, ok/error, linked to the execution or recording that caused it.
- Redaction: credential values and anything from E1.3 are stripped from prompt payloads before the call.

**Files:** `apps/api/src/llm/{llm.service.ts,structured.ts,prompts/**}`

**Acceptance**

- [ ] Every model call in the codebase goes through this service — no direct SDK use elsewhere.
- [ ] A schema-violating response retries once with the error, then fails loudly.
- [ ] An execution's `LlmCall` rows reconstruct which prompt version produced which decision.
- [ ] Token and cost totals appear on the execution.
- [ ] No credential value appears in any logged prompt.

---

## E5.2 — Orchestrator · `PARTLY DONE`

**What exists:** the per-step loop (resolve → act → observe → verify → branch) lives in `RunnerService` and was built in Phase 3. Budget guards are in: a per-run ceiling on model calls, counted from the `LlmCall` audit rows so the resolver and verifier share one allowance, and exceeding it degrades the run to deterministic-only rather than ending it. Cancellation is checked at every step boundary.

**What does not exist yet:** a separate `Planner`/`Explorer` seam. The loop is a straight walk through the spec's steps, which is all `REPLAY` mode needs. `EXPLORE` mode (E7.3) is what will require a planner that decides the *next* step rather than reading it, and the honest thing is to build that seam when there is a second caller for it rather than guessing its shape now.

**Context building** is likewise minimal — knowledge is looked up per step by key rather than assembled into a relevance-ranked prompt block. That becomes necessary when the diagnoser and healer need application context in Phase 6.


**Goal:** the per-step loop, with guardrails.

**Depends on:** E5.1, E3.3, E4.3.

**Deliverables**

- The loop: build context → resolve → act → observe → verify → branch.
- Context builder: step intent + relevant application knowledge + current observation. Relevance-filtered, not the whole knowledge table — context bloat is what makes per-step calls slow and expensive.
- **Budget guards**: max LLM calls per run, max retries per step, max run duration. Exceeding a budget ends the run as `ERROR` with a clear reason rather than burning tokens.
- Cancellation checked at every boundary.
- SSE event emission for every transition.
- Sub-agent seams for `Planner`, `Explorer`, `Diagnoser`, and `Healer` — Phases 6 and 7 plug into these rather than restructuring the loop.

**Files:** `apps/api/src/agent/{orchestrator.service.ts,context-builder.ts,budget.ts}`

**Acceptance**

- [ ] A run that would exceed its LLM budget stops and says so.
- [ ] Cancellation is honoured within one step.
- [ ] A deterministic run (all steps resolve on rungs 1–5, all verify deterministically) makes zero model calls — the agent layer adds no cost when it adds no value.
- [ ] Loop state is unit-tested with a stubbed browser and stubbed LLM.

---

## E5.3 — Action Resolver v2 · `DONE`

**Goal:** the LLM rung of the ladder.

**Depends on:** E5.1, E5.2, E3.2.

**Deliverables**

- Triggered only when rungs 1–5 return zero or multiple matches.
- Input: the pruned a11y snapshot with **stable element handles**, plus `targetDescription`, `intent`, and relevant knowledge. Output: a chosen handle + rationale + confidence, zod-validated.
- The snapshot is pruned to interactive and labelled elements — sending the whole tree is slow, expensive, and a worse signal.
- A chosen handle that no longer resolves (the page moved on) is a resolution failure, not a retry loop.
- Every successful LLM resolution writes a `SELECTOR_MEMORY` knowledge entry, so the second run takes rung 1 instead.

**Files:** `apps/api/src/resolver/strategies/llm.strategy.ts`, `apps/api/src/llm/prompts/resolve.ts`

**As built — the model never produces a selector**

It answers with a **role and an accessible name**, the way a person would name the control, and that answer goes back through the same "exactly one visible, enabled element" rule as every other rung. A model that names something ambiguous or imaginary fails the step rather than steering a click.

It is also gated behind an explicit `llm` option. The verifier resolves elements too, and a visibility check quietly costing a model call per step is how a "deterministic" run acquires a bill.

**Acceptance** — verified against the live model by hand, and pinned by 10 stubbed tests

- [x] A renamed button (label **and** test id changed) resolves via `LLM` and the step passes.
- [x] The next run resolves the same target via `KNOWLEDGE` and spends no resolution call.
- [x] `found: false` fails the step and keeps the model's reason in `attempted`.
- [x] An invented element is refused — the uniqueness rule catches it.
- [x] An ambiguous choice (two "Save" buttons) is refused rather than picked.
- [x] The model is asked **at most once per step**, however long the ladder retried, and never without permission.
- [x] An unreachable model degrades the run to deterministic-only instead of crashing it.
- [x] `resolutionStrategy` is recorded as `LLM` with a confidence below every deterministic rung, so a decaying spec is visible in run history.

**Live run, for the record** (claude-sonnet-5): baseline PASSED with 1 model call; after the rename, PASSED with 2 (`LLM` → `role=button[name="Continue"]`); immediately again, PASSED with 1, step 5 via `KNOWLEDGE`.

---

## E5.4 — Application knowledge · `DONE`

**Goal:** the system gets better at an application the more it runs against it.

**Depends on:** E5.3.

**Deliverables**

- Read/write over `KnowledgeItem` for all four kinds: `ELEMENT_ALIAS`, `SELECTOR_MEMORY`, `FLOW`, `DOMAIN_FACT`.
- Confidence model: rises on hit, decays on miss and with age. Entries below a floor stop being injected into prompts and stop being trusted at rung 1 — **stale knowledge is worse than none**, because it sends the resolver confidently at the wrong element.
- Scoped strictly per `Application`; no cross-application bleed.
- Relevance selection for the context builder, so prompts carry the handful of entries that matter.

**Files:** `apps/api/src/knowledge/**`

**Keyed by intent, not by row id.** A saved spec edit writes a new version with new step ids, and knowledge keyed by id would be thrown away on every edit. Keyed by the step's description, what was learned about "the primary submit button in the login form" survives.

**Acceptance**

- [x] Repeated success raises confidence (0.80 after five hits, observed); a miss drops it sharply, and age decay is applied on read so nothing needs a background job to expire.
- [x] A below-floor entry is skipped at rung 1 rather than tried and failed.
- [x] Knowledge is scoped per application by a unique constraint; nothing crosses between them.
- [x] The confidence math is pure and unit-tested, including the asymmetry — it takes three hits to undo one miss.

**Three bugs the live demo exposed, which the design had not anticipated:**

1. **The `TEXT` rung ignored the recorded role**, so a step meant for the "Sign in" *button* uniquely matched the `<h1>Sign in</h1>` and clicked it. The uniqueness rule waved it through — one visible match — and the run failed later for a reason pointing nowhere near the cause. `TEXT` is now constrained by role when one was recorded.
2. **That wrong match was then remembered**, and rung 1 replayed it confidently on the next run. Exactly the "stale knowledge is worse than none" failure this file warns about, arriving through a door nobody had watched. `TEXT` results are no longer written to knowledge at all.
3. **A step that resolved *from memory* and then failed verification did not penalise that memory**, because resolution had "succeeded". It does now — which is what makes the system recover on its own instead of needing the row deleted by hand, as it did here.

`TEST_ID` also recorded `testid=x` as its selector — a label rather than something `page.locator()` can parse. Harmless until that string is remembered and fed back.

---

## E5.5 — Knowledge viewer · `DONE`

**Goal:** what the system has learned is inspectable and correctable.

**Depends on:** E5.4, E0.4.

**Deliverables**

- Browse and search knowledge per application, with kind, key, confidence, hit/miss counts, and last-seen.
- Manual correction and deletion — a wrong learned fact must be removable without a database client.
- Provenance: which execution taught it this.

**Files:** `apps/web/src/app/knowledge/**`

**Acceptance**

- [x] Every entry shows its key, remembered selector, hit and miss counts, and when it was last confirmed.
- [x] **Confidence is shown as it will actually be used**, age decay already applied. An entry reading 0.8 that is about to be ignored is worse than no number at all; below the floor it is labelled "not trusted".
- [x] A wrong learned fact is removable from the UI — "Forget" — without reaching for a database client, and takes effect on the next run.
- [x] Verified in a browser against the demo's own knowledge, where the last row *is* the phase demo: `click.the-sign-in-button-in-the-sign-in-form` → `role=button[name="Continue"]`. The key still names the intent; what it remembers has moved.
- [ ] **Editing** an entry's value — not built. Forgetting covers the case that matters (a wrong fact), and a hand-edited selector is a thing the agent would immediately overwrite on its next successful resolution anyway.
