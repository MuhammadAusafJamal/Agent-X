import type { BrowserContext } from 'playwright';
import type { ConsoleEntry, NetworkEntry } from '@agentx/shared';
import type { Redactor } from '../credentials/redactor';

/** The defaults, for callers with no configuration to hand — chiefly tests. */
const MAX_PER_STEP = 200;
const MAX_PER_RUN = 400;

/**
 * Resource types the run-level log will not spend a slot on.
 *
 * The run log exists to answer `API_RESPONSE` expectations, and no expectation
 * has ever been written against a hero image. Left in, a single marketing page
 * fills the entire ceiling with images and fonts before the first XHR arrives.
 * The *step* log keeps them: a step's evidence is what happened, and a 404 on a
 * stylesheet is a real observation about the page.
 */
const UNINTERESTING = new Set(['image', 'font', 'media', 'stylesheet']);

export interface ObservationLimits {
  maxPerStep: number;
  maxPerRun: number;
}

/**
 * How much of a JSON body is kept, per response.
 *
 * Enough for an API payload a criterion would assert against, small enough that
 * a step's evidence stays readable. A body over the cap is dropped rather than
 * truncated: half a JSON document does not parse, and a checker that cannot
 * parse it reports `INCONCLUSIVE` either way — but `bodyOmitted` says why.
 */
const MAX_BODY_CHARS = 20_000;

/** Waiting longer than this for a body would hold up the step it belongs to. */
const BODY_TIMEOUT_MS = 2000;

/**
 * Only JSON. An acceptance criterion asserts against a payload, and buffering
 * every HTML document, bundle, and image a page loads would bloat the evidence
 * tree by megabytes to answer nothing.
 */
const JSON_CONTENT_TYPE = /\bapplication\/(\w+\+)?json\b/i;

/**
 * Buffers what the browser reported, sliced per step.
 *
 * Listeners are attached at context level rather than per page, so a popup or a
 * redirect does not silently stop collection halfway through a run. Everything
 * drained here passes through the redactor first: a login request body is
 * exactly the kind of thing that ends up in a network log and then in evidence
 * on disk.
 */
export class ObservationCollector {
  private network: NetworkEntry[] = [];
  private console: ConsoleEntry[] = [];
  /**
   * The run's recent responses, never cleared between steps.
   *
   * Kept separately from `network` because the two answer different questions,
   * and because of a race that step scope alone cannot survive: a `fetch` fired
   * by a click often resolves *after* that step drained and *before* the next
   * step's `beginStep`, so the entry would be dropped by the reset and appear in
   * no step at all. Appending here at capture time — not at drain time — means a
   * response is recorded the moment it arrives, whatever the step boundary is
   * doing.
   *
   * The entries are the same objects as in `network`, so a body that fills in
   * later fills in for both. Not every entry appears in both: `UNINTERESTING`
   * resource types are step evidence only, and this list is bounded, so an old
   * enough response survives in neither.
   */
  private all: NetworkEntry[] = [];
  /**
   * Body reads still in flight.
   *
   * A body cannot be read from the synchronous `response` handler, so the entry
   * is pushed immediately and filled in when the read resolves. `drain` awaits
   * these, because a body that lands after the step was judged is a body that
   * silently turned a deterministic check into an `INCONCLUSIVE` one. Not
   * cleared per step, for the same reason `all` is not.
   */
  private pendingBodies: Promise<void>[] = [];

  private readonly limits: ObservationLimits;

  constructor(
    private readonly redactor: Redactor,
    limits: Partial<ObservationLimits> = {},
  ) {
    this.limits = {
      maxPerStep: limits.maxPerStep ?? MAX_PER_STEP,
      maxPerRun: limits.maxPerRun ?? MAX_PER_RUN,
    };
  }

