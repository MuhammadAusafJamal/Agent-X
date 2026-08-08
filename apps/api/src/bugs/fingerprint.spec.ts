import type { NetworkEntry } from '@agentx/shared';
import { fingerprintOf, type FingerprintInput } from './fingerprint';

/**
 * What makes the same defect one bug rather than one per run.
 *
 * The failure mode this guards against is a tracker filling with identical
 * reports every night until people stop reading it.
 */
describe('Bug fingerprint', () => {
  const input = (
    overrides: Partial<FingerprintInput> = {},
  ): FingerprintInput => ({
    specId: 'spec_1',
    stepIndex: 3,
    serverErrors: [],
    outcome: null,
    ...overrides,
  });

  const failing = (url: string, status = 500): NetworkEntry => ({
    url,
    method: 'POST',
    status,
  });

  it('is stable for the same defect seen twice', () => {
    const first = fingerprintOf(
      input({ serverErrors: [failing('http://localhost:4321/login')] }),
    );
    const second = fingerprintOf(
      input({ serverErrors: [failing('http://localhost:4321/login')] }),
    );

    expect(first).toBe(second);
  });

  it('ignores record ids in the path', () => {
    // /invoices/8891 and /invoices/8892 are one endpoint failing twice, not two
    // bugs.
    expect(
      fingerprintOf(
        input({
          serverErrors: [failing('http://localhost:4321/invoices/8891')],
        }),
      ),
    ).toBe(
      fingerprintOf(
        input({
          serverErrors: [failing('http://localhost:4321/invoices/8892')],
        }),
      ),
    );
  });

  it('ignores the query string and the host', () => {
    expect(
      fingerprintOf(
        input({
          serverErrors: [failing('http://localhost:4321/login?next=/a')],
        }),
      ),
    ).toBe(
      fingerprintOf(
        input({ serverErrors: [failing('https://staging.example.com/login')] }),
      ),
    );
  });

  it('separates different endpoints', () => {
    expect(
      fingerprintOf(
        input({ serverErrors: [failing('http://localhost:4321/login')] }),
      ),
    ).not.toBe(
      fingerprintOf(
        input({ serverErrors: [failing('http://localhost:4321/invoices')] }),
      ),
    );
  });

  it('separates the same failure in different steps', () => {
    const at = (stepIndex: number) =>
      fingerprintOf(
        input({
          stepIndex,
          serverErrors: [failing('http://localhost:4321/login')],
        }),
      );

    expect(at(1)).not.toBe(at(2));
  });

  it('separates the same failure in different specifications', () => {
    const forSpec = (specId: string) =>
      fingerprintOf(
        input({
          specId,
          serverErrors: [failing('http://localhost:4321/login')],
        }),
      );

    expect(forSpec('spec_1')).not.toBe(forSpec('spec_2'));
  });

  it('matches wrong outcomes whose particulars differ', () => {
    // The quoted values change with the data; the complaint is the identity.
    expect(
      fingerprintOf(
        input({
          outcome:
            'Expected the URL to prefix "/dashboard", but it was "/login?error=1"',
        }),
      ),
    ).toBe(
      fingerprintOf(
        input({
          outcome:
            'Expected the URL to prefix "/dashboard", but it was "/login?error=2"',
        }),
      ),
    );
  });

  it('separates a server error from a wrong outcome on the same step', () => {
    expect(
      fingerprintOf(
        input({ serverErrors: [failing('http://localhost:4321/login')] }),
      ),
    ).not.toBe(fingerprintOf(input({ outcome: 'the wrong page appeared' })));
  });
});
