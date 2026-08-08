import {
  credentialRefsSchema,
  parseJson,
  type Environment,
} from '@agentx/shared';
import type { Environment as EnvironmentRow } from '../generated/prisma/client';
import { toIso } from '../common/mappers';

export function toEnvironment(row: EnvironmentRow): Environment {
  return {
    id: row.id,
    applicationId: row.applicationId,
    name: row.name,
    baseUrl: row.baseUrl,
    // Parsed, never cast — SQLite has no JSON type, so this column is TEXT and
    // nothing but this schema guarantees its shape. The context string names the
    // row, so a bad one is findable.
    credentialRefs: parseJson(
      credentialRefsSchema,
      row.credentialRefs,
      `Environment.credentialRefs#${row.id}`,
    ),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}