  attach(context: BrowserContext): void {
    context.on('response', (response) => {
      const request = response.request();

      const entry: NetworkEntry = {
        url: response.url(),
        method: request.method(),
        status: response.status(),
        ok: response.ok(),
        resourceType: request.resourceType(),
      };

      // Per-step first, and never gated on the run-level ceiling. Gating it was
      // a bug with no symptom at its own site: once a busy page pushed the run
      // log past its cap, the handler returned early and *every* later step
      // observed an empty network log. `checkNetwork` then reported
      // INCONCLUSIVE, which escalated to the model, which exhausted the run's
      // call budget, which left the rest of the run permanently UNCERTAIN — with
      // nothing in the evidence to say why.
      if (this.network.length < this.limits.maxPerStep)
        this.network.push(entry);

      if (!UNINTERESTING.has(entry.resourceType ?? '')) {
        this.all.push(entry);

        // Oldest out, rather than newest refused. A long run should remember its
        // most recent traffic; the payload an expectation asks about is always
        // something that happened a moment ago.
        if (this.all.length > this.limits.maxPerRun) this.all.shift();
      }

      this.captureBody(response, entry);
    });

    context.on('console', (message) => {
      if (this.console.length >= this.limits.maxPerStep) return;

      this.console.push({
        type: consoleType(message.type()),
        text: message.text(),
        location: `${message.location().url}:${message.location().lineNumber}`,
      });
    });

    context.on('weberror', (error) => {
      if (this.console.length >= this.limits.maxPerStep) return;

      // An uncaught exception is the strongest console signal there is, and it
      // does not arrive as a console message.
      this.console.push({
        type: 'error',
        text: error.error().message,
      });
    });
  }

  /**
   * Reads a JSON body alongside the entry it belongs to.
   *
   * Every failure mode here is swallowed on purpose. A body that cannot be read
   * — a redirect, a response already discarded, a request the browser cancelled
   * — is a missing observation, and a missing observation must never fail the
   * step it was collected during. `checkApiResponse` reports `INCONCLUSIVE` when
   * the body is absent, which is the honest answer.
   */
  private captureBody(
    response: { headers(): Record<string, string>; text(): Promise<string> },
    entry: NetworkEntry,
  ): void {
    const contentType = response.headers()['content-type'] ?? '';

    if (!JSON_CONTENT_TYPE.test(contentType)) return;

    const read = (async (): Promise<void> => {
      try {
        const body = await withTimeout(response.text(), BODY_TIMEOUT_MS);

        if (body === null) {
          entry.bodyOmitted = true;
          return;
        }

        if (body.length > MAX_BODY_CHARS) {
          entry.bodyOmitted = true;
          return;
        }

        entry.responseBody = body;
      } catch {
        entry.bodyOmitted = true;
      }
    })();

    this.pendingBodies.push(read);
  }

  /**
   * Clears the *step* buffers so what follows belongs to the next step.
   *
   * The run-level log and the outstanding body reads deliberately survive: a
   * response that arrives in the gap between one step draining and the next
   * beginning still happened, and an `API_RESPONSE` expectation asserted a step
   * later is exactly the thing that needs it.
   */
  beginStep(): void {
    this.network = [];
    this.console = [];
  }

  /**
   * Everything the run has seen, for expectations that outlive a step.
   *
   * Await `drain` first if the most recent bodies matter — this reads whatever
   * has landed, and says nothing about what is still in flight.
   */
  runNetwork(): NetworkEntry[] {
    return this.redactor.redactDeep(this.all);
  }

  /**
   * Settles outstanding body reads, then hands over what the step observed.
   *
   * Async because of those reads. The redaction happens after they land, so a
   * credential echoed back in a response body is stripped like any other.
   */
  async drain(): Promise<{
    network: NetworkEntry[];
    console: ConsoleEntry[];
  }> {
    await Promise.allSettled(this.pendingBodies);

    const drained = {
      network: this.redactor.redactDeep(this.network),
      console: this.redactor.redactDeep(this.console),
    };

    this.beginStep();

    return drained;
  }
}

/** Resolves to null rather than rejecting, so a slow body is not an error. */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function consoleType(raw: string): ConsoleEntry['type'] {
  switch (raw) {
    case 'log':
    case 'info':
    case 'warn':
    case 'error':
    case 'debug':
    case 'trace':
      return raw;
    default:
      return 'other';
  }
}
