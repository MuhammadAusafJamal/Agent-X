import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { EnvValidationError, validateEnv } from './config/env.schema';
import { TypedConfigService } from './config/typed-config.service';

/**
 * Environment comes from either `.env`.
 *
 * `.env.example` lives at the repo root, so that is where people naturally copy
 * it to — but the API runs with `apps/api` as its working directory. Loading
 * both removes a footgun whose only symptom is the app refusing to start with a
 * key that is, as far as the operator is concerned, plainly set.
 *
 * `apps/api/.env` wins, because dotenv never overwrites an existing value.
 */
function loadEnvironment(): void {
  // Both anchored to __dirname, never to the working directory: `npm run
  // dev:api` runs from apps/api while `node apps/api/dist/main.js` runs from
  // the repo root, and a cwd-relative path silently resolves to the same file
  // twice in the second case — loading one .env and appearing to load two.
  dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
  dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });
}

loadEnvironment();

async function bootstrap(): Promise<void> {
  // Validate before the module graph loads. `ConfigModule.forRoot({ validate })`
  // runs at module-evaluation time, so a static `import './app.module'` would
  // throw during require — where Nest's own handler logs a dependency-injection
  // stack trace over the one thing the operator needs to read, which is the list
  // of missing keys. Checking here, then importing dynamically, keeps that
  // output clean.
  validateEnv(process.env);

  // The .js extension is required by nodenext resolution for a dynamic import;
  // TypeScript maps it back to app.module.ts.
  const { AppModule } = await import('./app.module.js');

  const app = await NestFactory.create(AppModule, { abortOnError: false });
  const config = app.get(TypedConfigService);

  app.enableCors({ origin: config.get('WEB_ORIGIN'), credentials: true });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const port = config.get('PORT');
  await app.listen(port);

  new Logger('Bootstrap').log(
    `API listening on http://localhost:${port} — CORS allows ${config.get('WEB_ORIGIN')}`,
  );
}

bootstrap().catch((error: unknown) => {
  const envError = findEnvValidationError(error);

  if (envError) {
    process.stderr.write(`\n${envError.message}\n\n`);
    process.exit(1);
  }

  process.stderr.write(
    `\nFailed to start the API:\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n\n`,
  );
  process.exit(1);
});

/** Nest may wrap a module-initialization failure, so walk the cause chain. */
function findEnvValidationError(error: unknown): EnvValidationError | null {
  let current = error;

  for (let depth = 0; depth < 10 && current instanceof Error; depth += 1) {
    if (current instanceof EnvValidationError) {
      return current;
    }
    current = current.cause;
  }

  return null;
}
