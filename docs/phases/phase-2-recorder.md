# Phase 2 — Recorder → Intent Specification

**Goal:** the headline input path — a human records once, and gets back readable English.

**Demo:** record a login flow by hand, watch it become an editable intent specification.

This is the phase that decides whether Agent X is a different kind of tool or a Playwright codegen wrapper. The difference is entirely in what the recorder captures: **intent context, not selectors.**

---

## E2.1 — Recorder service · `DONE`

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

**As built**

- The capture script is one large function on purpose — Playwright serializes it with `toString()`, so it can hold no imports and no closure over module scope. Its output is parsed against `capturedEventSchema` on the server rather than trusted: it runs inside the page under test, which can call the exposed binding with anything.
- **`isSecret` is persisted, not re-inferred.** The value of a password field never leaves the page, but the *fact* that one was typed does — otherwise the compiler would have to guess from the field's name, and would guess wrong.
- Clicks are attributed to the interactive ancestor a human would name (the button, not the `<span>` inside it).
- A `NAVIGATE` fires while the navigation is still in flight, so evidence capture waits for `domcontentloaded` first. Without that, the first event of every recording captured a blank page or timed out — which is exactly how it failed the first time the suite ran under load.

**Acceptance** — all verified by `capture-bundle.e2e-spec.ts` (11 tests, real Chromium, real demo app)

- [x] Recording survives a full-page navigation and keeps capturing.
- [x] Typing an email produces one `INPUT` event with the final value, not one per keystroke.
- [x] Every event carries a role or an accessible name where the DOM offers one; a `<label for>` resolves to the field's name.
- [x] App-dispatched synthetic clicks are not recorded.
- [x] A pending value is flushed *before* the click that submits it — order is asserted, since a spec that clicks before typing is useless.
- [x] Password values are never captured; the string does not appear anywhere in the payload.
- [x] A test id outranks every other selector candidate; a CSS path is kept as the last resort.
- [x] Scroll bursts collapse to one event; ordinary typing produces no `KEY` events, but `Enter` does.
- [x] Closing the browser window stops the recording cleanly (`context.on('close')`).

> **Playwright's `selectOption` dispatches *synthetic* events**, which the recorder deliberately ignores, so the select test drives the keyboard instead. A human's selection is trusted; the helper's is not. Worth remembering when writing any future test against this code.

---

## E2.2 — Recording API · `DONE`

**Goal:** recordings are durable and observable live.

**Depends on:** E2.1.

**Deliverables**

- `POST /recordings` (start), `GET /recordings/:id/events` (**SSE**), `POST /recordings/:id/stop`, plus list and detail.
- `Recording` + ordered `RecordedEvent` rows persisted **as they arrive**, so a crashed browser still leaves a usable recording.
- Screenshots and a11y snapshots written to `data/evidence/recordings/<recordingId>/` with `Artifact` rows.
- A session registry that survives a dashboard reload — the browser is owned by the API, not by the tab that opened it.
- Cleanup on stop, on API shutdown, and on an orphaned session, so no headed Chromium is left running.

**Files:** `apps/api/src/recorder/{recorder.controller.ts,recorder.module.ts,session-registry.ts}`

**As built**

- Enrichment runs through a **per-session promise queue**, so overlapping screenshots cannot reorder events.
- `streamOrEmpty` returns an already-complete stream for a finished recording; the dashboard falls back to the stored timeline, which is what lets a recording be opened long after the fact.
- Evidence is served by a dedicated read-only controller. Snapshots are served as **text/plain with `nosniff`** — they come from the application under test, and rendering one as HTML would run its scripts on our origin.

**Acceptance**

