import type { Project } from '@agentx/shared';
import type { Project as ProjectRow } from '../generated/prisma/client';
import { toIso } from '../common/mappers';

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}
