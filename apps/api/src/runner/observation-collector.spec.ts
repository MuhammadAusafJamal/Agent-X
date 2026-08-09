import type { BrowserContext } from 'playwright';
import { ObservationCollector } from './observation-collector';
import { Redactor } from '../credentials/redactor';

/**
 * A `BrowserContext` reduced to the one thing the collector uses: `on`.
 *
 * The collector attaches listeners and is then driven entirely by events, so a
 * recorder of handlers is a complete stand-in — and lets these run without a
 * browser, which is what makes it reasonable to assert a 500-response run.
 */
function fakeContext(): {
  context: BrowserContext;
  respond: (entry: {
    url?: string;
    resourceType?: string;
    status?: number;
  }) => void;
} {
  const handlers: Record<string, ((payload: unknown) => void)[]> = {};

  const context = {
    on(event: string, handler: (payload: unknown) => void) {
      (handlers[event] ??= []).push(handler);
    },
  } as unknown as BrowserContext;

  let seq = 0;

  return {
    context,
    respond({ url, resourceType = 'xhr', status = 200 }) {
      seq += 1;

      const response = {
        url: () => url ?? `https://example.test/${seq}`,
        status: () => status,
        ok: () => status < 400,
        request: () => ({
          method: () => 'GET',
          resourceType: () => resourceType,
        }),
        // Not JSON, so `captureBody` returns before reading anything.
        headers: () => ({ 'content-type': 'text/html' }),
        text: () => Promise.resolve(''),
      };

      for (const handler of handlers.response ?? []) handler(response);
    },
  };
}

describe('ObservationCollector', () => {
  it('keeps filling the step buffer after the run log is full', async () => {
    // The regression this exists for: the run-level ceiling used to guard the
    // whole response handler. Once a busy page pushed past it, every later step
    // observed an empty network log — `checkNetwork` reported INCONCLUSIVE,
    // which escalated to the model, which exhausted the run's call budget, and
    // the rest of the run came back UNCERTAIN with nothing to explain it.
    const collector = new ObservationCollector(new Redactor([]), {
      maxPerRun: 5,
      maxPerStep: 10,
    });

    const { context, respond } = fakeContext();
    collector.attach(context);

    for (let i = 0; i < 20; i += 1) respond({});
    await collector.drain();

    // A second step, long after the run log filled up.
    for (let i = 0; i < 3; i += 1)
      respond({ url: 'https://example.test/late' });

    const second = await collector.drain();

    expect(second.network).toHaveLength(3);
    expect(second.network.every((one) => one.url.endsWith('/late'))).toBe(true);
  });

  it('drops the oldest run-level entries rather than refusing new ones', () => {
    const collector = new ObservationCollector(new Redactor([]), {
      maxPerRun: 3,
    });

    const { context, respond } = fakeContext();
    collector.attach(context);

    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      respond({ url: `https://example.test/${name}` });
    }

    const run = collector.runNetwork();

    expect(run).toHaveLength(3);
    expect(run.map((one) => one.url)).toEqual([
      'https://example.test/c',
      'https://example.test/d',
      'https://example.test/e',
    ]);
  });

  it('spends no run-level slots on images, fonts, media, or stylesheets', async () => {
    const collector = new ObservationCollector(new Redactor([]));
    const { context, respond } = fakeContext();

    collector.attach(context);

    for (const resourceType of ['image', 'font', 'media', 'stylesheet']) {
      respond({ resourceType });
    }

    respond({ url: 'https://example.test/api/thing', resourceType: 'xhr' });

    const run = collector.runNetwork();

    expect(run).toHaveLength(1);
    expect(run[0].url).toBe('https://example.test/api/thing');

    // The step still sees them: a 404 on a stylesheet is a real observation
    // about the page, and step evidence is what happened.
    const step = await collector.drain();
    expect(step.network).toHaveLength(5);
  });
});
