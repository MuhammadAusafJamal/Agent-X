# Architecture

## What Agent X is

A human QA records a session once. An LLM turns that recording into an **intent specification** — steps written as intent ("sign in as the seeded user"), not as selectors. An agent orchestrator then replays that specification against a live site through Playwright: resolving each target semantically, verifying the outcome, diagnosing failures, healing steps that drifted, and folding what it learned back into per-application knowledge so later runs get smarter.

The distinction that makes this more than a Playwright wrapper:

> **Playwright is the execution layer, not the intelligence layer.** It clicks and types. It does not decide what to click.

## Decisions

These supersede the original spec wherever the two conflict.

| Area | Decision | Why |
| --- | --- | --- |
| Persistence | **SQLite owned by the API**, via Prisma. `apps/web` holds no durable data. | The spec drew `NestJS API → IndexedDB + Dexie`, which cannot work — IndexedDB is a browser API the server cannot reach, and the agent, the runner, and the evidence writer all live server-side. SQLite is one file, installs without a toolchain, and gives every component one truth to read. |
| Dexie / IndexedDB | **Dropped.** `dexie` and `dexie-react-hooks` come out of `apps/web/package.json`. | Unused once the API owns data; leaving them invites a second, divergent schema. |
| Recorder | API launches a **headed Playwright Chromium** with an injected capture script. | Captures the intent context — role, accessible name, ARIA snapshot, visible text, bbox, ranked selector candidates, screenshot — that `playwright codegen` does not. Nothing to install on the QA's machine. |
| Auth | **Out of scope for MVP.** API binds localhost, no guards. | Single-user local demo. Adding it later forces user-scoping on every table, so it is a phase (Phase 8), not an epic. |
| LLM | **`claude-sonnet-5`** for every agent role, one provider (Anthropic). | Per-step latency is what a live demo feels. The model id lives in config, so promoting the hard calls to `claude-opus-5` is a one-line change. |
| Vision / computer-use | Deferred to Phase 8. | DOM + accessibility tree + LLM reasoning first, per the spec. Vision earns its place only against concrete cases the DOM ladder cannot resolve. |
| Transport | REST for commands and queries, **SSE** for live run and recording events. | Streaming without a socket lifecycle to manage. Events are server→client only; nothing needs a duplex channel. |
| Shared contract | `packages/shared` holds zod schemas + inferred types for every wire payload. | Both apps import the same schemas, so the API and dashboard contracts cannot drift. |

## System

```
apps/web (Next.js dashboard)
   │  REST (commands, queries)   +   SSE (live execution & recording events)
   ▼
apps/api (NestJS)
   ├── Prisma ──────────► SQLite             (data/agentx.db)
   ├── Evidence store ──► local filesystem    (data/evidence/<executionId>/…)
   ├── LLM module ──────► Anthropic (claude-sonnet-5)
   ├── Agent Orchestrator ── Planner │ Explorer │ Diagnoser │ Healer
   │        └── Action Resolver ── knowledge → role/name → testid → text → CSS → LLM
   │                               (each scoped to the step's landmark first)
   └── Playwright ── Recorder (headed) │ Runner (trace + video + network + console)
              ▼
           Browser ──► Website under test
```

## Component responsibilities

| Component | Owns | Does not own |
| --- | --- | --- |
| **Recorder** | Capturing human actions with full intent context | Deciding what the actions mean |
| **Intent compiler** (LLM) | Turning a raw event log into ordered, human-readable steps | Executing anything |
| **Orchestrator** | The per-step loop, budgets, cancellation, event emission | Element lookup, verification logic |
| **Action Resolver** | Turning `targetDescription` into exactly one element handle | Deciding whether the result was correct |
| **Runner** (Playwright) | Acting on the page, collecting observations and evidence | Any decision requiring judgment |
| **Verifier** | `PASS` / `FAIL` / `UNCERTAIN` for a step | What to do about a `FAIL` |
| **Diagnoser** | Classifying a failure's cause | Fixing it |
| **Healer** | Proposing a corrected step and reverifying it | Approving the change into a spec version |
| **Explorer** | Walking an application unscripted, within hard bounds, and proposing specs | Deciding a proposal is a test worth trusting |
| **Knowledge** | What we have learned about an application | Deciding what a run taught — that is consolidation's, after the fact |
| **Consolidation** | Folding a finished run's lessons into knowledge, once | Anything during the run |
| **Reports** | Writing a run down so it can be read and diffed | Judging it |

