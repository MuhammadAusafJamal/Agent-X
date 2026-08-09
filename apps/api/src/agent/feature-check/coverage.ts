import type { AcceptanceCriterion, PlannedCase } from '@agentx/shared';

/**
 * What the plan actually covers.
 *
 * The planner's prompt asks for every criterion to appear in some case, and a
 * prompt asking for something is not a guarantee of it. This compares what came
 * back against what went in, so a criterion nobody planned for is *reported* as
 * untested rather than quietly vanishing — the same reasoning as `bounds.ts`:
 * the check that runs after the model answers is the one that holds.
 *
 * Pure, so it is testable without a model, a browser, or a database.
 */

export interface CoverageReport {
  /** Criterion keys with at least one case behind them. */
  covered: string[];
  /** Criterion keys the planner produced no case for. */
  uncovered: string[];
  /**
   * Keys cases claimed to cover that are not criteria at all — a model
   * inventing an "AC6" for a list that ends at AC5. Stripped, and named, so the
   * mistake is visible rather than silently widening coverage.
   */
  unknown: string[];
}

export function assessCoverage(
  criteria: AcceptanceCriterion[],
  cases: PlannedCase[],
): CoverageReport {
  const known = new Set(criteria.map((criterion) => criterion.key));
  const claimed = new Set(cases.flatMap((one) => one.coversCriteria));

  return {
    covered: criteria
      .map((criterion) => criterion.key)
      .filter((key) => claimed.has(key)),
    uncovered: criteria
      .map((criterion) => criterion.key)
      .filter((key) => !claimed.has(key)),
    unknown: [...claimed].filter((key) => !known.has(key)).sort(),
  };
}

/**
 * The plan with invented criterion keys removed and the case count capped.
 *
 * Clamping here rather than trusting `maxCases` in the prompt, for the same
 * reason the explorer clamps its step budget in code: a ceiling a model is asked
 * to respect is not a ceiling.
 */
export function normalizePlan(
  criteria: AcceptanceCriterion[],
  cases: PlannedCase[],
  maxCases: number,
): PlannedCase[] {
  const known = new Set(criteria.map((criterion) => criterion.key));

  return cases.slice(0, maxCases).map((one) => ({
    ...one,
    coversCriteria: one.coversCriteria.filter((key) => known.has(key)),
  }));
}
