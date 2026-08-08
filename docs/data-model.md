# Data model

One SQLite database owned by the API, at `data/agentx.db`, accessed through Prisma. This document is the source of truth for `apps/api/prisma/schema.prisma` and for the zod schemas in `packages/shared`. **17 models.**

## Two SQLite constraints that shape everything below

**1. Prisma does not support `enum` on SQLite.** Every enum-typed field is a `String` column. The allowed values are defined once as a zod enum in `@agentx/shared` and validated at every boundary. The database will happily store garbage in these columns; the shared schemas are what stop it.

**2. Prisma has no `Json` type on SQLite.** Every structured field is a `String` column holding JSON. Reads and writes go **only** through the parse helpers in `@agentx/shared` — a bare `JSON.parse(row.targetHints) as TargetHints` anywhere is a bug, because it casts instead of parsing.

JSON-bearing columns are marked **`json`** in the tables below. Enum-backed columns are marked **`enum`** and link to the value list at the bottom.

## Entities

### Catalog

**Project**

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String | cuid, PK |
| `name` | String | |
| `description` | String? | |
| `createdAt` / `updatedAt` | DateTime | |

**Application** — a website under test. Belongs to a project.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String | cuid, PK |
| `projectId` | String | FK → Project, cascade delete |
| `name` | String | |
| `baseUrl` | String | |
| `description` | String? | context fed to the LLM ("a B2B invoicing app") |

**Environment** — a deployment of an application (local, staging).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String | cuid, PK |
| `applicationId` | String | FK → Application, cascade |
| `name` | String | |
| `baseUrl` | String | overrides `Application.baseUrl` |
| `credentialRefs` | String **json** | `{ usernameEnv, passwordEnv, extra }` — **environment variable *names*, never values** |

> Secrets never enter SQLite. `credentialRefs` stores the *name* of an env var; the runner reads `process.env[name]` at execution time. This keeps credentials out of the database file, out of backups, and out of git.

### Recording

**Recording**

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String | cuid, PK |
| `applicationId` | String | FK → Application |
| `environmentId` | String? | FK → Environment |
| `startUrl` | String | |
| `status` | String **enum** | `RecordingStatus` |
| `startedAt` | DateTime | |
| `stoppedAt` | DateTime? | |
| `error` | String? | |

**RecordedEvent** — one captured human action, with the context that makes it interpretable.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String | cuid, PK |
| `recordingId` | String | FK → Recording, cascade |
| `index` | Int | ordering within the recording |
| `type` | String **enum** | `RecordedEventType` |
| `url` | String | page URL at capture time |
| `timestamp` | DateTime | |
| `value` | String? | typed text, selected option |
| `targetRole` | String? | ARIA role |
| `targetName` | String? | accessible name |
| `targetText` | String? | visible text |
| `targetTestId` | String? | `data-testid` |
| `landmark` | String? | enclosing landmark/section, for disambiguation |
| `bbox` | String? **json** | `{ x, y, width, height }` |
| `selectorCandidates` | String **json** | ranked `{ strategy, value, score }[]` |
| `a11yRef` | String? | artifact path — pruned accessibility snapshot |
| `screenshotRef` | String? | artifact path |

`@@unique([recordingId, index])`

### Specification

**TestSpec** — a named test. Stable identity across versions.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String | cuid, PK |
| `applicationId` | String | FK → Application, cascade |
| `name` | String | |
| `description` | String? | |
| `source` | String **enum** | `SpecSource` |
| `currentVersionId` | String? | FK → TestVersion |

**TestVersion** — **immutable**. Editing a spec or approving a heal writes a new version; nothing edits a version in place. This is what makes healing auditable.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String | cuid, PK |
| `specId` | String | FK → TestSpec, cascade |
| `version` | Int | monotonic per spec |
| `source` | String **enum** | `SpecSource` — how this version came to exist |
| `note` | String? | e.g. "healed: login button renamed" |
| `recordingId` | String? | provenance, if compiled from a recording |
| `createdAt` | DateTime | |

`@@unique([specId, version])`

**TestStep** — one intent, not one selector.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String | cuid, PK |
| `versionId` | String | FK → TestVersion, cascade |
| `index` | Int | |
| `intent` | String | human-readable: "sign in as the seeded user" |
| `action` | String **enum** | `ActionType` |
| `targetDescription` | String? | natural language: "the primary submit button in the login form" |
| `targetHints` | String **json** | `{ role, name, testId, text, landmark, selectorCandidates[] }` — **fallbacks, not the primary key** |
| `data` | String? **json** | typed value, option, file path, or an env-var reference for secrets |
| `expectation` | String **json** | `{ kind, ... }` — see `Expectation` below |
| `optional` | Boolean | a failure here does not fail the run |

