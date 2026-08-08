import {
  actionTypeSchema,
  expectationSchema,
  parseJson,
  parseJsonNullable,
  specSourceSchema,
  stepDataSchema,
  targetHintsSchema,
  type TestSpec,
  type TestStep,
  type TestVersion,
} from '@agentx/shared';
import type {
  TestSpec as TestSpecRow,
  TestStep as TestStepRow,
  TestVersion as TestVersionRow,
} from '../generated/prisma/client';
import { toIso } from '../common/mappers';

export function toTestStep(row: TestStepRow): TestStep {
  return {
    id: row.id,
    versionId: row.versionId,
    index: row.index,
    intent: row.intent,
    action: actionTypeSchema.parse(row.action),
    targetDescription: row.targetDescription,
    targetHints: parseJson(
      targetHintsSchema,
      row.targetHints,
      `TestStep.targetHints#${row.id}`,
    ),
    data: parseJsonNullable(
      stepDataSchema,
      row.data,
      `TestStep.data#${row.id}`,
    ),
    expectation: parseJson(
      expectationSchema,
      row.expectation,
      `TestStep.expectation#${row.id}`,
    ),
    optional: row.optional,
  };
}

export function toTestVersion(row: TestVersionRow): TestVersion {
  return {
    id: row.id,
    specId: row.specId,
    version: row.version,
    source: specSourceSchema.parse(row.source),
    note: row.note,
    recordingId: row.recordingId,
    createdAt: toIso(row.createdAt),
  };
}

export function toTestSpec(row: TestSpecRow): TestSpec {
  return {
    id: row.id,
    applicationId: row.applicationId,
    name: row.name,
    description: row.description,
    source: specSourceSchema.parse(row.source),
    currentVersionId: row.currentVersionId,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}
