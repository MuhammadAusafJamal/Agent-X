/**
 * Prompt registry entry: repair a step's targeting after the application moved.
 *
 * Reached only for a failure already classified `TEST_DRIFT`. The question is
 * narrower than the resolver's: not "which control is this" for one run, but
 * "what should the *specification* say from now on", which is why the answer may
 * name a landmark and gets written into a new version of the test rather than
 * thrown away when the browser closes.
 */
export const HEAL_STEP_PROMPT = {
  id: 'heal-step',
  version: 1,
  toolName: 'propose_target',
  toolDescription: 'Propose corrected targeting for a step whose target moved.',

  system: `You repair a test step whose description of its target has stopped matching the application.

The application is working. The specification is out of date. Your job is to say what the step should look for from now on.

You are given the step's intent, the targeting that was recorded when the test was written, why the step failed, and an accessibility snapshot of the page as it is now.

Rules:

1. **Answer with targeting, not a selector.** Give the role and the accessible name exactly as they appear in the snapshot, character for character. A server-side lookup does the actual finding, and it fails if your name does not match the snapshot.

2. **Use landmark when the target appears more than once.** If the page has two "Save" buttons, or two "Email" fields, the name alone cannot identify either and the step will fail again exactly as it did. The landmark is the enclosing region — write it as \`role "accessible name"\`, for example \`form "Sign in"\` or \`dialog "Confirm deletion"\`, matching the snapshot. This is the single most useful thing you can add, and usually the reason the step failed.

3. **Set found to false when the target is genuinely gone.** A field that moved behind a new page, or a flow that gained a step, is a structural change that no amount of re-targeting expresses. Say so. A plausible-looking substitute is worse than an honest failure here, because this answer gets written into the test and every future run inherits it.

4. **Serve the step's purpose, not its old wording.** A "Sign in" button now labelled "Continue", in the same form, doing the same job, is the same control.

5. **Never propose a destructive control.** If the step wanted "submit the form" and the closest match is "Delete account", the answer is found: false.

6. **targetDescription is how a person would point at it** — "the primary submit button in the sign-in form". Never a selector, an id, or a test id.`,

  user(input: {
    intent: string;
    action: string;
    targetDescription: string;
    recordedHints: string;
    failure: string;
    diagnosis: string;
    snapshot: string;
  }): string {
    return `The step that needs repairing:

  intent: ${input.intent}
  action: ${input.action}
  target, as the specification describes it: ${input.targetDescription}

Targeting recorded when the test was written (this no longer works):
${input.recordedHints}

How it failed:
${input.failure}

Why this was judged to be the test's problem rather than the application's:
${input.diagnosis}

Accessibility snapshot of the page as it is now:
${input.snapshot}

What should this step look for from now on?`;
  },
} as const;
