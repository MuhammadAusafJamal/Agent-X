import { Injectable } from '@nestjs/common';
import {
  credentialRefsSchema,
  stringifyJson,
  type CreateEnvironmentInput,
  type Environment,
  type EnvironmentCredentialStatus,
  type ListEnvironmentsQuery,
  type Paginated,
  type UpdateEnvironmentInput,
} from '@agentx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundError } from '../common/errors';
import { CredentialsService } from '../credentials/credentials.service';
import { toEnvironment } from './environments.mapper';

@Injectable()
export class EnvironmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialsService,
  ) {}

  async list(query: ListEnvironmentsQuery): Promise<Paginated<Environment>> {
    const where =
      query.applicationId === undefined
        ? {}
        : { applicationId: query.applicationId };

    const [rows, total] = await Promise.all([
      this.prisma.environment.findMany({
        where,
        orderBy: { name: 'asc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.environment.count({ where }),
    ]);

    return {
      items: rows.map(toEnvironment),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async get(id: string): Promise<Environment> {
    const row = await this.prisma.environment.findUnique({ where: { id } });

    if (row === null) {
      throw new NotFoundError('Environment', id);
    }

    return toEnvironment(row);
  }

  /**
   * Whether each credential reference currently resolves.
   *
   * Returns names and booleans only. The values stay in the process
   * environment — this response is rendered in a browser.
   */
  async credentialStatus(id: string): Promise<EnvironmentCredentialStatus> {
    const environment = await this.get(id);
    const entries = this.credentials.status(environment.credentialRefs);

    return {
      environmentId: id,
      entries,
      allResolved: entries.every((entry) => entry.resolved),
    };
  }

  async create(input: CreateEnvironmentInput): Promise<Environment> {
    await this.assertApplicationExists(input.applicationId);

    const row = await this.prisma.environment.create({
      data: {
        applicationId: input.applicationId,
        name: input.name,
        baseUrl: input.baseUrl,
        // Validated on the way in, so a malformed column can only ever
        // originate outside this codebase.
        credentialRefs: stringifyJson(
          credentialRefsSchema,
          input.credentialRefs,
          'Environment.credentialRefs',
        ),
      },
    });

    return toEnvironment(row);
  }

  async update(
    id: string,
    input: UpdateEnvironmentInput,
  ): Promise<Environment> {
    await this.assertExists(id);

    const row = await this.prisma.environment.update({
      where: { id },
      data: {
        name: input.name,
        baseUrl: input.baseUrl,
        credentialRefs:
          input.credentialRefs === undefined
            ? undefined
            : stringifyJson(
                credentialRefsSchema,
                input.credentialRefs,
                `Environment.credentialRefs#${id}`,
              ),
      },
    });

    return toEnvironment(row);
  }

  async remove(id: string): Promise<void> {
    await this.assertExists(id);
    await this.prisma.environment.delete({ where: { id } });
  }

  private async assertExists(id: string): Promise<void> {
    const found = await this.prisma.environment.findUnique({
      where: { id },
      select: { id: true },
    });

    if (found === null) {
      throw new NotFoundError('Environment', id);
    }
  }

  private async assertApplicationExists(id: string): Promise<void> {
    const found = await this.prisma.application.findUnique({
      where: { id },
      select: { id: true },
    });

    if (found === null) {
      throw new NotFoundError('Application', id);
    }
  }
}
