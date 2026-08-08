# Phase 7 — Reports, knowledge, explorer

**Goal:** ship-quality output, and the demo that shows it.

**Demo:** run the same execution twice and `diff` the reports — identical bytes. Then let the explorer loose on the app and watch it propose tests nobody wrote.

---

## E7.1 — Report generation · `DONE`

**Goal:** a run produces an artifact someone can read without the dashboard.

**Files:** `apps/api/src/reports/{build-report.ts,reports.service.ts}`, `apps/web/src/app/executions/[id]/report/**`

**As built**

The format is one idea: a report has a **volatile header** and a **comparable body**, separated by a marker (`<!-- agent-x:body -->`). Run identity, timestamps, duration, tokens and cost live above it; outcomes, rationales, repairs and defects below. Two runs of an unchanged application produce identical bytes below the line, and genuinely different ones above it — because the id and the timing are information, not noise to suppress.

Keeping that line honest costs three rules, and all three are in `build-report.ts` as pure functions: sort every collection by something stable (never by a cuid), keep clocks and durations out of the body, and make evidence paths **relative to the run's own directory** so `<executionId>/step-3/shot.jpg` becomes `step-3/shot.jpg`. That last one is also why the exported Markdown works sitting next to the evidence folder.

Generation is free — no model, no browser — over rows that will not change again, so it runs at the end of every execution and is safe to run again. `GET /executions/:id/report` serves the structured document; `GET /executions/:id/report/markdown` serves the same thing as a downloadable file.

**Acceptance**

- [x] Two runs of the same passing spec produce byte-identical report bodies — asserted both as a unit test over the builder and end to end over two real runs against the demo app.
- [x] The whole documents still differ, so the header is doing its job rather than being suppressed.
- [x] The report is readable standalone — intents, verdicts and the reasons behind them, the rung that resolved each step, and any diagnosis.
- [x] Evidence links resolve from the exported file, because they are relative to the directory the file names.
- [x] Every run gets one without being asked; a run that predates the feature generates one on first view.

---

## E7.2 — Post-run knowledge consolidation · `DONE`

**Goal:** one pass folds a run's lessons into knowledge.

**Files:** `apps/api/src/knowledge/consolidation.service.ts`

**As built**

The confidence math moved **out of the step loop entirely**. It used to be four calls across three branches, each with its own idea of what counted as a hit, and the Phase 5 demo found a case none of them covered — a step that resolved from memory and then failed verification, which nothing penalised. It now has one home, and the rule is stated once: *resolving is not the same as having found the right element*, so what a resolution was worth is decided after the step has verified.

That reordering is also what makes it idempotent, which the in-loop version could not be. `Execution.consolidatedAt` is set once; consolidating again reads the same rows and changes nothing, so replaying history cannot inflate what the agent believes.

Human adjudication of an `UNCERTAIN` step is folded in separately, because it arrives after the run is closed. It is the most reliable signal the system gets — someone actually looked — and it is the only other path that writes to knowledge.

Promotion and demotion are the existing asymmetric curve rather than a new mechanism: `+0.1` per confirmed hit, `−0.3` on a miss, age decay applied on read. Three clean runs take a new entry from 0.5 to 0.8; one miss undoes all of it. That asymmetry is the point — stale knowledge is worse than none.

**Acceptance**

- [x] A stable target's confidence climbs across runs, verified against two real runs.
- [x] A target that stopped working decays and stops being tried at rung 1.
- [x] Re-consolidating a run is a no-op — the count folded is zero and no confidence moves.
- [x] The runner writes nothing to knowledge directly; `recall` at rung 1 is all it does.

---

## E7.3 — Explorer agent · `DONE`

**Goal:** find tests nobody wrote.

**Files:** `apps/api/src/agent/explorer/{bounds.ts,explorer.service.ts}`, `apps/api/src/llm/prompts/explore.prompt.ts`

**As built**

Everything interesting in this epic is refusal, and all of it is in `bounds.ts` as pure functions applied to the model's answer **before** anything reaches a locator:

- **Origin allowlist.** Same origin as the environment's base URL, scoped to origin rather than path prefix — a login redirect to `/auth` is part of the application, a support link to a vendor is not. Relative URLs are resolved against the current page first, so `//evil.example.com/` cannot sneak through as a path.
- **Destructive denylist** by accessible name, deliberately broad and deliberately biased towards refusing. Sign-out is on it too — not for safety, but because it ends the session and every subsequent turn would explore a login page.
- **Three budgets**: steps, model calls, and wall-clock. Wall-clock matters independently, because one turn can block for a long time and "twelve steps" bounds nothing if each may take a minute.
- **A dialog handler that always dismisses.** A confirmation is the last thing between an exploration and something irreversible, and the explorer has no business deciding to pass one.
- **A stuck detector**: four refused moves in a row ends the exploration rather than spending the remaining budget re-proposing them.

