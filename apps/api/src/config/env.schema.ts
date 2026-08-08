import { urlSchema } from '@agentx/shared';
import { z } from 'zod';

/**
 * Environment configuration, validated before the app does any work.
 *
 * `CONTRIBUTING.md` requires config to be validated up front and to print
 * exactly what is missing. The failure mode this avoids: booting fine, running a
 * recording, compiling a spec, and only discovering at the first LLM call — ten
 * minutes and one headed browser later — that a key was never set.
 */

/**
 * Env vars are always strings. Accept the spellings people actually write, and
 * reject the ones that would silently read as `true` (`"no"`, `"off"`, `""`).
 */
const booleanFromEnv = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  /** CORS allowlist. The dashboard's dev server holds 3000, so the API takes 3001. */
  WEB_ORIGIN: urlSchema.default('http://localhost:3000'),

  /** Prisma connection string. Relative `file:` paths resolve against the repo root. */
  DATABASE_URL: z.string().min(1).default('file:data/agentx.db'),

  /** Root of the evidence tree. Artifact rows store paths relative to this. */
  EVIDENCE_DIR: z.string().min(1).default('../../data/evidence'),

  ANTHROPIC_API_KEY: z.string().min(1, {
    error: 'required — the agent cannot plan, verify, or diagnose without it',
  }),

  ANTHROPIC_MODEL: z.string().min(1).default('claude-sonnet-5'),

  /** The recorder needs a visible browser, so this defaults to headed. */
  PLAYWRIGHT_HEADLESS: booleanFromEnv.default(false),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Thrown when the environment is unusable. `main.ts` catches this specifically
 * and prints the message alone — a config mistake deserves a list of what to
 * fix, not a Nest dependency-injection stack trace.
 */
export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(
      [
        'Invalid environment configuration:',
        '',
        ...issues.map((issue) => `  - ${issue}`),
        '',
        'Copy .env.example to .env and fill in the missing values.',
      ].join('\n'),
    );
    this.name = 'EnvValidationError';
  }
}

/** Passed to `ConfigModule.forRoot({ validate })`. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => {
        const key = issue.path.join('.') || '(root)';
        return `${key}: ${issue.message}`;
      }),
    );
  }

  return result.data;
}
