/**
 * Removes secret values from anything on its way out of the process.
 *
 * Evidence files, reports, step logs, and LLM prompts all leave the machine or
 * outlive the run. A password captured in a `network.json` is a leak that
 * survives long after the test that produced it, so redaction runs at the point
 * of writing rather than being something each writer remembers.
 */
export class Redactor {
  private readonly secrets: string[];

  constructor(secrets: readonly (string | undefined | null)[]) {
    // Short values are excluded deliberately: redacting a two-character
    // "secret" would scrub unrelated substrings out of every DOM snapshot and
    // make the evidence useless.
    this.secrets = [...new Set(secrets.filter(isRedactable))].sort(
      (a, b) => b.length - a.length,
    );
  }

  get isEmpty(): boolean {
    return this.secrets.length === 0;
  }

  /** Replaces every occurrence of a known secret with `***`. */
  redact(text: string): string {
    return this.secrets.reduce(
      (result, secret) => result.split(secret).join('***'),
      text,
    );
  }

  /**
   * Redacts every string inside an arbitrary structure, keys included — a
   * secret used as an object key would otherwise survive.
   */
  redactDeep<T>(value: T): T {
    if (this.isEmpty) {
      return value;
    }

    return this.walk(value) as T;
  }

  private walk(value: unknown): unknown {
    if (typeof value === 'string') {
      return this.redact(value);
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this.walk(entry));
    }

    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          this.redact(key),
          this.walk(entry),
        ]),
      );
    }

    return value;
  }
}

const MIN_REDACTABLE_LENGTH = 4;

function isRedactable(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.length >= MIN_REDACTABLE_LENGTH;
}
