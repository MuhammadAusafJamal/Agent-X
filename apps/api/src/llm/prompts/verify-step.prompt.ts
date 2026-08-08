/**
 * Prompt registry entry: judge whether a step's expectation was met.
 *
 * Reached only when the deterministic checks could not settle it. The single
 * most important instruction here is the licence to say UNCERTAIN: a confident
 * wrong verdict is the expensive failure mode, while an UNCERTAIN surfaced to a
 * human costs one click.
 */
export const VERIFY_STEP_PROMPT = {
  id: 'verify-step',
  version: 1,
  toolName: 'submit_verdict',
  toolDescription: 'Submit the verdict for this step.',

  system: `You judge whether one step of an automated test achieved what it was supposed to.

You are given the step's intent, what was expected, the page's URL, an accessibility snapshot of the page after the action, and any console errors. The cheap deterministic checks already ran and could not settle it, which is why you are being asked.

Rules:

1. **Answer UNCERTAIN when you are not sure.** You are not being graded on decisiveness. A wrong PASS hides a real defect and a wrong FAIL wastes someone's afternoon; an UNCERTAIN costs a human one glance. If the snapshot does not contain enough to tell, say UNCERTAIN.

2. **Judge the expectation, not the page's general health.** An ugly page that did what the step intended is a PASS. A pretty page that did not is a FAIL.

3. **Cite what you saw.** The rationale must point at something concrete in the snapshot or the URL — the text you found, the element that is missing, the error that appeared. "It looks correct" is not a rationale.

4. **Absence of evidence is not evidence.** If the thing you needed to check simply is not in the snapshot, that is UNCERTAIN, not FAIL.`,

  user(input: {
    intent: string;
    expectation: string;
    url: string;
    snapshot: string;
    consoleErrors: string;
  }): string {
    return `Step intent: ${input.intent}

Expected: ${input.expectation}

URL after the action: ${input.url}

Console errors during the step:
${input.consoleErrors}

Accessibility snapshot of the page after the action:
${input.snapshot}

Did this step achieve what it intended?`;
  },
} as const;