## Key flows

### Record → specification

```
human clicks through the app in a headed Chromium
   → capture script emits {url, type, role, accessibleName, text, testid, bbox, selectorCandidates, timestamp}
   → service pairs each event with a pruned a11y snapshot + screenshot
   → RecordedEvent rows + evidence files
   → LLM compiles the event log into TestSpec + TestVersion + ordered TestStep[]
   → human reviews and edits in the spec editor
   → immutable TestVersion saved
```

### Replay → verdict

```
for each step:
   build context (step intent + application knowledge + current observation)
      → Action Resolver ladder → element handle (+ strategy, confidence)
      → Playwright acts
      → observe (DOM, a11y, network, console, screenshot)
      → Verifier: deterministic checks first, LLM semantic check only if inconclusive
      → PASS      → next step, write knowledge
                    (won on the LLM rung? the *spec* is wrong — queue a repair)
        FAIL      → Diagnoser
        UNCERTAIN → surfaced for a human, never coerced to PASS
```

### Failure → heal or bug

```
did the action run, and only the outcome fail?
   → reverify once after a settle (never re-run the action)
      → passes → FLAKE. This is the only evidence FLAKE is ever concluded from.

Diagnoser classifies: APP_BUG | TEST_DRIFT | ENVIRONMENT | UNKNOWN
   (settled from status codes where possible; the model never sees FLAKE as an option)

   TEST_DRIFT → Healer proposes corrected TargetHints — including a landmark,
                which is the one hint that resolves an ambiguity rather than
                merely detecting it
                 → resolved deterministically before being written down
                 → applied in-run → REVERIFY
                    → passes → HealingRecord queued for human approval
                    → fails  → recorded as REVERIFY_FAILED, not retried blindly
   APP_BUG    → BugReport with repro steps and evidence refs. No heal.
   otherwise  → recorded on the step and left for a human.
```

The asymmetry is the point: the system heals its own drift, but it never heals over a real defect in the application under test. That gate is an early return in `HealerService.propose`, not an instruction in a prompt.

**Approval writes a new `TestVersion`.** The healer changes what a *run* did; only a human changes what the *specification* says.

### Run → what it leaves behind

```
run finishes
   → consolidate: fold each step's lesson into knowledge, once
      PASS / HEALED → confirm the target that worked
      FAIL          → decay whatever memory led there
      UNCERTAIN     → nothing, until a human settles it
   → report: markdown + json, deterministic body, generated free
```

Both are pure functions over rows that will not change again, which is what lets them run unconditionally and be re-run safely. Nothing during a run writes to knowledge: what a resolution was worth depends on whether the step then *verified*, and that is not known yet.

### Explore → proposed specification

```
loop, until a bound stops it:
   snapshot → model names one move → REFUSE or allow
      off-origin?          refuse
      destructive control? refuse
      budget spent?        stop
   → act → record the move only if it actually worked

→ propose a TestSpec, source: EXPLORED, from the moves that succeeded
→ record the journey as FLOW knowledge
```

The explorer is the only component that acts without a human having scripted the move, so its bounds are pure functions applied **before** the model's answer reaches a locator — not instructions in its prompt.

## Action Resolver ladder

Tried in order. The first strategy that yields **exactly one** visible, enabled element wins.

| # | Strategy | Source | Phase |
| --- | --- | --- | --- |
| 1 | `KNOWLEDGE` | Last-known-good selector for this target on this application | 3 |
| 2 | `ROLE_NAME` | `getByRole(role, { name })` from the step's target hints | 3 |
| 3 | `TEST_ID` | `getByTestId` | 3 |
| 4 | `TEXT` | `getByText` | 3 |
| 5 | `CSS` | Ranked CSS candidates recorded at capture time | 3 |
| 6 | `LLM` | Pruned a11y snapshot + `targetDescription` → chosen element + rationale | 5 |
| 7 | `VISION` | Screenshot + coordinates | 8 |

