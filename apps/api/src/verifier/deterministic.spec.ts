import type { ConsoleEntry, NetworkEntry } from '@agentx/shared';
import { checkConsole, checkNetwork, checkUrl, rollUp } from './deterministic';

describe('checkUrl', () => {
  it('passes a prefix match and names the actual URL', () => {
    const result = checkUrl('http://localhost:4321/dashboard?email=x', {
      kind: 'URL',
      match: 'prefix',
      value: 'http://localhost:4321/dashboard',
    });

    expect(result.status).toBe('PASS');
    expect(result.rationale).toContain('dashboard');
  });

  it('fails with what it expected and what it got', () => {
    const result = checkUrl('http://localhost:4321/login?error=1', {
      kind: 'URL',
      match: 'prefix',
      value: 'http://localhost:4321/dashboard',
    });

    expect(result.status).toBe('FAIL');
    // A failure a human cannot act on is barely better than a green run.
    expect(result.rationale).toContain('/login?error=1');
    expect(result.rationale).toContain('/dashboard');
  });

  it('compares a relative expectation against the path, so specs survive a host change', () => {
    expect(
      checkUrl('https://staging.example.com/dashboard', {
        kind: 'URL',
        match: 'prefix',
        value: '/dashboard',
      }).status,
    ).toBe('PASS');
  });

  it('supports exact and pattern matching', () => {
    expect(
      checkUrl('http://x/a', {
        kind: 'URL',
        match: 'exact',
        value: 'http://x/a',
      }).status,
    ).toBe('PASS');
    expect(
      checkUrl('http://x/ab', {
        kind: 'URL',
        match: 'exact',
        value: 'http://x/a',
      }).status,
    ).toBe('FAIL');
    expect(
      checkUrl('http://x/order/42', {
        kind: 'URL',
        match: 'pattern',
        value: '/order/\\d+$',
      }).status,
    ).toBe('PASS');
  });

  it('fails rather than throwing on an unparseable pattern', () => {
    expect(
      checkUrl('http://x/a', {
        kind: 'URL',
        match: 'pattern',
        value: '([unclosed',
      }).status,
    ).toBe('FAIL');
  });
});

describe('checkNetwork', () => {
  const entry = (partial: Partial<NetworkEntry>): NetworkEntry => ({
    url: 'http://localhost:4321/login',
    method: 'POST',
    status: 200,
    ok: true,
    ...partial,
  });

  it('passes when every request is at or below the threshold', () => {
    const result = checkNetwork([entry({}), entry({ status: 302 })], {
      kind: 'NETWORK_OK',
      maxStatus: 399,
    });

    expect(result.status).toBe('PASS');
  });

  it('fails and quotes the offending requests', () => {
    const result = checkNetwork([entry({ status: 500 })], {
      kind: 'NETWORK_OK',
      maxStatus: 399,
    });

    expect(result.status).toBe('FAIL');
    expect(result.rationale).toContain('500');
    expect(result.rationale).toContain('/login');
  });

  it('is inconclusive when nothing matched, rather than passing by default', () => {
    // "No evidence of failure" is not "evidence of success".
    expect(
      checkNetwork([], { kind: 'NETWORK_OK', maxStatus: 399 }).status,
    ).toBe('INCONCLUSIVE');

    expect(
      checkNetwork([entry({ url: 'http://x/other' })], {
        kind: 'NETWORK_OK',
        maxStatus: 399,
        urlPattern: '/checkout',
      }).status,
    ).toBe('INCONCLUSIVE');
  });

  it('scopes to a url pattern when given one', () => {
    const result = checkNetwork(
      [
        entry({ url: 'http://x/other', status: 500 }),
        entry({ url: 'http://x/login' }),
      ],
      { kind: 'NETWORK_OK', maxStatus: 399, urlPattern: '/login' },
    );

    expect(result.status).toBe('PASS');
  });
});

describe('checkConsole', () => {
  const entry = (partial: Partial<ConsoleEntry>): ConsoleEntry => ({
    type: 'error',
    text: 'Uncaught TypeError: x is not a function',
    ...partial,
  });

  it('passes when there are no errors', () => {
    expect(
      checkConsole([entry({ type: 'warn' }), entry({ type: 'log' })], {
        kind: 'NO_CONSOLE_ERRORS',
        allowlist: [],
      }).status,
    ).toBe('PASS');
  });

  it('fails and quotes the errors', () => {
    const result = checkConsole([entry({})], {
      kind: 'NO_CONSOLE_ERRORS',
      allowlist: [],
    });

    expect(result.status).toBe('FAIL');
    expect(result.rationale).toContain('TypeError');
  });

  it('honours an allowlist, so known noise does not cry wolf', () => {
    // A verifier that fails on every third-party warning gets ignored, and an
    // ignored verifier is worse than none.
    const result = checkConsole(
      [entry({ text: 'analytics.js failed to load' })],
      { kind: 'NO_CONSOLE_ERRORS', allowlist: ['analytics.js'] },
    );

    expect(result.status).toBe('PASS');
  });
});

describe('rollUp', () => {
  const step = (status: string, optional = false) => ({ status, optional });

  it('passes when everything passed', () => {
    expect(rollUp([step('PASS'), step('PASS')])).toBe('PASSED');
  });

  it('fails on any blocking failure', () => {
    expect(rollUp([step('PASS'), step('FAIL')])).toBe('FAILED');
  });

  it('ignores a failing optional step', () => {
    expect(rollUp([step('PASS'), step('FAIL', true)])).toBe('PASSED');
  });

  it('reports UNCERTAIN rather than silently passing', () => {
    // The whole reason for a third state: an unresolved question must not be
    // reported as success.
    expect(rollUp([step('PASS'), step('UNCERTAIN')])).toBe('UNCERTAIN');
  });

  it('lets a known failure outrank an open question', () => {
    expect(rollUp([step('UNCERTAIN'), step('FAIL')])).toBe('FAILED');
  });

  it('surfaces an uncertain optional step too', () => {
    // Optional means "need not succeed", not "need not be looked at".
    expect(rollUp([step('PASS'), step('UNCERTAIN', true)])).toBe('UNCERTAIN');
  });
});
