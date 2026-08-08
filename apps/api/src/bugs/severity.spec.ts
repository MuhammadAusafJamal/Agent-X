import { severityOf, type SeveritySignals } from './severity';

/**
 * Severity is arithmetic, not opinion.
 *
 * The reason it is computed rather than asked for: a grader that reads the
 * failure decides on how alarming it sounded, everything comes out HIGH, and the
 * field stops telling anyone what to look at first.
 */
describe('Bug severity', () => {
  const signals = (
    overrides: Partial<SeveritySignals> = {},
  ): SeveritySignals => ({
    serverErrors: 0,
    consoleErrors: 0,
    blockedFlow: false,
    optional: false,
    ...overrides,
  });

  it('is CRITICAL when the server errored and the flow died there', () => {
    expect(severityOf(signals({ serverErrors: 1, blockedFlow: true }))).toBe(
      'CRITICAL',
    );
  });

  it('is HIGH for a server error that did not block the run', () => {
    expect(severityOf(signals({ serverErrors: 1 }))).toBe('HIGH');
  });

  it('is HIGH for a blocked flow with no server error — a silent wall is still a wall', () => {
    expect(severityOf(signals({ blockedFlow: true }))).toBe('HIGH');
  });

  it('is MEDIUM for a wrong outcome on a working server', () => {
    expect(severityOf(signals({ consoleErrors: 2 }))).toBe('MEDIUM');
  });

  it('is LOW on an optional step, however loud the failure', () => {
    // The specification itself says a failure here does not fail the run.
    // Grading it higher would be overruling whoever wrote the test.
    expect(
      severityOf(
        signals({ optional: true, serverErrors: 3, blockedFlow: true }),
      ),
    ).toBe('LOW');
  });
});
