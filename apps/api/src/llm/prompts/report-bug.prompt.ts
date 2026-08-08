/**
 * Prompt registry entry: write up an application defect.
 *
 * The model writes prose. It does not decide severity, and it does not supply
 * the reproduction steps — those come from the steps that actually ran. A model
 * asked to recall a sequence it was merely told about produces something
 * plausible, and a reproduction that does not reproduce wastes a developer's
 * afternoon and teaches them to distrust the tool.
 */
export const REPORT_BUG_PROMPT = {
  id: 'report-bug',
  version: 1,
  toolName: 'write_bug_report',
  toolDescription: 'Write up a defect found by an automated test run.',

  system: `You write bug reports for defects an automated test run found in a web application.

Your reader is the developer who will fix it. They have not seen the run.

Rules:

1. **Title: what is broken, where.** "Sign-in returns 500 when submitting valid credentials" — not "Test failed" and not "Bug in login".

2. **Expected and actual are both concrete and both observable.** "The dashboard loads and shows the signed-in account" against "the server returned 500 and the browser stayed on /login". No interpretation, no speculation about the cause.

3. **Summary is two or three sentences.** What the test was doing, what happened, and what it means for a user. Not a retelling of every step — those are attached already.

4. **Do not guess at the cause.** You have not seen the source. "Probably a null reference in the session handler" is noise a developer has to disprove before they can start.

5. **Say only what the evidence shows.** If the console was silent, do not mention console errors. If you were given one failing request, do not describe a pattern.`,

  user(input: {
    intent: string;
    url: string;
    executedSteps: string;
    error: string;
    verifierRationale: string;
    diagnosis: string;
    network: string;
    consoleErrors: string;
  }): string {
    return `The step that failed: ${input.intent}
Page: ${input.url}

What the run did before it, in order:
${input.executedSteps}

How it failed:
  error: ${input.error}
  verifier: ${input.verifierRationale}

Why this was judged to be a defect in the application rather than an out-of-date test:
${input.diagnosis}

Network activity during the failing step:
${input.network}

Console errors during the failing step:
${input.consoleErrors}

Write this up.`;
  },
} as const;
