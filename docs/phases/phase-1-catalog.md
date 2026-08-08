# Phase 1 — Catalog

**Goal:** somewhere to hang tests.

**Demo:** create a project → application → environment pointing at a real site.

Small phase, and deliberately so. It exists because every later phase needs an `applicationId` and an `environmentId` to hang off, and because it is where the CRUD + zod-at-the-boundary pattern gets established once for every module that follows to copy.

---

## E1.1 — Catalog API · `DONE`

**Goal:** CRUD for `Project`, `Application`, and `Environment`.

**Depends on:** E0.2, E0.3.

**Deliverables**

- Three Nest modules — `projects`, `applications`, `environments` — each with a controller, a service, and no logic beyond persistence.
- Every request body parsed through its `@agentx/shared` DTO schema at the controller boundary via the `ZodValidationPipe` from E0.2. **No `as` casts on request data.**
- Nested reads: `GET /projects/:id` includes its applications; `GET /applications/:id` includes its environments.
- Deletes rely on the cascade rules from E0.3 rather than manual cleanup.

**Files:** `apps/api/src/projects/**`, `apps/api/src/applications/**`, `apps/api/src/environments/**`, `apps/api/src/common/mappers.ts`

**As built**

- **A mapper layer per entity** converts Prisma rows to wire shapes — `Date` → ISO string, JSON TEXT → parsed object. That layer is also where credential redaction will hook in, so it earns its place rather than being ceremony.
- **Parent existence is checked explicitly** before a create, so an unknown `projectId` is a 404 naming the project rather than a foreign-key violation surfacing as a 500.
- `undefined` and `null` are kept distinct in PATCH bodies: unsupplied leaves a column alone, explicit null clears it.
- **New e2e database harness.** `test/global-setup.ts` deletes and re-migrates `data/agentx-e2e.db` before each run, and `setup-e2e.ts` pins `DATABASE_URL` to it. Catalog tests write rows; pointing them at the dev database would mutate whatever the developer had open in Prisma Studio, and inheriting a developer's `.env` is how the Phase 0 `dev.db` problem happened.

**Acceptance**

- [x] Full CRUD on all three resources, verified by e2e against a real database and by hand in a browser.
- [x] A malformed `baseUrl` (`localhost:4321`) is rejected with a 400 naming `baseUrl`.
- [x] Deleting a project removes its applications and environments — asserted by e2e and confirmed directly in SQLite (all counts 0).
- [x] A 404 on a missing id returns the shared error shape; the e2e explicitly asserts no Prisma text leaks into the message.
- [x] Responses are *parsed* through the shared schemas in the tests, so the wire contract itself is what is asserted.

---

## E1.2 — Catalog UI · `DONE`

**Goal:** the catalog is usable without curl.

**Depends on:** E1.1, E0.4.

**Deliverables**

- Projects list + detail; applications under a project; environment editor.
- shadcn `Table`, `Dialog`, `Form` — the primitives are already configured, so no new UI dependency.
- Forms validate client-side against the **same** `@agentx/shared` schemas the API validates with, so the two cannot disagree.
- Empty states that point at the next action, since the demo starts from an empty database.

**Files:** `apps/web/src/app/projects/**`, `apps/web/src/app/applications/[id]/**`, `apps/web/src/components/catalog/**`, `apps/web/src/lib/use-api.ts`

**As built**

- shadcn primitives generated: button, input, label, textarea, table, card, badge, dialog.
- `useResource` handles loading/error/reload and resets **during render** on a key change, so a new page never briefly shows the previous resource's data.
- **Delete is a dialog that names the cascade**, not `window.confirm`. A native modal blocks the page, and "are you sure?" without saying what else disappears is not informed consent.
- Dialogs validate client-side against the *same* shared schema the API uses, then map any server-side `issues` back onto the offending fields.

**Acceptance**

- [x] Created project → application → environment entirely through the browser, then deleted the project and watched the cascade empty the list.
- [x] A validation error renders against the offending field — verified twice in the browser: an empty name (client-side, no request) and `localhost:4321` rejected with "must be an http:// or https:// URL".
- [x] Rows created in the UI are present in SQLite; deletion removes them (`Project: 0, Application: 0, Environment: 0`).
- [x] No console errors or warnings across the whole walkthrough.

---

## E1.3 — Credential references · `DONE`

**Goal:** a test can log in without a secret ever entering the database.

**Depends on:** E1.1.

**Deliverables**

- `Environment.credentialRefs` stores **environment variable names**, never values: `{ usernameEnv: 'DEMO_USER', passwordEnv: 'DEMO_PASSWORD' }`.
- A resolver used by the runner (Phase 3) that reads `process.env[name]` at execution time and fails loudly, naming the variable, when it is unset.
- The UI labels these fields as variable names and shows the resolved/unresolved state — **never** the value.
- A step's `data` field may hold a credential reference rather than a literal, so recorded passwords never land in a spec.
- Redaction in logs and evidence: resolved credential values are replaced with `***` in step logs, error messages, and recorded network payloads.

**Security note:** this is the one place in the MVP where a mistake leaks something real. Secrets stay in the process environment. They must not reach SQLite, the evidence directory, the report output, or the LLM prompt context. The redaction pass is part of this epic, not a follow-up — evidence files are written to disk and shared, and a password captured in a `network.json` is a leak that outlives the run.

**As built**

- `CredentialsService.status()` returns names and booleans for the UI; `resolve()` returns values plus a `Redactor` **primed with those values**, so the thing that needs scrubbing is handed over together with the means to scrub it.
- `MissingCredentialError` names *every* missing variable at once — one restart per run, not per variable.
- `Redactor` ignores values shorter than 4 characters (redacting a 2-character "secret" would scrub unrelated substrings out of every DOM snapshot), redacts longest-first so overlapping secrets cannot leave a fragment, and walks object **keys** as well as values.
- `GET /environments/:id/credentials` is the only credential endpoint, and it is structurally incapable of returning a value.

**Acceptance**

- [x] The environment stores `{"usernameEnv":"DEMO_USER","passwordEnv":"DEMO_PASSWORD","extra":{}}` — verified by reading the SQLite row directly. `DEMO_USER` was set to `demo@example.com` in the API process at the time; that value appears nowhere in the database.
- [x] An unset variable is reported before anything runs: the UI showed ✓ `DEMO_USER` / ✗ `DEMO_PASSWORD`, and `resolve()` throws naming the missing variables.
- [x] The credential status response contains no values — asserted in both the unit test and the e2e.
- [x] A grep of `data/evidence/` after a login run finds no credential value — **closed in Phase 3**, and it caught a real leak: Playwright's ARIA snapshot reports a password field's value, which was reaching disk unredacted. See E3.1.
- [ ] Credential values do not appear in any `LlmCall` prompt payload — **deferred to Phase 5**, same reason.
