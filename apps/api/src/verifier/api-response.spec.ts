import type { Expectation, NetworkEntry } from '@agentx/shared';
import { checkApiResponse } from './deterministic';

/**
 * The check that makes an acceptance criterion about a *value* able to fail.
 *
 * The cases that matter most here are the ones that must not pass: a body that
 * was never captured, a request that never happened, a payload that will not
 * parse. Every one of those is a way of not knowing, and the whole point of the
 * three-state result is that not knowing is not success.
 */

const expectation = (
  over: Partial<Extract<Expectation, { kind: 'API_RESPONSE' }>> = {},
): Extract<Expectation, { kind: 'API_RESPONSE' }> => ({
  kind: 'API_RESPONSE',
  urlPattern: '/api/invoices',
  jsonPath: 'invoice.total',
  match: 'equals',
  value: '100',
  ...over,
});

const entry = (over: Partial<NetworkEntry> = {}): NetworkEntry => ({
  url: 'http://localhost:4321/api/invoices',
  method: 'POST',
  status: 200,
  ok: true,
  ...over,
});

describe('checkApiResponse', () => {
  it('passes when the value at the path matches', () => {
    const result = checkApiResponse(
      [entry({ responseBody: '{"invoice":{"total":100}}' })],
      expectation(),
    );

    expect(result.status).toBe('PASS');
  });

  it('fails when the value is wrong, naming both numbers', () => {
    // The case the whole feature exists for: a 200 carrying the wrong total.
    const result = checkApiResponse(
      [entry({ responseBody: '{"invoice":{"total":110}}' })],
      expectation(),
    );

    expect(result.status).toBe('FAIL');
    expect(result.rationale).toContain('110');
    expect(result.rationale).toContain('100');
  });

  it('compares numbers and strings alike, since a criterion cannot know which the API used', () => {
    expect(
      checkApiResponse(
        [entry({ responseBody: '{"invoice":{"total":"100"}}' })],
        expectation(),
      ).status,
    ).toBe('PASS');
  });

  it('is INCONCLUSIVE when no request matched — nothing was checked', () => {
    const result = checkApiResponse(
      [entry({ url: 'http://localhost:4321/api/customers' })],
      expectation(),
    );

    expect(result.status).toBe('INCONCLUSIVE');
  });

  it('is INCONCLUSIVE when the request matched but no body was captured', () => {
    // No evidence of failure is not evidence of success. Passing here would
    // report green for a payload nobody ever read.
    const result = checkApiResponse(
      [entry({ bodyOmitted: true })],
      expectation(),
    );

    expect(result.status).toBe('INCONCLUSIVE');
    expect(result.rationale).toContain('no JSON body');
  });

  it('is INCONCLUSIVE when the body will not parse', () => {
    expect(
      checkApiResponse(
        [entry({ responseBody: '<html>nope</html>' })],
        expectation(),
      ).status,
    ).toBe('INCONCLUSIVE');
  });

  it('fails when the path is absent rather than crashing', () => {
    const result = checkApiResponse(
      [entry({ responseBody: '{"invoice":{"amount":100}}' })],
      expectation(),
    );

    expect(result.status).toBe('FAIL');
    expect(result.rationale).toContain('invoice.total');
  });

  it('reads array indices in a path', () => {
    expect(
      checkApiResponse([entry({ responseBody: '{"items":[{"sku":"A1"}]}' })], {
        ...expectation(),
        jsonPath: 'items.0.sku',
        value: 'A1',
      }).status,
    ).toBe('PASS');
  });

  it('uses the last matching response, because a step can call an endpoint twice', () => {
    const result = checkApiResponse(
      [
        entry({ responseBody: '{"invoice":{"total":1}}' }),
        entry({ responseBody: '{"invoice":{"total":100}}' }),
      ],
      expectation(),
    );

    expect(result.status).toBe('PASS');
  });

  it('supports contains, matches, and exists', () => {
    const body = { responseBody: '{"invoice":{"id":"INV-0007"}}' };

    expect(
      checkApiResponse([entry(body)], {
        ...expectation(),
        jsonPath: 'invoice.id',
        match: 'contains',
        value: 'INV-',
      }).status,
    ).toBe('PASS');

    expect(
      checkApiResponse([entry(body)], {
        ...expectation(),
        jsonPath: 'invoice.id',
        match: 'matches',
        value: '^INV-\\d{4}$',
      }).status,
    ).toBe('PASS');

    expect(
      checkApiResponse([entry(body)], {
        ...expectation(),
        jsonPath: 'invoice.id',
        match: 'exists',
        value: undefined,
      }).status,
    ).toBe('PASS');
  });

  it('fails a malformed expectation rather than escalating it', () => {
    // A missing value is the spec's bug. Handing it to the model would only ask
    // a second component to guess at something the first never supplied.
    const result = checkApiResponse([entry({ responseBody: '{"a":1}' })], {
      ...expectation(),
      value: undefined,
    });

    expect(result.status).toBe('FAIL');
    expect(result.rationale).toContain('names no value');
  });

  it('does not treat an unparseable regex as a crash', () => {
    expect(
      checkApiResponse([entry({ responseBody: '{"invoice":{"total":100}}' })], {
        ...expectation(),
        match: 'matches',
        value: '([',
      }).status,
    ).toBe('FAIL');
  });
});