- [x] A real (headless) recording against the demo app captures the opening navigation with a screenshot and an ARIA snapshot.
- [x] Stopping twice is idempotent — the window closing and the user clicking Stop are the same intent arriving twice.
- [x] An unknown application 404s *before* a browser is opened; a `file://` start URL is rejected at the boundary.
- [x] Deleting a noise event leaves the remaining indexes alone (the index is the event's identity in the compiled log).
- [x] `onModuleDestroy` stops every live session, so killing the API leaves no orphaned Chromium.
- [x] Evidence serving refuses `../` and percent-encoded traversal.
- [ ] Events appear in the SSE stream within a second — the stream is wired and the page merges live events by id, but this was not measured; the browser walkthrough used an already-stopped recording.

---

## E2.3 — Recorder UI · `DONE`

**Goal:** the human can see what was captured while capturing it.

**Depends on:** E2.2, E0.4.

**Deliverables**

- Start control (pick application + environment + start URL), live event timeline, stop control.
- Screenshot thumbnails per event, with role and accessible name shown — this is what makes "we captured intent, not selectors" visible rather than asserted.
- Delete-event affordance for noise the suppression rules missed.

**Files:** `apps/web/src/app/recordings/**`

**Acceptance**

- [x] Each entry shows role + accessible name and its landmark — never a CSS selector. A secret-valued step is labelled "secret — value not stored".
- [x] Screenshot thumbnails render from the evidence store, verified in a real browser against a real recording.
- [x] Deleting an event removes it from the log used for compilation.
- [x] Stored and live events are merged by id, so the page works opened mid-session, reloaded, or long afterwards.
- [ ] Timeline updates live as the human clicks — the SSE wiring is in place and the merge is written, but it was not observed live, because the recorder's headed browser cannot be driven from here (see the note at the end of this file).

---

## E2.4 — Intent compiler · `DONE (model response unverified)`

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

**As built — the design decision that matters**

**The model never produces a selector.** It returns a `sourceEventIndex` per step, and the server attaches the real captured `targetHints` from that event. A model asked for selectors will cheerfully invent plausible ones that never existed; this shape makes that impossible rather than merely discouraged. A step the model *inferred* rather than observed gets empty hints and must be resolved from its description alone — which is honest, and exactly what the resolver ladder is for.

Supporting pieces:

- `LlmService` is the only path to the model. The JSON Schema the model is given is generated from the same zod schema that validates its reply (`z.toJSONSchema(schema, { io: 'input' })`), so the contract asked for and the contract enforced cannot drift.
- One retry on a schema violation, with the validation error and the model's own output fed back — then a hard error. Never a partial parse.
- Every attempt writes an `LlmCall` row (prompt id, version, model, tokens, latency, ok/error), including failures.
- The prompt steers toward **deterministic expectations**, and labels `SEMANTIC` as costing a model call on every run.
- Compaction: the URL is printed only when it changes, and one accessibility snapshot per distinct page rather than per event. A 40-event recording would otherwise be a six-figure-token prompt that is mostly repetition.

**Acceptance**

- [x] No compiled step can contain a selector — structurally guaranteed, and asserted.
- [x] A password appears as `{kind: ENV_REF, envVar: …}`, never as a literal.
- [x] Recorded hints are attached from the event, not the model — asserted field by field.
- [x] An inferred step gets empty hints rather than invented ones.
- [x] Compiling a recording with no events is refused with a 400.
- [x] The compiled version is `RECORDED`, numbered 1, and linked to its recording.
- [ ] **A recorded login compiles into readable steps — NOT VERIFIED.** The whole chain was exercised against the live API and fails only at the model call itself: `401 invalid x-api-key`, surfaced cleanly in the UI, with the `LlmCall` row still written. Everything up to and including the HTTP request to Anthropic works. Verifying the *quality* of the output needs a real `ANTHROPIC_API_KEY`.
- [ ] A malformed model response retries once — the retry path is written but has not been exercised against a real model.

---

## E2.5 — Spec editor · `DONE`

**Goal:** the human stays in control of what the model wrote.

**Depends on:** E2.4.

**Deliverables**

- Review, edit, reorder, delete, and mark-optional for generated steps.
- Editing `intent`, `targetDescription`, `data`, and `expectation`; `targetHints` shown read-only as provenance.
- Saving writes a **new immutable `TestVersion`** — versions are never edited in place (see [../data-model.md](../data-model.md)).
- Version history with a diff between any two versions.

**Files:** `apps/web/src/app/specs/**`, `apps/api/src/specs/**`

**As built**

- The version number is derived from the current maximum rather than a counter on the spec, so two concurrent saves collide on `@@unique([specId, version])` instead of silently overwriting each other.
- `index` is assigned from array position on save, so reordering cannot produce gaps or collisions.
- The expectation editor lists kinds deterministic-first and labels `SEMANTIC` with its cost, so choosing it is deliberate rather than the path of least resistance.

**Acceptance**

- [x] Editing produces version N+1 and leaves N byte-identical — asserted in e2e (`expect(reread).toEqual(first)`) and confirmed by hand: after an edit, v1 still had its original 5 steps while v2 had the edited 4.
- [x] Reordering renumbers `index` without gaps or collisions.
- [x] `TestSpec.currentVersionId` follows the newest saved version.
- [x] The editor states plainly that saving creates a new version and that the current one is preserved.
- [ ] A side-by-side **diff view** between two versions — not built. The version history lists every version with its source and note, and both are fetchable, but nothing renders the difference. Worth doing when healing lands in Phase 6, since that is where reviewing a change actually matters.

---

## Note on what could not be verified from here

The recorder opens a **headed browser for a human**. Automation cannot drive that window from this session, so the live timeline was exercised with an already-stopped recording rather than by clicking through a session and watching events stream in.

That gap is narrower than it sounds: `capture-bundle.e2e-spec.ts` drives a real Chromium through the real demo app with real trusted input and asserts what gets captured, and `recorder.e2e-spec.ts` drives the real lifecycle over HTTP. What remains unobserved is specifically the SSE frames arriving in a browser while a human clicks.
