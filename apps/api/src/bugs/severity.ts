import type { Severity } from '@agentx/shared';

/**
 * How bad a defect is, from what actually happened.
 *
 * Deliberately mechanical. Severity decides what a team looks at first, and a
 * model asked to grade its own findings grades on how alarming the failure
 * *read*, not on what it cost — which is how everything ends up HIGH and the
 * field stops carrying information.
 */

export interface SeveritySignals {
  /** Responses the server itself failed on, during the failing step. */
  serverErrors: number;
  consoleErrors: number;
  /** The run stopped here: nothing after this step could be exercised. */
  blockedFlow: boolean;
  /** The specification marked this step as not load-bearing. */
  optional: boolean;
}

export function severityOf(signals: SeveritySignals): Severity {
  // The specification itself says a failure here does not fail the run. Grading
  // it above LOW would mean overruling the person who wrote the test.
  if (signals.optional) return 'LOW';

  // The application errored *and* the user could go no further.
  if (signals.serverErrors > 0 && signals.blockedFlow) return 'CRITICAL';

  if (signals.serverErrors > 0) return 'HIGH';

  // No server error, but the flow is dead. A silent wall is still a wall.
  if (signals.blockedFlow) return 'HIGH';

  return 'MEDIUM';
}
