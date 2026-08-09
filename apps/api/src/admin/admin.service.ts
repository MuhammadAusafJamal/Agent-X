import { Injectable, Logger } from '@nestjs/common';
import type { ResetDataInput, ResetDataResult } from '@agentx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { EvidenceService } from '../evidence/evidence.service';
import { TypedConfigService } from '../config/typed-config.service';
import { ConflictError, ForbiddenError } from '../common/errors';

/**
 * Tables that are not application data.
 *
 * `_prisma_migrations` is the schema's own history. Emptying it makes the
 * database look unmigrated to Prisma, so the next `migrate deploy` replays every
 * migration against tables that already exist and fails — a reset that appears
 * to work and breaks the next deploy instead.
 */
const NOT_DATA = new Set(['_prisma_migrations']);

interface TableRow {
  name: string;
}

interface CountRow {
  n: number | bigint;
}

/**
 * Emptying the database without dropping it.
 *
 * The distinction matters and is the whole design: `migrate reset` drops the
 * schema and replays migrations, which needs the Prisma CLI, a writable
 * migrations directory, and a restart. This deletes rows. The tables, indexes,
 * and migration history are exactly as they were, so a running API keeps its
 * connection and its client stays valid.
 *
 * Tables are discovered from `sqlite_master` rather than listed here. A hardcoded
 * list is wrong the moment a model is added — and wrong silently, leaving one
 * table full while reporting success.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evidence: EvidenceService,
    private readonly config: TypedConfigService,
  ) {}

  async resetData(input: ResetDataInput): Promise<ResetDataResult> {
    if (this.config.get('NODE_ENV') === 'production') {
      // The API has no authentication of any kind. An unauthenticated endpoint
      // that empties the database is acceptable on a laptop and indefensible on
      // anything reachable, and `NODE_ENV` is the only signal available to tell
      // those apart.
      throw new ForbiddenError(
        'Refusing to delete all data: NODE_ENV is production, and this endpoint has no authentication.',
      );
    }

    if (!input.force) await this.refuseIfBusy();

    const tables = await this.dataTables();
    const deleted: Record<string, number> = {};

    // Foreign keys are disabled for the duration so the tables can be emptied in
    // any order. Re-enabling is in a `finally` — leaving a connection with
    // constraint checking off would let later writes create rows that reference
    // nothing, and nothing downstream would notice until a read failed.
    const foreignKeys = await this.foreignKeysEnabled();

    if (foreignKeys)
      await this.prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF');

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const table of tables) {
          const [{ n }] = await tx.$queryRawUnsafe<CountRow[]>(
            `SELECT COUNT(*) AS n FROM "${table}"`,
          );

          const count = Number(n);

          if (count > 0) deleted[table] = count;

          await tx.$executeRawUnsafe(`DELETE FROM "${table}"`);
        }
      });
    } finally {
      if (foreignKeys) {
        await this.prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
      }
    }

    const evidenceRemoved = input.evidence ? await this.clearEvidence() : null;

    const rowsDeleted = Object.values(deleted).reduce((sum, n) => sum + n, 0);

    this.logger.warn(
      `Data reset: ${rowsDeleted} row(s) deleted across ${Object.keys(deleted).length} of ${tables.length} table(s)${
        evidenceRemoved === true ? ', evidence tree emptied' : ''
      }. Schema left intact.`,
    );

    return {
      deleted: Object.fromEntries(
        Object.entries(deleted).sort(([, a], [, b]) => b - a),
      ),
      rowsDeleted,
      tablesCleared: Object.keys(deleted).length,
      evidenceRemoved,
      // Read back rather than assumed. This is the assertion that the tables were
      // emptied and not dropped, and it is the one thing a caller cannot check
      // for themselves without another round trip.
      tablesRemaining: (await this.dataTables()).length,
    };
  }

  /**
   * Refuses while a run or a check is still executing.
   *
   * Work in flight holds ids in memory and writes rows against them as it goes.
   * Delete the parents underneath it and the next write fails on a foreign key,
   * mid-run, with an error that describes a constraint rather than the reset
   * that caused it.
   *
   * Both queues are in-process, so a status left behind by a *previous* process
   * looks identical to live work from here. That is what `force` is for, and why
   * the message says which.
   */
  private async refuseIfBusy(): Promise<void> {
    const [runs, checks] = await Promise.all([
      this.prisma.execution.count({
        where: { status: { in: ['PENDING', 'RUNNING'] } },
      }),
      this.prisma.featureCheck.count({
        where: {
          status: { in: ['PENDING', 'PLANNING', 'REALIZING', 'RUNNING'] },
        },
      }),
    ]);

    if (runs === 0 && checks === 0) return;

    const busy = [
      runs > 0 ? `${runs} run(s)` : null,
      checks > 0 ? `${checks} feature check(s)` : null,
    ]
      .filter((one): one is string => one !== null)
      .join(' and ');

    throw new ConflictError(
      `${busy} still in a non-terminal state. Wait for them to finish, or restart the API to close them out. Send "force": true to delete anyway.`,
    );
  }

  /** Every table holding application data, newest-model-safe. */
  private async dataTables(): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<TableRow[]>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    );

    return rows.map((row) => row.name).filter((name) => !NOT_DATA.has(name));
  }

  private async foreignKeysEnabled(): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<
      { foreign_keys: number | bigint }[]
    >('PRAGMA foreign_keys');

    return Number(rows[0]?.foreign_keys ?? 0) === 1;
  }

  /**
   * Empties the evidence root, keeping the directory itself.
   *
   * Removing the root outright would work until the next run, which writes into
   * it via `mkdir --recursive` — but an `EVIDENCE_DIR` that briefly does not
   * exist is also one that a misconfigured path can silently recreate somewhere
   * else. Emptying in place cannot.
   */
  private async clearEvidence(): Promise<boolean> {
    const fs = await import('node:fs/promises');

    try {
      const entries = await fs.readdir(this.evidence.rootDir);

      // Each entry goes through `resolve`, so the same path-escape rule that
      // guards HTTP reads also guards this delete.
      await Promise.all(entries.map((entry) => this.evidence.removeDir(entry)));

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // A missing evidence root is nothing to report: there was no evidence.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;

      this.logger.warn(`Could not empty the evidence tree: ${message}`);
      return false;
    }
  }
}
