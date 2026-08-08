# Phase 2 — Recorder → Intent Specification

**Goal:** the headline input path — a human records once, and gets back readable English.

**Demo:** record a login flow by hand, watch it become an editable intent specification.

This is the phase that decides whether Agent X is a different kind of tool or a Playwright codegen wrapper. The difference is entirely in what the recorder captures: **intent context, not selectors.**

---

## E2.1 — Recorder service · `TODO`

**Goal:** a headed browser that captures what the human did *and what they were looking at*.

**Depends on:** E0.3, E1.1.

**Deliverables**

- `chromium.launch({ headless: false })` + a fresh context per recording, driven by `PLAYWRIGHT_HEADLESS=false`.
- `context.addInitScript(captureBundle)` — re-injected on every navigation and every frame, so a full page load does not silently stop the recording.
- `context.exposeBinding('__agentx_emit')` as the page→server channel.
- The capture bundle listens for `click`, `input`/`change`, `select`, `scroll`, `keydown`, and `submit`, plus navigations, and emits per event:

  | Captured | Why it matters |
  | --- | --- |
  | URL, timestamp, event type | ordering and context |
  | `role` + accessible name | **the primary intent signal** — how a human describes the control |
  | visible text | disambiguation and LLM readability |
  | `data-testid` | the most stable hint when present |
  | enclosing landmark/section | separates "the Save in the toolbar" from "the Save in the dialog" |
  | bbox | spatial context; also the seed for Phase 8 vision |
  | ranked selector candidates | fallbacks for the resolver ladder |

- Server-side pairing: each event is joined with a **pruned** `page.accessibility.snapshot()` and a screenshot.
- Event coalescing: consecutive `input` events on the same element collapse into one final value; scroll bursts collapse to one. A recording of a typed email should be one step, not thirty.
- Noise suppression for programmatic events (`event.isTrusted === false`) so app-fired events are not recorded as human actions.

**Files:** `apps/api/src/recorder/{recorder.service.ts,capture-bundle.ts,selector-candidates.ts}`

> The capture bundle runs in the page, not in Node. It gets no imports, no TypeScript runtime, and no access to the app's own globals — write it as a self-contained function and keep it dependency-free. Test the selector-candidate ranker as a pure function separately, since it is the one piece with real logic.

**Acceptance**

- [ ] Recording survives a full-page navigation and keeps capturing.
- [ ] Typing an email produces one `INPUT` event with the final value, not one per keystroke.
- [ ] Every event carries a role or an accessible name where the DOM offers one.
- [ ] App-dispatched synthetic clicks are not recorded.
- [ ] Closing the browser window stops the recording cleanly rather than hanging the request.

---

## E2.2 — Recording API · `TODO`

**Goal:** recordings are durable and observable live.

**Depends on:** E2.1.

**Deliverables**

- `POST /recordings` (start), `GET /recordings/:id/events` (**SSE**), `POST /recordings/:id/stop`, plus list and detail.
- `Recording` + ordered `RecordedEvent` rows persisted **as they arrive**, so a crashed browser still leaves a usable recording.
- Screenshots and a11y snapshots written to `data/evidence/recordings/<recordingId>/` with `Artifact` rows.
- A session registry that survives a dashboard reload — the browser is owned by the API, not by the tab that opened it.
- Cleanup on stop, on API shutdown, and on an orphaned session, so no headed Chromium is left running.

**Files:** `apps/api/src/recorder/{recorder.controller.ts,recorder.module.ts,session-registry.ts}`

**Acceptance**

- [ ] Events appear in the SSE stream within a second of the action.
- [ ] Reloading the dashboard mid-recording reattaches to the live stream.
- [ ] Stopping twice is idempotent, not an error.
- [ ] Killing the API leaves no orphaned Chromium process.

---

## E2.3 — Recorder UI · `TODO`

**Goal:** the human can see what was captured while capturing it.

**Depends on:** E2.2, E0.4.

**Deliverables**

- Start control (pick application + environment + start URL), live event timeline, stop control.
- Screenshot thumbnails per event, with role and accessible name shown — this is what makes "we captured intent, not selectors" visible rather than asserted.
- Delete-event affordance for noise the suppression rules missed.

**Files:** `apps/web/src/app/recordings/**`

**Acceptance**

- [ ] Timeline updates live as the human clicks in the headed browser.
- [ ] Each entry shows role + accessible name, not a CSS selector.
- [ ] Deleting an event removes it from the log used for compilation.

---

## E2.4 — Intent compiler · `TODO`

**Goal:** a raw event log becomes ordered, human-readable steps.

**Depends on:** E2.2, E5.1's LLM wrapper *in its minimal form* — build just enough of the Anthropic client here, and generalize it in Phase 5 rather than blocking on it.

**Deliverables**

- `POST /recordings/:id/compile` — one `claude-sonnet-5` call over the compacted event log.
- Structured output validated against the `TestSpec` + `TestVersion` + `TestStep[]` zod schemas. **One** retry on validation failure, then a hard error.
- Each generated step carries:
  - `intent` — "sign in as the seeded user", not "click #login-btn"
  - `action` — the `ActionType`
  - `targetDescription` — natural language: "the primary submit button in the login form"
  - `targetHints` — role, name, testid, text, selector candidates, kept as **fallbacks**
  - `data` — the typed value, or a credential reference (E1.3) for anything secret
  - `expectation` — inferred from what changed after the action (URL change → `URL`; new element → `VISIBLE`)
- Prompt input compaction: send the coalesced event log plus the *final* a11y snapshot per navigation, not every snapshot. A 40-event recording must not become a 200k-token prompt.
- Application context (`Application.description`) included so the model knows what domain it is describing.

**Files:** `apps/api/src/compiler/**`, `apps/api/src/llm/**` (minimal)

**Acceptance**

- [ ] A recorded login compiles into steps a non-engineer can read.
- [ ] No generated step's `intent` contains a CSS selector or an XPath.
- [ ] Expectations are inferred, not left empty.
- [ ] A password typed during recording appears as a credential reference, never as a literal.
- [ ] A malformed model response retries once, then fails with a clear error rather than persisting a partial spec.

---

## E2.5 — Spec editor · `TODO`

**Goal:** the human stays in control of what the model wrote.

**Depends on:** E2.4.

**Deliverables**

- Review, edit, reorder, delete, and mark-optional for generated steps.
- Editing `intent`, `targetDescription`, `data`, and `expectation`; `targetHints` shown read-only as provenance.
- Saving writes a **new immutable `TestVersion`** — versions are never edited in place (see [../data-model.md](../data-model.md)).
- Version history with a diff between any two versions.

**Files:** `apps/web/src/app/specs/**`, `apps/api/src/specs/**`

**Acceptance**

- [ ] Editing a spec produces version N+1 and leaves version N byte-identical.
- [ ] Reordering steps renumbers `index` without gaps or collisions.
- [ ] The diff view shows what changed between two versions.
- [ ] `TestSpec.currentVersionId` follows the newest saved version.