Rungs 2–6 are tried **scoped to the step's recorded landmark first**, then against the whole page. A landmark is what tells "Save in the toolbar" from "Save in the dialog" — an ambiguity the uniqueness rule can only refuse, never resolve — and trying the page afterwards keeps a step working when the landmark itself was what got redesigned. A scoped match is recorded as a chained selector (`role=dialog[name="Preferences"] >> role=button[name="Save"]`) so it stays something `page.locator()` can parse, remember, and replay at rung 1.

Every resolution records its winning strategy, the candidate count, and a confidence value on the `ExecutionStep`. That record is what the knowledge store and the LLM stage learn from — a step that has needed the LLM three runs running is a step whose hints are stale. From Phase 6 a single `LLM` win is enough to queue a repair to the specification, since it means the recorded hints resolved nothing.

## Verification

Deterministic checks run **always** and decide most steps on their own — they are free, fast, and not subject to a model's opinion:

- URL match (exact, prefix, or pattern)
- Element presence / absence
- Text match
- Network status codes for requests the step triggered
- Absence of console errors

The LLM semantic verifier runs **only when the deterministic checks are inconclusive**, and returns `{ status, rationale, evidenceRefs }` against a pruned a11y snapshot. Three-state result throughout: `PASS | FAIL | UNCERTAIN`.

## Evidence layout

Written under `EVIDENCE_DIR` (default `data/evidence/`), served read-only by the API at `/evidence`:

```
data/evidence/<executionId>/
  trace.zip            Playwright trace — full timeline, DOM snapshots, network
  video.webm           whole-run video
  step-<n>/
    shot.png           screenshot after the action
    dom.html           pruned DOM snapshot
    a11y.json          pruned accessibility tree
    network.json       requests/responses attributable to this step
    console.json       console messages during this step
```

`Artifact` rows hold **relative** paths so the directory stays portable.

Recording evidence follows the same shape under `data/evidence/recordings/<recordingId>/`.

## LLM conventions

- One provider (Anthropic), one model id from config (`ANTHROPIC_MODEL`, default `claude-sonnet-5`).
- **All** structured output is validated with a zod schema from `@agentx/shared`. One retry on validation failure, then the call is a hard error — never a silent partial parse.
- Every call is logged with prompt id, prompt version, token counts, latency, and cost, linked to the execution that made it. A run can therefore be audited: which prompt version produced which decision.
- Prompts live in a registry with versioned ids, not inline string literals.
- Budget guards live in the orchestrator: max LLM calls per run, max retries per step.

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | liveness |
| `GET/POST/PATCH/DELETE` | `/projects`, `/applications`, `/environments` | catalog CRUD |
| `POST` | `/recordings` | start a headed recording session |
| `GET` | `/recordings/:id/events` | **SSE** live recorded events |
| `POST` | `/recordings/:id/stop` | stop and finalize |
| `POST` | `/recordings/:id/compile` | LLM: event log → intent spec |
| `GET/POST` | `/specs`, `/specs/:id/versions` | test specifications and immutable versions |
| `POST` | `/executions` | start a run |
| `GET` | `/executions/:id/events` | **SSE** live step events |
| `POST` | `/executions/:id/cancel` | cooperative cancel |
| `GET` | `/executions/:id/report` | generated report |
| `GET/PATCH` | `/healings` | healing review queue |
| `GET` | `/bugs` | generated bug reports |
| `GET/PATCH/DELETE` | `/knowledge` | application knowledge |
| `GET` | `/evidence/*` | static evidence files |

## Boundary rule

Per `CONTRIBUTING.md`: **parse at the boundary, don't cast.** Every HTTP body, every LLM response, and every JSON-bearing SQLite column is narrowed through a zod schema from `@agentx/shared` before anything trusts it. SQLite has no JSON column type in Prisma, so structured fields are `String` columns read and written *only* through the shared parse helpers — a raw `JSON.parse(...) as Foo` anywhere in this codebase is a bug.

## Out of scope for the MVP

Authentication and multi-user, vision/computer-use resolution, Firefox and WebKit, parallel execution workers, CI integration, and hosted deployment. Each is listed in [phases/phase-8-stretch.md](phases/phase-8-stretch.md).
