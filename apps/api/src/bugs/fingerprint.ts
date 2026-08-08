import { createHash } from 'node:crypto';
import type { NetworkEntry } from '@agentx/shared';

/**
 * The identity of a defect, so the same one recurring updates its report
 * instead of filing a twin.
 *
 * Built from what is stable about a failure — which specification, which step,
 * and which signal — and nothing that varies run to run. Ids, timestamps, and
 * query strings are all excluded on purpose: include any of them and every
 * nightly run files the same bug again, which is the failure mode that makes
 * people stop reading the tracker.
 */

export interface FingerprintInput {
  specId: string;
  stepIndex: number;
  /** The failing requests observed during the step, if any. */
  serverErrors: NetworkEntry[];
  /** The verifier's kind of complaint, when there was no server error. */
  outcome: string | null;
}

export function fingerprintOf(input: FingerprintInput): string {
  const signal =
    input.serverErrors.length > 0
      ? httpSignal(input.serverErrors[0])
      : `OUTCOME ${normalizeOutcome(input.outcome)}`;

  const parts = [input.specId, `step:${input.stepIndex}`, signal];

  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

function httpSignal(entry: NetworkEntry): string {
  return `HTTP ${entry.status ?? 0} ${entry.method} ${normalizePath(entry.url)}`;
}

/**
 * The shape of a URL, not the URL.
 *
 * `/invoices/8891` and `/invoices/8892` are the same endpoint failing twice,
 * and a fingerprint that disagrees turns one bug into one per record.
 */
function normalizePath(raw: string): string {
  let path: string;

  try {
    path = new URL(raw).pathname;
  } catch {
    // Not a parseable URL; use whatever came before the query string.
    path = raw.split('?')[0] ?? raw;
  }

  return path
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, '/:id')
    .replace(/\/[0-9a-z]{20,}(?=\/|$)/gi, '/:id');
}

/**
 * The complaint without its particulars.
 *
 * A verifier rationale quotes what it saw — "expected /dashboard, got
 * /login?error=Invalid+email" — and the quoted part changes with the data. What
 * identifies the defect is the sentence around it.
 */
function normalizeOutcome(outcome: string | null): string {
  if (outcome === null || outcome.trim() === '') return 'unspecified';

  return outcome
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\d+/g, '<n>')
    .replace(/[“”"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
