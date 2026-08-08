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

## E5.2 — Orchestrator · `TODO`

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

## E5.3 — Action Resolver v2 · `TODO`

**Goal:** the LLM rung of the ladder.

**Depends on:** E5.1, E5.2, E3.2.

**Deliverables**

- Triggered only when rungs 1–5 return zero or multiple matches.
- Input: the pruned a11y snapshot with **stable element handles**, plus `targetDescription`, `intent`, and relevant knowledge. Output: a chosen handle + rationale + confidence, zod-validated.
- The snapshot is pruned to interactive and labelled elements — sending the whole tree is slow, expensive, and a worse signal.
- A chosen handle that no longer resolves (the page moved on) is a resolution failure, not a retry loop.
- Every successful LLM resolution writes a `SELECTOR_MEMORY` knowledge entry, so the second run takes rung 1 instead.

**Files:** `apps/api/src/resolver/strategies/llm.strategy.ts`, `apps/api/src/llm/prompts/resolve.ts`

**Acceptance**

- [ ] A renamed button (hints stale, description still true) resolves via `LLM` and the step passes.
- [ ] The **next** run of the same spec resolves the same target via `KNOWLEDGE` and makes no model call.
- [ ] An impossible target fails with a rationale rather than picking something plausible.
- [ ] `resolutionStrategy` is recorded as `LLM` so the drift is visible in the run history.

---

## E5.4 — Application knowledge · `TODO`

**Goal:** the system gets better at an application the more it runs against it.

**Depends on:** E5.3.

**Deliverables**

- Read/write over `KnowledgeItem` for all four kinds: `ELEMENT_ALIAS`, `SELECTOR_MEMORY`, `FLOW`, `DOMAIN_FACT`.
- Confidence model: rises on hit, decays on miss and with age. Entries below a floor stop being injected into prompts and stop being trusted at rung 1 — **stale knowledge is worse than none**, because it sends the resolver confidently at the wrong element.
- Scoped strictly per `Application`; no cross-application bleed.
- Relevance selection for the context builder, so prompts carry the handful of entries that matter.

**Files:** `apps/api/src/knowledge/**`

**Acceptance**

- [ ] Repeated successful resolution raises confidence; repeated misses drive it below the floor.
- [ ] A below-floor entry is skipped at rung 1 rather than being tried and failing.
- [ ] Knowledge from one application is never visible to another.
- [ ] The confidence math is unit-tested.

---

## E5.5 — Knowledge viewer · `TODO`

**Goal:** what the system has learned is inspectable and correctable.

**Depends on:** E5.4, E0.4.

**Deliverables**

- Browse and search knowledge per application, with kind, key, confidence, hit/miss counts, and last-seen.
- Manual correction and deletion — a wrong learned fact must be removable without a database client.
- Provenance: which execution taught it this.

**Files:** `apps/web/src/app/knowledge/**`

**Acceptance**

- [ ] Every entry shows its confidence and provenance.
- [ ] Deleting an entry takes effect on the next run.
- [ ] Editing an entry's value re-validates it against the shared schema before saving.
