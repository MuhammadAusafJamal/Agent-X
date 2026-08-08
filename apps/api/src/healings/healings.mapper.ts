import {
  diagnosisSchema,
  healingStatusSchema,
  parseJson,
  stepStatusSchema,
  targetHintsSchema,
  type HealingRecord,
} from '@agentx/shared';
import type { HealingRecord as HealingRecordRow } from '../generated/prisma/client';
import { toIso, toIsoOrNull } from '../common/mappers';

export function toHealingRecord(row: HealingRecordRow): HealingRecord {
  return {
    id: row.id,
    executionStepId: row.executionStepId,
    specVersionId: row.specVersionId,
    diagnosis: diagnosisSchema.parse(row.diagnosis),
    originalTarget: parseJson(
      targetHintsSchema,
      row.originalTarget,
      `HealingRecord.originalTarget#${row.id}`,
    ),
    proposedTarget: parseJson(
      targetHintsSchema,
      row.proposedTarget,
      `HealingRecord.proposedTarget#${row.id}`,
    ),
    proposedDescription: row.proposedDescription,
    rationale: row.rationale,
    status: healingStatusSchema.parse(row.status),
    reverifyStatus:
      row.reverifyStatus === null
        ? null
        : stepStatusSchema.parse(row.reverifyStatus),
    appliedToVersionId: row.appliedToVersionId,
    createdAt: toIso(row.createdAt),
    reviewedAt: toIsoOrNull(row.reviewedAt),
  };
}