`@@unique([versionId, index])`

### Execution

**Execution**

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String | cuid, PK |
| `specId` / `versionId` | String | FK — the exact version that ran |
| `environmentId` | String | FK → Environment |
| `mode` | String **enum** | `ExecutionMode` |
| `status` | String **enum** | `ExecutionStatus` |
| `startedAt` / `finishedAt` | DateTime / DateTime? | |
| `cancelRequested` | Boolean | cooperative cancellation flag |
| `summary` | String? | one-line roll-up |
| `error` | String? | |

**ExecutionStep** — the per-step record, and the training signal for the resolver.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String | cuid, PK |
| `executionId` | String | FK → Execution, cascade |
| `stepId` | String? | FK → TestStep. Null for steps an agent invented (explore mode) |
| `index` | Int | |
| `intent` / `action` | String / String **enum** | denormalized so a run reads standalone |
| `status` | String **enum** | `StepStatus` |
| `resolutionStrategy` | String? **enum** | `ResolutionStrategy` — which rung of the ladder won |
| `resolvedSelector` | String? | what actually matched |
| `candidateCount` | Int? | how ambiguous the lookup was |
| `confidence` | Float? | 0–1 |
| `attempts` | Int | |
| `durationMs` | Int? | |
| `verifierRationale` | String? | why the verifier ruled as it did |
| `error` | String? | |

> `resolutionStrategy` + `candidateCount` are not diagnostics — they are the feedback loop. A step that has needed the `LLM` rung three runs running has stale hints, and the knowledge consolidation pass acts on exactly that signal.

**Observation** — what the page looked like around a step.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String | cuid, PK |
| `executionStepId` | String | FK → ExecutionStep, cascade |
| `kind` | String **enum** | `ObservationKind` |
| `payload` | String **json** | small inline data (URL, status codes, console lines) |
| `artifactId` | String? | FK → Artifact, for anything large |

**Artifact** — a file on disk. Path is **relative** to `EVIDENCE_DIR` so the directory stays portable.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String | cuid, PK |
| `executionId` / `recordingId` / `executionStepId` | String? | FK — exactly one is set |
| `kind` | String **enum** | `ArtifactKind` |
| `relPath` | String | e.g. `<executionId>/step-3/shot.png` |
| `bytes` | Int? | |

### Intelligence

**KnowledgeItem** — what we have learned about an application.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String | cuid, PK |
| `applicationId` | String | FK → Application, cascade |
| `kind` | String **enum** | `KnowledgeKind` |
| `key` | String | stable lookup key, e.g. `login.submit` |
| `value` | String **json** | shape depends on `kind` |
| `confidence` | Float | 0–1, rises on hit, decays on miss and with age |
| `hitCount` / `missCount` | Int | |
| `lastSeenAt` | DateTime | |

`@@unique([applicationId, kind, key])`

**HealingRecord**

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String | cuid, PK |
| `executionStepId` | String | FK → ExecutionStep |
| `specVersionId` | String | FK → TestVersion — the version that drifted |
| `diagnosis` | String **enum** | `Diagnosis` |
| `originalTarget` | String **json** | |
| `proposedTarget` | String **json** | |
| `rationale` | String | |
| `status` | String **enum** | `HealingStatus` |
| `reverifyStatus` | String? **enum** | `StepStatus` after the in-run reverify |
| `appliedToVersionId` | String? | FK → TestVersion — the new version approval produced |
| `reviewedAt` | DateTime? | |

**BugReport**

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String | cuid, PK |
| `executionId` / `executionStepId` | String / String? | FK |
| `title` | String | |
| `severity` | String **enum** | `Severity` |
| `summary` | String | |
| `reproSteps` | String **json** | ordered strings |
| `expected` / `actual` | String | |
| `evidenceRefs` | String **json** | artifact ids |
| `status` | String **enum** | `BugStatus` |

**LlmCall** — audit trail. Every model call, linked to what caused it.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String | cuid, PK |
| `executionId` / `recordingId` | String? | FK |
| `promptId` / `promptVersion` | String / Int | which registry prompt produced this decision |
| `model` | String | |
| `inputTokens` / `outputTokens` | Int | |
| `latencyMs` | Int | |
| `costUsd` | Float? | |
| `ok` | Boolean | |
| `error` | String? | |

