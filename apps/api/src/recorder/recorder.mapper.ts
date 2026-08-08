import {
  bboxSchema,
  parseJson,
  parseJsonNullable,
  recordedEventTypeSchema,
  recordingStatusSchema,
  selectorCandidateSchema,
  type RecordedEvent,
  type Recording,
} from '@agentx/shared';
import type {
  RecordedEvent as RecordedEventRow,
  Recording as RecordingRow,
} from '../generated/prisma/client';
import { toIso, toIsoOrNull } from '../common/mappers';

export function toRecordedEvent(row: RecordedEventRow): RecordedEvent {
  return {
    id: row.id,
    recordingId: row.recordingId,
    index: row.index,
    // Enum columns are plain TEXT in SQLite, so the value is parsed rather than
    // asserted — nothing in the database enforces it.
    type: recordedEventTypeSchema.parse(row.type),
    url: row.url,
    timestamp: toIso(row.timestamp),
    value: row.value,
    isSecret: row.isSecret,
    targetRole: row.targetRole,
    targetName: row.targetName,
    targetText: row.targetText,
    targetTestId: row.targetTestId,
    landmark: row.landmark,
    bbox: parseJsonNullable(
      bboxSchema,
      row.bbox,
      `RecordedEvent.bbox#${row.id}`,
    ),
    selectorCandidates: parseJson(
      selectorCandidateSchema.array(),
      row.selectorCandidates,
      `RecordedEvent.selectorCandidates#${row.id}`,
    ),
    a11yRef: row.a11yRef,
    screenshotRef: row.screenshotRef,
  };
}

export function toRecording(
  row: RecordingRow & { _count?: { events: number } },
): Recording {
  return {
    id: row.id,
    applicationId: row.applicationId,
    environmentId: row.environmentId,
    startUrl: row.startUrl,
    status: recordingStatusSchema.parse(row.status),
    startedAt: toIso(row.startedAt),
    stoppedAt: toIsoOrNull(row.stoppedAt),
    error: row.error,
    eventCount: row._count?.events,
  };
}
