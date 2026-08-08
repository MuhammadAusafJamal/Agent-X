# Phase 1 — Catalog

**Goal:** somewhere to hang tests.

**Demo:** create a project → application → environment pointing at a real site.

Small phase, and deliberately so. It exists because every later phase needs an `applicationId` and an `environmentId` to hang off, and because it is where the CRUD + zod-at-the-boundary pattern gets established once for every module that follows to copy.

---

## E1.1 — Catalog API · `TODO`

**Goal:** CRUD for `Project`, `Application`, and `Environment`.

**Depends on:** E0.2, E0.3.

**Deliverables**

- Three Nest modules — `projects`, `applications`, `environments` — each with a controller, a service, and no logic beyond persistence.
- Every request body parsed through its `@agentx/shared` DTO schema at the controller boundary via the `ZodValidationPipe` from E0.2. **No `as` casts on request data.**
- Nested reads: `GET /projects/:id` includes its applications; `GET /applications/:id` includes its environments.
- Deletes rely on the cascade rules from E0.3 rather than manual cleanup.

**Files:** `apps/api/src/projects/**`, `apps/api/src/applications/**`, `apps/api/src/environments/**`

**Acceptance**

- [ ] Full CRUD on all three resources, verified against a running API.
- [ ] A malformed `baseUrl` is rejected at the boundary with a 400 naming the field.
- [ ] Deleting a project removes its applications and environments.
- [ ] A 404 on a missing id returns the shared error shape, not a Prisma stack trace.

---

## E1.2 — Catalog UI · `TODO`

**Goal:** the catalog is usable without curl.

**Depends on:** E1.1, E0.4.

**Deliverables**

- Projects list + detail; applications under a project; environment editor.
- shadcn `Table`, `Dialog`, `Form` — the primitives are already configured, so no new UI dependency.
- Forms validate client-side against the **same** `@agentx/shared` schemas the API validates with, so the two cannot disagree.
- Empty states that point at the next action, since the demo starts from an empty database.

**Files:** `apps/web/src/app/projects/**`, `apps/web/src/components/**`

**Acceptance**

- [ ] Create, edit, and delete each resource entirely through the UI.
- [ ] A server-side validation error renders against the offending field rather than as a toast.
- [ ] Rows created in the UI appear in `npm run db:studio`.

---

## E1.3 — Credential references · `TODO`

**Goal:** a test can log in without a secret ever entering the database.

**Depends on:** E1.1.

**Deliverables**

- `Environment.credentialRefs` stores **environment variable names**, never values: `{ usernameEnv: 'DEMO_USER', passwordEnv: 'DEMO_PASSWORD' }`.
- A resolver used by the runner (Phase 3) that reads `process.env[name]` at execution time and fails loudly, naming the variable, when it is unset.
- The UI labels these fields as variable names and shows the resolved/unresolved state — **never** the value.
- A step's `data` field may hold a credential reference rather than a literal, so recorded passwords never land in a spec.
- Redaction in logs and evidence: resolved credential values are replaced with `***` in step logs, error messages, and recorded network payloads.

**Security note:** this is the one place in the MVP where a mistake leaks something real. Secrets stay in the process environment. They must not reach SQLite, the evidence directory, the report output, or the LLM prompt context. The redaction pass is part of this epic, not a follow-up — evidence files are written to disk and shared, and a password captured in a `network.json` is a leak that outlives the run.

**Acceptance**

- [ ] A recorded login stores `passwordEnv`, and the spec contains no password.
- [ ] An unset variable fails the run with a message naming the variable, before the browser opens.
- [ ] A grep of `data/evidence/` after a login run finds no credential value.
- [ ] Credential values do not appear in any `LlmCall` prompt payload.