**Report**

| Field | Type | Notes |
| --- | --- | --- |
| `id` | String | cuid, PK |
| `executionId` | String | FK, **unique** |
| `markdown` | String | |
| `json` | String **json** | machine-readable summary |

## Enum values

Defined as zod enums in `@agentx/shared`, stored as `String`.

| Enum | Values |
| --- | --- |
| `RecordingStatus` | `RECORDING` `STOPPED` `FAILED` |
| `RecordedEventType` | `NAVIGATE` `CLICK` `INPUT` `SELECT` `SCROLL` `KEY` `SUBMIT` |
| `SpecSource` | `RECORDED` `MANUAL` `HEALED` `EXPLORED` |
| `ActionType` | `NAVIGATE` `CLICK` `FILL` `SELECT` `PRESS` `SCROLL` `HOVER` `UPLOAD` `WAIT` `ASSERT` |
| `ExecutionMode` | `REPLAY` `EXPLORE` |
| `ExecutionStatus` | `PENDING` `RUNNING` `PASSED` `FAILED` `UNCERTAIN` `CANCELLED` `ERROR` |
| `StepStatus` | `PENDING` `RUNNING` `PASS` `FAIL` `UNCERTAIN` `HEALED` `SKIPPED` |
| `ResolutionStrategy` | `KNOWLEDGE` `ROLE_NAME` `TEST_ID` `TEXT` `CSS` `LLM` `VISION` |
| `ObservationKind` | `URL` `DOM` `A11Y` `NETWORK` `CONSOLE` `SCREENSHOT` |
| `ArtifactKind` | `SCREENSHOT` `DOM` `A11Y` `NETWORK` `CONSOLE` `VIDEO` `TRACE` |
| `KnowledgeKind` | `ELEMENT_ALIAS` `FLOW` `SELECTOR_MEMORY` `DOMAIN_FACT` |
| `Diagnosis` | `APP_BUG` `TEST_DRIFT` `ENVIRONMENT` `FLAKE` `UNKNOWN` |
| `HealingStatus` | `PROPOSED` `APPLIED` `APPROVED` `REJECTED` `REVERIFY_FAILED` |
| `Severity` | `CRITICAL` `HIGH` `MEDIUM` `LOW` |
| `BugStatus` | `OPEN` `ACKNOWLEDGED` `DISMISSED` |

## Key JSON shapes

```ts
TargetHints = {
  role?: string
  name?: string
  testId?: string
  text?: string
  landmark?: string
  selectorCandidates: { strategy: ResolutionStrategy; value: string; score: number }[]
}

Expectation =
  | { kind: 'URL';           match: 'exact' | 'prefix' | 'pattern'; value: string }
  | { kind: 'VISIBLE';       description: string; hints?: TargetHints }
  | { kind: 'NOT_VISIBLE';   description: string; hints?: TargetHints }
  | { kind: 'TEXT';          value: string; scope?: string }
  | { kind: 'NETWORK_OK';    urlPattern?: string; maxStatus?: number }
  | { kind: 'NO_CONSOLE_ERRORS' }
  | { kind: 'SEMANTIC';      description: string }   // routed to the LLM verifier

KnowledgeValue =
  | { kind: 'ELEMENT_ALIAS';   description: string; role?: string; name?: string; selector: string }
  | { kind: 'SELECTOR_MEMORY'; stepKey: string; selector: string; strategy: ResolutionStrategy }
  | { kind: 'FLOW';            name: string; steps: string[] }
  | { kind: 'DOMAIN_FACT';     statement: string }
```

## SSE event union

One discriminated union in `@agentx/shared`, consumed by the dashboard's `useEventStream` hook.

```ts
RecordingEvent =
  | { type: 'recording.started';  recordingId, startUrl }
  | { type: 'recording.event';    event: RecordedEvent }
  | { type: 'recording.stopped';  recordingId, eventCount }
  | { type: 'recording.error';    message }

ExecutionEvent =
  | { type: 'execution.started';   executionId, stepCount }
  | { type: 'execution.step';      step: ExecutionStep }
  | { type: 'execution.observation'; stepId, kind, artifactId? }
  | { type: 'execution.healing';   healing: HealingRecord }
  | { type: 'execution.finished';  executionId, status, summary }
  | { type: 'execution.error';     message }
```
