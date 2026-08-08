import type { Application } from '@agentx/shared';
import type { Application as ApplicationRow } from '../generated/prisma/client';
import { toIso } from '../common/mappers';

export function toApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    baseUrl: row.baseUrl,
    description: row.description,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}
