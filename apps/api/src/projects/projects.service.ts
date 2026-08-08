import { Injectable } from '@nestjs/common';
import type {
  CreateProjectInput,
  Paginated,
  PaginationQuery,
  Project,
  ProjectWithApplications,
  UpdateProjectInput,
} from '@agentx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundError } from '../common/errors';
import { toApplication } from '../applications/applications.mapper';
import { toProject } from './projects.mapper';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PaginationQuery): Promise<Paginated<Project>> {
    const [rows, total] = await Promise.all([
      this.prisma.project.findMany({
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.project.count(),
    ]);

    return {
      items: rows.map(toProject),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async get(id: string): Promise<ProjectWithApplications> {
    const row = await this.prisma.project.findUnique({
      where: { id },
      include: { applications: { orderBy: { name: 'asc' } } },
    });

    if (row === null) {
      throw new NotFoundError('Project', id);
    }

    return {
      ...toProject(row),
      applications: row.applications.map(toApplication),
    };
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const row = await this.prisma.project.create({
      data: { name: input.name, description: input.description ?? null },
    });

    return toProject(row);
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    await this.assertExists(id);

    const row = await this.prisma.project.update({
      where: { id },
      // `undefined` means "not supplied" to Prisma and leaves the column alone,
      // while an explicit null clears it. A PATCH must preserve that difference.
      data: { name: input.name, description: input.description },
    });

    return toProject(row);
  }

  async remove(id: string): Promise<void> {
    await this.assertExists(id);

    // Applications, environments, specs, executions, and knowledge go with it
    // via the cascade rules in schema.prisma — no manual cleanup here.
    await this.prisma.project.delete({ where: { id } });
  }

  private async assertExists(id: string): Promise<void> {
    const found = await this.prisma.project.findUnique({
      where: { id },
      select: { id: true },
    });

    if (found === null) {
      throw new NotFoundError('Project', id);
    }
  }
}
