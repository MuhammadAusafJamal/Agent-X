import type { BrowserContext } from 'playwright';
import type { ConsoleEntry, NetworkEntry } from '@agentx/shared';
import type { Redactor } from '../credentials/redactor';

const MAX_PER_STEP = 200;

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

  constructor(private readonly redactor: Redactor) {}

  attach(context: BrowserContext): void {
    context.on('response', (response) => {
      if (this.network.length >= MAX_PER_STEP) return;

      const request = response.request();

      this.network.push({
        url: response.url(),
        method: request.method(),
        status: response.status(),
        ok: response.ok(),
        resourceType: request.resourceType(),
      });
    });

    context.on('console', (message) => {
      if (this.console.length >= MAX_PER_STEP) return;

      this.console.push({
        type: consoleType(message.type()),
        text: message.text(),
        location: `${message.location().url}:${message.location().lineNumber}`,
      });
    });

    context.on('weberror', (error) => {
      if (this.console.length >= MAX_PER_STEP) return;

      // An uncaught exception is the strongest console signal there is, and it
      // does not arrive as a console message.
      this.console.push({
        type: 'error',
        text: error.error().message,
      });
    });
  }

  /** Clears the buffers so what follows belongs to the next step. */
  beginStep(): void {
    this.network = [];
    this.console = [];
  }

  drain(): { network: NetworkEntry[]; console: ConsoleEntry[] } {
    const drained = {
      network: this.redactor.redactDeep(this.network),
      console: this.redactor.redactDeep(this.console),
    };

    this.beginStep();

    return drained;
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
