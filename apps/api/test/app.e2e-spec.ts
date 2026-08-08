import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { apiErrorSchema, healthResponseSchema } from '@agentx/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';

describe('API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    // Env comes from test/setup-e2e.ts — it has to be set before these imports
    // resolve, not here. See the comment in that file.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /health', () => {
    it('reports ok with a real database round-trip', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      // Parsed, not cast: this asserts the response actually matches the
      // contract the dashboard will parse it with.
      const body = healthResponseSchema.parse(response.body);

      expect(body.status).toBe('ok');
      expect(body.db).toBe(true);
      expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe('unknown routes', () => {
    it('return the shared error shape rather than Nest’s default body', async () => {
      const response = await request(app.getHttpServer())
        .get('/does-not-exist')
        .expect(404);

      const body = apiErrorSchema.parse(response.body);

      expect(body.statusCode).toBe(404);
      expect(body.code).toBe('NOT_FOUND');
      expect(body.path).toBe('/does-not-exist');
    });
  });
});
