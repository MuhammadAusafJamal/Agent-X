# Phase 8 — Stretch

**Only if Phases 0–7 land.** Nothing here is required for the MVP, and each item is written so it can be picked up independently rather than as a sequence.

---

## E8.1 — Vision resolution · `TODO`

**Goal:** a final rung on the resolver ladder for targets the DOM cannot express.

**Depends on:** E5.3.

The original spec is explicit that vision is not required first, and the reason holds: introduce it only against **concrete recorded cases** where DOM + accessibility + LLM reasoning failed. Those cases already exist by this point — E3.2 records `resolutionStrategy` and `candidateCount` on every step, so the unresolvable set is queryable rather than hypothetical.

**Deliverables**

- Rung 7 `VISION`: screenshot + `targetDescription` → coordinates → `page.mouse` click, used only after rung 6 fails.
- The bbox already captured at record time (E2.1) seeds the search region.
- Every vision resolution logged loudly — it means the DOM path has a gap worth fixing at the source.

**Acceptance**

- [ ] Vision fires only after rung 6 fails.
- [ ] A canvas-rendered or icon-only control resolves that the DOM ladder could not.
- [ ] Vision resolutions are separately reportable, so the gap stays visible.

---

## E8.2 — Firefox and WebKit · `TODO`

**Goal:** the cross-browser claim in the spec becomes true.

**Depends on:** E3.1.

**Deliverables**

- Browser choice per environment or per execution; `playwright:install` covers all three engines.
- Per-browser evidence directories so runs stay comparable.
- Known-divergence handling: the a11y tree differs between engines, and knowledge learned on Chromium may not transfer — scope `SELECTOR_MEMORY` by engine or accept the decay.

**Acceptance**

- [ ] The same spec runs on all three engines.
- [ ] Cross-engine differences surface as diffs, not as false failures.

---

## E8.3 — Parallel execution · `TODO`

**Goal:** more than one run at a time.

**Depends on:** E3.3, which deliberately serializes runs.

**Deliverables**

- A worker pool replacing the MVP's serial queue, with a concurrency cap.
- Per-run browser isolation; contention limits on the headed recorder, which cannot meaningfully parallelize.
- SQLite write contention handling — WAL mode, and short transactions. This is where the single-file database first starts to push back, and where migrating to Postgres would be evaluated on evidence rather than in advance.

**Acceptance**

- [ ] N runs execute concurrently without cross-contamination of evidence or knowledge.
- [ ] No `SQLITE_BUSY` errors under the target concurrency.

---

## E8.4 — Auth and multi-user · `TODO`

**Goal:** more than one person can use one instance.

**Depends on:** all of Phases 0–7.

This is a **phase-sized** change, not an epic, which is why it was cut from the MVP: it forces user scoping onto every table, every query, and every route, and it is invisible in a demo.

**Deliverables**

- NestJS guards + JWT; user and organization models; ownership on every catalog resource.
- Scoped queries throughout — the failure mode is one missed `where` clause leaking another user's data.
- Knowledge and evidence scoped per organization.

**Acceptance**

- [ ] No endpoint returns a resource the caller does not own — verified by a test suite over every route, not by review.
- [ ] Evidence files are access-checked, not merely unguessable.

---

## E8.5 — CI integration · `TODO`

**Goal:** Agent X runs on a pull request.

**Deliverables**

- A headless run mode and a CLI entry point.
- Exit codes mapping to the three-state result — `UNCERTAIN` needs a policy: block, or pass with a warning.
- Machine-readable report output (the E7.1 JSON) plus artifact upload.
- A GitHub Action wrapper.

**Acceptance**

- [ ] A failing spec fails the build with an actionable report.
- [ ] `UNCERTAIN` behaves per configured policy.

---

## Deliberately not planned

- **Hosted/multi-tenant deployment** — the MVP is local-first by decision, and hosting a tool that drives real browsers against customer sites is a different product with different security requirements.
- **Multi-model routing** — the spec says start with one provider, and nothing in Phases 0–7 has produced evidence that a second one is needed.
- **A test authoring DSL** — the recorder plus the spec editor is the authoring story. A DSL would compete with it.
