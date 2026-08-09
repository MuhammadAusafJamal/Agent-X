/**
 * The one place raw enum values become words a person can read.
 *
 * Before this, the dashboard rendered `TEST_DRIFT`, `ROLE_NAME`, and `APP_BUG`
 * as bare badges with no legend anywhere. Those are internal vocabulary: they
 * mean something precise, and a QA looking at their first run has no way to
 * learn what. Every one of them now carries a label and a sentence saying why
 * it matters, defined once so two screens cannot disagree — which they did,
 * with the healing queue humanising a status the report printed raw.
 *
 * Keyed by enum *name* rather than by value on purpose: a step's `PASS` and a
 * run's `PASSED` are different things and must be free to read differently.
 */

interface Entry {
  label: string;
  /** One sentence, shown on hover. Omitted where the label says everything. */
  explain?: string;
}

const VOCAB = {
  resolutionStrategy: {
    KNOWLEDGE: {
      label: "Remembered",
      explain:
        "Found where it worked last time. The cheapest outcome there is — no model call.",
    },
    ROLE_NAME: {
      label: "By role and name",
      explain:
        "Found the way a screen reader would: a button called “Continue”, not a CSS path.",
    },
    TEST_ID: {
      label: "By test id",
      explain: "Found by the data-testid the application publishes for tests.",
    },
    TEXT: {
      label: "By visible text",
      explain: "Found by the words on the control itself.",
    },
    CSS: {
      label: "By CSS selector",
      explain:
        "Found by a recorded selector. The most brittle rung — it breaks when the markup moves.",
    },
    LLM: {
      label: "Model found it",
      explain:
        "Nothing recorded matched, so the model was shown the page and asked. Costs a model call, and means the specification's own hints have drifted.",
    },
    VISION: {
      label: "Model looked at the screenshot",
      explain: "Resolved from the rendered page rather than from its markup.",
    },
  },

  diagnosis: {
    APP_BUG: {
      label: "App bug",
      explain:
        "The application is wrong, not the test. This is never healed — a bug report is filed instead.",
    },
    TEST_DRIFT: {
      label: "Test drift",
      explain:
        "The application changed shape and the test's targeting went stale. The application is fine, so this is the only class that may be repaired.",
    },
    ENVIRONMENT: {
      label: "Environment",
      explain:
        "Something outside the application failed — an unreachable host, a refused page load.",
    },
    FLAKE: {
      label: "Flaky",
      explain:
        "It failed, then passed on a second look without anything being changed.",
    },
    UNKNOWN: {
      label: "Unclear",
      explain:
        "The failure could not be classified. Never healed — an unclassified failure goes to a person.",
    },
  },

  stepStatus: {
    PENDING: { label: "Queued" },
    RUNNING: { label: "Running" },
    PASS: { label: "Passed" },
    FAIL: { label: "Failed" },
    HEALED: {
      label: "Healed",
      explain:
        "Failed, was re-targeted mid-run, and then passed. The repair is waiting for review.",
    },
    UNCERTAIN: {
      label: "Needs you",
      explain:
        "The verifier could not settle this either way, so it is asking rather than guessing.",
    },
    SKIPPED: { label: "Skipped" },
  },

  executionStatus: {
    PENDING: {
      label: "Queued",
      explain: "Waiting for the runner. Runs go one at a time.",
    },
    RUNNING: { label: "Running" },
    PASSED: { label: "Passed" },
    FAILED: { label: "Failed" },
    UNCERTAIN: {
      label: "Needs you",
      explain: "At least one step could not be settled without a person.",
    },
    ERROR: {
      label: "Errored",
      explain: "The run itself could not complete — no verdict was reached.",
    },
    CANCELLED: { label: "Cancelled" },
  },

  healingStatus: {
    PROPOSED: {
      label: "Proposed",
      explain: "Suggested but not proven — the run did not get to try it.",
    },
    APPLIED: {
      label: "Proven in the run",
      explain:
        "The repair was applied mid-run and the step then verified. It still needs approval to enter the specification.",
    },
    APPROVED: {
      label: "Approved",
      explain: "Accepted into a new version of the specification.",
    },
    REJECTED: {
      label: "Rejected",
      explain: "Declined. The specification is untouched, so the next run fails the same way.",
    },
    REVERIFY_FAILED: {
      label: "Repair did not work",
      explain:
        "The proposed target was tried and the step still did not pass, so it never reached the queue.",
    },
  },

  severity: {
    CRITICAL: { label: "Critical" },
    HIGH: { label: "High" },
    MEDIUM: { label: "Medium" },
    LOW: { label: "Low" },
  },

  bugStatus: {
    OPEN: { label: "Open" },
    ACKNOWLEDGED: { label: "Acknowledged" },
    DISMISSED: { label: "Dismissed" },
  },

  specSource: {
    RECORDED: { label: "From a recording" },
    MANUAL: { label: "Hand-written" },
    HEALED: { label: "From an approved repair" },
    EXPLORED: {
      label: "From an exploration",
      explain:
        "Proposed by the explorer agent. Never trusted until a person reviews it.",
    },
  },

  knowledgeKind: {
    SELECTOR_MEMORY: {
      label: "Remembered selector",
      explain: "Where a target was last found successfully.",
    },
    ELEMENT_ALIAS: { label: "Element alias" },
    FLOW: {
      label: "Known flow",
      explain: "A journey through the application that the agent has walked.",
    },
    DOMAIN_FACT: { label: "Domain fact" },
  },

  recordingStatus: {
    RECORDING: { label: "Recording" },
    STOPPED: { label: "Stopped" },
    FAILED: { label: "Failed" },
  },

  exploreStopReason: {
    GOAL_REACHED: { label: "Reached the goal" },
    STEP_BUDGET: { label: "Ran out of steps" },
    TIME_BUDGET: { label: "Ran out of time" },
    MODEL_BUDGET: { label: "Ran out of model calls" },
    STUCK: {
      label: "Got stuck",
      explain:
        "Four moves in a row were refused, so it stopped rather than spending the rest of its budget re-proposing them.",
    },
    ERROR: { label: "Errored" },
  },
} as const satisfies Record<string, Record<string, Entry>>;

