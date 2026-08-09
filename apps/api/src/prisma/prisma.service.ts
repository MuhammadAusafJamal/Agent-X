import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client';
import {
  ensureDatabaseDir,
  resolveDatabasePath,
  resolveDatabaseUrl,
} from './database-url';

/**
 * The database.
 *
 * Prisma 7 dropped the Rust query engine, so SQLite is reached through a driver
 * adapter over better-sqlite3 rather than through a connection string alone.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const url = resolveDatabaseUrl();

    ensureDatabaseDir();

    super({ adapter: new PrismaBetterSqlite3({ url }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log(`Connected to SQLite at ${resolveDatabasePath()}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Backs the `db` flag on `GET /health`.
   *
   * Deliberately queries a real table rather than `SELECT 1`. SQLite happily
   * opens — and silently creates — an empty file, so `SELECT 1` returns green
   * against a database with no schema at all. That is not hypothetical: a
   * `DATABASE_URL` left pointing at Prisma's `./dev.db` default reports healthy
   * right up until the first real query. Counting a table fails immediately
   * instead.
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.project.count();
      return true;
    } catch (error) {
      this.logger.error(
        `Database health check failed for ${resolveDatabasePath()} — is it migrated? (npm run db:migrate)`,
        error as Error,
      );
      return false;
    }
  }
}
