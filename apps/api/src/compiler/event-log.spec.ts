import type { RecordedEvent } from '@agentx/shared';
import { buildEventLog, formatSnapshots, selectSnapshots } from './event-log';

function event(
  overrides: Partial<RecordedEvent> & { index: number },
): RecordedEvent {
  return {
    id: `e${overrides.index}`,
    recordingId: 'r1',
    type: 'CLICK',
    url: 'http://localhost:4321/',
    timestamp: '2026-08-08T00:00:00.000Z',
    value: null,
    isSecret: false,
    targetRole: null,
    targetName: null,
    targetText: null,
    targetTestId: null,
    landmark: null,
    bbox: null,
    selectorCandidates: [],
    a11yRef: null,
    screenshotRef: null,
    ...overrides,
  };
}

describe('buildEventLog', () => {
  it('prints the url only when it changes', () => {
    const log = buildEventLog([
      event({ index: 0, type: 'NAVIGATE' }),
      event({ index: 1, type: 'CLICK' }),
      event({
        index: 2,
        type: 'NAVIGATE',
        url: 'http://localhost:4321/dashboard',
      }),
    ]);

    const lines = log.split('\n');

    expect(lines[0]).toContain('url=http://localhost:4321/');
    // Repeating an unchanged URL on every line is pure token cost.
    expect(lines[1]).not.toContain('url=');
    expect(lines[2]).toContain('url=http://localhost:4321/dashboard');
  });

  it('includes role, name, test id, and landmark', () => {
    const log = buildEventLog([
      event({
        index: 0,
        targetRole: 'button',
        targetName: 'Sign in',
        targetTestId: 'login-submit',
        landmark: 'form "Sign in"',
      }),
    ]);

    expect(log).toBe(
      '#0 CLICK url=http://localhost:4321/ role=button name="Sign in" testid=login-submit in="form \\"Sign in\\""',
    );
  });

  it('marks a secret rather than omitting it silently', () => {
    // The model has to know a value existed and was withheld, or it cannot know
    // to emit a credential reference.
    const log = buildEventLog([
      event({ index: 0, type: 'INPUT', isSecret: true, value: null }),
    ]);

    expect(log).toContain('value=<secret>');
  });

  it('truncates a very long value', () => {
    const log = buildEventLog([
      event({ index: 0, type: 'INPUT', value: 'x'.repeat(500) }),
    ]);

    expect(log.length).toBeLessThan(300);
    expect(log).toContain('…');
  });
});

describe('selectSnapshots', () => {
  it('keeps the last snapshot per page, ignoring query strings', () => {
    const selected = selectSnapshots([
      event({ index: 0, a11yRef: 'a.yaml' }),
      event({ index: 1, a11yRef: 'b.yaml' }),
      event({
        index: 2,
        url: 'http://localhost:4321/dashboard?email=x',
        a11yRef: 'c.yaml',
      }),
      event({
        index: 3,
        url: 'http://localhost:4321/dashboard?email=y',
        a11yRef: 'd.yaml',
      }),
    ]);

    expect(selected).toEqual([
      { url: 'http://localhost:4321/', ref: 'b.yaml' },
      { url: 'http://localhost:4321/dashboard', ref: 'd.yaml' },
    ]);
  });

  it('skips events that captured no snapshot', () => {
    expect(selectSnapshots([event({ index: 0 })])).toEqual([]);
  });

  it('caps how many pages it sends', () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      event({
        index: i,
        url: `http://localhost:4321/p${i}`,
        a11yRef: `${i}.yaml`,
      }),
    );

    expect(selectSnapshots(events, 3)).toHaveLength(3);
  });
});

describe('formatSnapshots', () => {
  it('truncates a large snapshot instead of blowing the prompt budget', () => {
    const formatted = formatSnapshots(
      [{ url: '/x', content: 'y'.repeat(5000) }],
      100,
    );

    expect(formatted).toContain('(truncated)');
    expect(formatted.length).toBeLessThan(300);
  });

  it('says so plainly when there is nothing to show', () => {
    expect(formatSnapshots([])).toBe('(none captured)');
  });
});
