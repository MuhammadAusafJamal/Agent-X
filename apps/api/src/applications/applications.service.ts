import { Injectable } from '@nestjs/common';
import type {
  Application,
  ApplicationWithEnvironments,
  CreateApplicationInput,
  ListApplicationsQuery,
  Paginated,
  UpdateApplicationInput,
} from '@agentx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundError } from '../common/errors';
import { toEnvironment } from '../environments/environments.mapper';
import { toApplication } from './applications.mapper';

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListApplicationsQuery): Promise<Paginated<Application>> {
    const where =
      query.projectId === undefined ? {} : { projectId: query.projectId };

    const [rows, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        orderBy: { name: 'asc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.application.count({ where }),
    ]);

    return {
      items: rows.map(toApplication),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async get(id: string): Promise<ApplicationWithEnvironments> {
    const row = await this.prisma.application.findUnique({
      where: { id },
      include: { environments: { orderBy: { name: 'asc' } } },
    });

    if (row === null) {
      throw new NotFoundError('Application', id);
    }

    return {
      ...toApplication(row),
      environments: row.environments.map(toEnvironment),
    };
  }

  async create(input: CreateApplicationInput): Promise<Application> {
    // Checked explicitly so an unknown parent is a 404 naming the project,
    // rather than a raw foreign-key violation surfacing as a 500.
    await this.assertProjectExists(input.projectId);

    const row = await this.prisma.application.create({
      data: {
        projectId: input.projectId,
        name: input.name,
        baseUrl: input.baseUrl,
        description: input.description ?? null,
      },
    });

    return toApplication(row);
  }

  async update(
    id: string,
    input: UpdateApplicationInput,
  ): Promise<Application> {
    await this.assertExists(id);

    const row = await this.prisma.application.update({
      where: { id },
      data: {
        name: input.name,
        baseUrl: input.baseUrl,
        description: input.description,
      },
    });

    return toApplication(row);
  }

  async remove(id: string): Promise<void> {
    await this.assertExists(id);
    await this.prisma.application.delete({ where: { id } });
  }

  private async assertExists(id: string): Promise<void> {
    const found = await this.prisma.application.findUnique({
      where: { id },
      select: { id: true },
    });

    if (found === null) {
      throw new NotFoundError('Application', id);
    }
  }

  private async assertProjectExists(id: string): Promise<void> {
    const found = await this.prisma.project.findUnique({
      where: { id },
      select: { id: true },
    });

    if (found === null) {
      throw new NotFoundError('Project', id);
    }
  }
}
