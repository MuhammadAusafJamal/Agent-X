/**
 * Prompt registry entry: decide why a step failed.
 *
 * Reached only when the deterministic signals could not settle it — a 500 or an
 * unreachable host never gets here. What is left is the genuinely ambiguous
 * case: a healthy page where either the application changed its behaviour or the
 * specification stopped describing it, and telling those apart is the judgement
 * this phase is built around.
 */
export const DIAGNOSE_FAILURE_PROMPT = {
  id: 'diagnose-failure',
  version: 1,
  toolName: 'classify_failure',
  toolDescription: 'Say why this test step failed.',

  system: `You decide why an automated test step failed against a web application.

Answer with exactly one of:

- **TEST_DRIFT** — the application is working; the test is out of date. The control it wanted was renamed, moved, or duplicated, and an equivalent one is plainly there doing the same job.
- **APP_BUG** — the test is fair and the application did the wrong thing. It errored, lost data, showed the wrong outcome, or blocked a flow that should work.
- **ENVIRONMENT** — neither was exercised properly. The wrong build, missing seed data, a rejected login at the boundary, a service that is not running.
- **UNKNOWN** — the evidence does not support any of the above.

Rules:

1. **UNKNOWN is a real answer and costs nothing.** It routes the failure to a person. A confident wrong classification does not: TEST_DRIFT sends this to a healer that will rewrite the test until it passes, and if the application was actually broken you have just produced a green run over a real defect. When the evidence is thin, say UNKNOWN.

2. **TEST_DRIFT requires a replacement you can point at.** "The button is probably somewhere" is not drift. Name the control in the snapshot that does the job the step wanted. If nothing in the snapshot does that job, this is not drift.

3. **A step that failed to *find* something is not automatically drift.** A missing control is also what a broken page looks like — a form that failed to render, a section that errored out. Check the snapshot for whether the rest of the page is intact.

4. **A wrong outcome after a successful action is rarely drift.** The test found what it wanted and asked for it; if the result was wrong, the application is the thing that produced it.

5. **Cite the evidence.** Your rationale must point at something concrete — a name in the snapshot, a console error, a URL. Restating the category is not a rationale.`,

  user(input: {
    intent: string;
    targetDescription: string;
    action: string;
    url: string;
    error: string;
    verifierRationale: string;
    signals: string;
    priorSteps: string;
    knowledge: string;
    snapshot: string;
  }): string {
    return `The step that failed:

  intent: ${input.intent}
  action: ${input.action}
  target: ${input.targetDescription}
  page: ${input.url}
  error: ${input.error}
  verifier: ${input.verifierRationale}

Evidence gathered during the step:
${input.signals}

Steps that passed before it:
${input.priorSteps}

What is already known about this application:
${input.knowledge}

Accessibility snapshot of the page as it is now:
${input.snapshot}

Why did this step fail?`;
  },
} as const;
