/**
 * How much the agent trusts what it learned.
 *
 * Kept as pure functions so the decay rules can be reasoned about and tested
 * without a database. The asymmetry is deliberate: confidence climbs slowly on
 * success and drops sharply on a miss, because **stale knowledge is worse than
 * none**. A wrong remembered selector sends the resolver confidently at the
 * wrong element, which is exactly the failure that looks like a pass.
 */

export const CONFIDENCE_FLOOR = 0.3;
const HIT_GAIN = 0.1;
const MISS_PENALTY = 0.3;
const STALE_AFTER_DAYS = 30;

export function onHit(confidence: number): number {
  return clamp(confidence + HIT_GAIN);
}

export function onMiss(confidence: number): number {
  return clamp(confidence - MISS_PENALTY);
}

/**
 * Age decay, applied on read.
 *
 * An entry nobody has confirmed in a month is a guess about a page that has had
 * a month to change.
 */
export function decayed(
  confidence: number,
  lastSeenAt: Date,
  now = new Date(),
): number {
  const days = (now.getTime() - lastSeenAt.getTime()) / 86_400_000;

  if (days <= 0) return confidence;

  return clamp(confidence * Math.max(0, 1 - days / STALE_AFTER_DAYS));
}

/** Below the floor an entry is not trusted at rung 1 and is not put in a prompt. */
export function isTrusted(confidence: number): boolean {
  return confidence >= CONFIDENCE_FLOOR;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Number(value.toFixed(4))));
}
