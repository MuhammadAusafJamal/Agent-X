import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@agentx/shared';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness plus a real database round-trip — a health check that only proves
   * the process is up would report green with an unreachable database, which is
   * the one failure this endpoint exists to catch.
   */
  @Get()
  async check(): Promise<HealthResponse> {
    return {
      status: 'ok',
      version: process.env['npm_package_version'] ?? '0.0.0',
      db: await this.prisma.isHealthy(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