What it produces is a *proposal*: a `TestSpec` with `source: EXPLORED` whose steps are the moves that actually succeeded, with expectations derived from what the page became — not the model's recollection of what it did. The model supplies only the name and the description. Discovered journeys are written as `FLOW` knowledge.

The endpoint is synchronous, unlike an execution, because it is bounded by a wall clock the caller chose — the request cannot outlive `maxDurationSeconds`. A run has no such ceiling, which is why that one is queued and streamed.

**Acceptance**

- [x] Exploration stops at its budget and reports what it covered, with `stoppedBecause` always naming a reason.
- [x] Navigation outside the allowlisted origin is refused, including via a protocol-relative URL.
- [x] Destructive controls are not activated — verified against a seeded `Delete account` button wired to a real endpoint that **counts activations server-side**, so the assertion is the application's own word rather than the absence of a click.
- [x] Proposed specs land as `EXPLORED`, never in the trusted set, and a walk that got nowhere proposes nothing at all.
- [x] Verified against the live model: given "sign in … then create an invoice for 250" it signed in, reached the dashboard, filled the invoice form and submitted it, proposing *Sign in and create an invoice* — six steps, no refusals, and the `Delete account` button sitting on that same dashboard untouched.

---

## E7.4 — Example app and demo polish · `DONE`

**Goal:** the demo never depends on a live third-party site.

**Files:** `examples/demo-app/server.js`, `apps/api/prisma/seed.ts`, root `demo` script

**As built**

`apps/api/prisma/seed.ts` writes the *output* of the recording step — a project, an application, an environment, and a five-step specification written the way the compiler writes them — so a clean clone demos without a human at a browser. Idempotent by name, and it never deletes, because the database it runs against is usually one somebody has been working in. It loads the same two `.env` files the API does, anchored the same way: without that it seeds `data/agentx.db` while an API configured elsewhere reads an empty dashboard with no error to explain it.

`npm run demo` migrates, seeds, and starts the demo app alongside both services with the demo credentials in the environment.

The demo app gained a **danger zone** — a real `Delete account` button posting to a real endpoint that counts activations — which exists so the explorer's most important bound can be tested against evidence rather than against absence.

**Acceptance**

- [x] `npm run demo` migrates, seeds and starts everything; the seeded spec then passes end to end with one model call (the semantic step).
- [x] Re-seeding leaves one of everything and keeps an existing edited version rather than burying it.
- [x] The example app runs offline with no dependencies.
- [x] Each breakage switch produces its intended behaviour — verified live, below.
- [ ] **A single command that also *runs* the spec.** `npm run demo` brings the system up; starting the run is still a click in the dashboard or a POST. Wiring an auto-run into the same command would mean the demo starts by racing a browser launch against a Next.js cold start.

---

## Verified against the live model

Phase 6 shipped with its prompts unverified; that gap is now closed. Against `claude-sonnet-5` and the real demo app:

| | |
| --- | --- |
| Seeded spec, healthy app | **PASSED**, 5/5 steps, **1 model call** — the semantic step, and only that |
| `BREAK_REDESIGN=1` | Step 4 failed to resolve (two `Continue` buttons, stale landmark) → diagnosed **`TEST_DRIFT`** → healed to `role=form[name="Account access"] >> role=button[name="Continue"]` → reverified → **HEALED**, run **PASSED**, 4 model calls |
| Approve the repair | Version **2**, `source: HEALED`, version 1 untouched |
| Re-run the approved version | **PASSED** with **1 model call**; step 4 now resolves at `ROLE_NAME`, steps 2–3 at `KNOWLEDGE` |

That last row is the thesis in one line: the specification repaired itself, a human approved the change, and the run got cheaper.

Two things the live runs showed that the tests had not:

**The redactor reaches the model's own words.** The semantic verifier's rationale came back as *"a status element with text 'Signed in as ***.'"* — the credential scrubbed on the way out and never written to evidence.

**The explorer cannot disambiguate.** Run against the *redesigned* app it hit the two `Continue` buttons, correctly refused all four attempts, and stopped `STUCK` — proposing a spec the model honestly named *"Sign in with email and password (incomplete)"*. Its action vocabulary is role-and-name, exactly like the resolver's LLM rung, so it can detect an ambiguity but never resolve one. Giving it the healer's landmark vocabulary is the obvious fix and is not built.

---

## Not built

- **A `diff` command.** Byte-identical bodies make reports diffable; nothing in the product actually diffs two of them for you.
- **Static export beyond Markdown.** The report page renders the structured document and the file downloads as Markdown. There is no self-contained HTML bundle with the evidence inlined.
- **Multiple specs from one exploration.** A walk proposes one specification. "Find every path to checkout" needs several explorations, and nothing merges them.
- **The explorer never signs in on its own.** It is told not to invent credentials, and it has no access to the environment's credential references — so exploring anything behind a login means putting the credentials in the goal, as the live run above did. Wiring `ENV_REF` data into explored steps is the missing piece.
- **Evidence retention.** Still unbuilt, and now the oldest outstanding gap in the project.
