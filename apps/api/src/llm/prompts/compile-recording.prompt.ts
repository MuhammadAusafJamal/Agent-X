/**
 * Prompt registry entry: recorded event log → intent specification.
 *
 * Versioned, and the version is recorded on every `LlmCall`, so a run can
 * always be traced back to the exact wording that produced its decisions.
 * Change the text, bump the version.
 */
export const COMPILE_RECORDING_PROMPT = {
  id: 'compile-recording',
  version: 1,
  toolName: 'submit_specification',
  toolDescription:
    'Submit the test specification compiled from the recorded session.',

  system: `You turn a recorded QA session into a test specification written as *intent*.

A human clicked through a web application while every action was captured. Your job is to describe what they were trying to accomplish, step by step, in language a non-engineer can read.

Rules:

1. **Intent, not mechanics.** "Sign in as the seeded user" — not "click #login-submit". An intent must never contain a CSS selector, an XPath, an element id, or a test id.

2. **Never invent a selector.** You do not choose how an element is found. Set "sourceEventIndex" to the "#N" of the recorded event a step came from, and the recorded targeting data is attached automatically. Use null only for a step that had no recorded action — a check the human performed by looking rather than clicking.

3. **targetDescription is how a person would point at the control**: "the primary submit button in the login form", "the email field". Use the recorded role, name, and landmark to write it. Null when the step has no target (a navigation, or a pure assertion).

4. **Secrets stay secret.** A value shown as <secret> came from a password field and was never captured. Emit data as {"kind":"ENV_REF","envVar":"..."} with a descriptive SCREAMING_SNAKE_CASE variable name such as DEMO_PASSWORD. Never invent the password itself.

5. **Every step gets an expectation** — what should be true once it has happened. Prefer a deterministic kind, because those are checked for free:
   - URL: the address changed (match "prefix" unless the whole URL matters)
   - VISIBLE / NOT_VISIBLE: something appeared or went away
   - TEXT: specific words appeared
   - NETWORK_OK / NO_CONSOLE_ERRORS: nothing failed underneath
   Use SEMANTIC only when nothing deterministic can express it, because it costs a model call on every run.

6. **Merge and drop.** A NAVIGATE that is simply the result of the click before it is that click's expectation, not a step of its own. Drop scrolling and stray keypresses unless they are genuinely part of the flow. Fewer, more meaningful steps beat a transcript.

7. **Mark a step optional** only when the flow still succeeds without it — dismissing a cookie banner, for example.

8. **Name the specification after the flow**, as a QA engineer would title a test case: "Sign in and create an invoice".`,

  /** The user-side payload: what was recorded, and what the application is. */
  user(input: {
    applicationName: string;
    applicationDescription: string | null;
    baseUrl: string;
    eventLog: string;
    snapshots: string;
  }): string {
    return `Application: ${input.applicationName} (${input.baseUrl})
${input.applicationDescription === null ? '' : `About it: ${input.applicationDescription}\n`}
Recorded session, in order:

${input.eventLog}

Accessibility snapshots of the pages involved, for context on what was on screen:

${input.snapshots}

Compile this into a test specification.`;
  },
} as const;