export type VocabKind = keyof typeof VOCAB;

/** The human label, falling back to the raw value rather than to nothing. */
export function label(kind: VocabKind, value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return entry(kind, value)?.label ?? value;
}

/** The sentence behind a label, or null where the label says it all. */
export function explain(
  kind: VocabKind,
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  return entry(kind, value)?.explain ?? null;
}

function entry(kind: VocabKind, value: string): Entry | undefined {
  return (VOCAB[kind] as Record<string, Entry | undefined>)[value];
}

/**
 * Confidence below which a remembered fact is skipped rather than tried.
 *
 * Mirrors `CONFIDENCE_FLOOR` in the API's `knowledge/confidence.ts`. It was
 * previously hand-copied into the knowledge screen as a bare `0.3` with no note
 * saying where it came from.
 */
export const TRUST_FLOOR = 0.3;

/** Terms the UI uses that have no enum behind them. */
export const GLOSSARY: Record<string, string> = {
  "intent specification":
    "A test written as intent — “sign in as the seeded user” — rather than as selectors. The agent works out what to click each time it runs.",
  drift:
    "The application changed shape, so the test no longer finds what it is pointing at. The application is not broken; the test's targeting is.",
  healing:
    "A repair the agent proposes for a drifted step. Approving one writes a new version of the specification; the version that drifted is never edited.",
  version:
    "An immutable snapshot of a specification's steps. Editing writes the next version and leaves the previous one byte-identical, so any change can be reviewed or undone.",
  landmark:
    "The region a control sits in — a form, a navigation bar, a dialog. It is what tells two identical “Continue” buttons apart.",
  evidence:
    "What a run captured at each step: a screenshot, the page structure, the network calls, and the console.",
  knowledge:
    "What the agent has learned about one application. Scoped to that application and never reused across others.",
};
