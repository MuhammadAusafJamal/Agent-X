import { Injectable, Logger } from '@nestjs/common';
import {
  knowledgeKindSchema,
  knowledgeValueSchema,
  parseJson,
  stringifyJson,
  type KnowledgeItem,
  type Paginated,
  type PaginationQuery,
  type ResolutionStrategy,
} from '@agentx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundError } from '../common/errors';
import { toIso } from '../common/mappers';
import { decayed, isTrusted, onHit, onMiss } from './confidence';

/** What rung 1 needs: a selector worth trying first, or nothing. */
export interface RememberedSelector {
  selector: string;
  strategy: ResolutionStrategy;
  confidence: number;
}

/**
 * What the agent has learned about an application.
 *
 * Scoped strictly per application — knowledge from one is never visible to
 * another, because "the Save button" means something different in each.
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The last-known-good selector for a step, if it is still trusted.
   *
   * Age decay is applied on read, so an entry nobody has confirmed lately stops
   * being offered without needing a background job to expire it.
   */
  async recall(
    applicationId: string,
    key: string,
  ): Promise<RememberedSelector | null> {
    const row = await this.prisma.knowledgeItem.findUnique({
      where: {
        applicationId_kind_key: {
          applicationId,
          kind: 'SELECTOR_MEMORY',
          key,
        },
      },
    });

    if (row === null) return null;

    const confidence = decayed(row.confidence, row.lastSeenAt);

    if (!isTrusted(confidence)) return null;

    const value = parseJson(
      knowledgeValueSchema,
      row.value,
      `KnowledgeItem.value#${row.id}`,
    );

    if (value.kind !== 'SELECTOR_MEMORY') return null;

    return {
      selector: value.selector,
      strategy: value.strategy,
      confidence,
    };
  }

  /**
   * Records that a step resolved, and how.
   *
   * Called on every successful resolution, not only the interesting ones: the
   * point is that the second run of a spec takes rung 1 and makes no model
   * call, and that only happens if the first run wrote down what worked.
   */
  async remember(
    applicationId: string,
    key: string,
    selector: string,
    strategy: ResolutionStrategy,
  ): Promise<void> {
    // A text match is never remembered. It is the one rung whose "unique
    // match" can still be the wrong element — a step meant for the "Sign in"
    // button matching the "Sign in" heading — and writing that down turns a
    // one-run mistake into a lasting one that rung 1 replays with confidence.
    if (strategy === 'TEXT') return;

    const value = stringifyJson(
      knowledgeValueSchema,
      { kind: 'SELECTOR_MEMORY', stepKey: key, selector, strategy },
      'KnowledgeItem.value',
    );

    const existing = await this.prisma.knowledgeItem.findUnique({
      where: {
        applicationId_kind_key: { applicationId, kind: 'SELECTOR_MEMORY', key },
      },
    });

    if (existing === null) {
      await this.prisma.knowledgeItem.create({
        data: {
          applicationId,
          kind: 'SELECTOR_MEMORY',
          key,
          value,
          confidence: 0.5,
          hitCount: 1,
          lastSeenAt: new Date(),
        },
      });
      return;
    }

    const sameAsBefore = existing.value === value;

    await this.prisma.knowledgeItem.update({
      where: { id: existing.id },
      data: {
        value,
        // Confirming what we already believed earns confidence; learning
        // something different resets it, because the page evidently moved.
        confidence: sameAsBefore ? onHit(existing.confidence) : 0.5,
        hitCount: { increment: 1 },
        lastSeenAt: new Date(),
      },
    });
  }

  /** Records that a remembered selector did not work, so it decays. */
  async forgetIfWrong(applicationId: string, key: string): Promise<void> {
    const existing = await this.prisma.knowledgeItem.findUnique({
      where: {
        applicationId_kind_key: { applicationId, kind: 'SELECTOR_MEMORY', key },
      },
    });

    if (existing === null) return;

    await this.prisma.knowledgeItem.update({
      where: { id: existing.id },
      data: {
        confidence: onMiss(existing.confidence),
        missCount: { increment: 1 },
      },
    });
  }

  async list(
    applicationId: string,
    query: PaginationQuery,
  ): Promise<Paginated<KnowledgeItem>> {
    const where = { applicationId };

    const [rows, total] = await Promise.all([
      this.prisma.knowledgeItem.findMany({
        where,
        orderBy: [{ confidence: 'desc' }, { key: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.knowledgeItem.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        applicationId: row.applicationId,
        kind: knowledgeKindSchema.parse(row.kind),
        key: row.key,
        value: parseJson(
          knowledgeValueSchema,
          row.value,
          `KnowledgeItem.value#${row.id}`,
        ),
        // Shown as it will actually be used, decay included.
        confidence: decayed(row.confidence, row.lastSeenAt),
        hitCount: row.hitCount,
        missCount: row.missCount,
        lastSeenAt: toIso(row.lastSeenAt),
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  /** A wrong learned fact must be removable without a database client. */
  async remove(id: string): Promise<void> {
    const existing = await this.prisma.knowledgeItem.findUnique({
      where: { id },
      select: { id: true },
    });

    if (existing === null) throw new NotFoundError('Knowledge item', id);

    await this.prisma.knowledgeItem.delete({ where: { id } });
  }
}
