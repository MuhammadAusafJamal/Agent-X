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

  /**
   * Root of the evidence tree. Artifact rows store paths relative to this.
   *
   * Like `DATABASE_URL`, a relative path is anchored to the **repo root** — not
   * to `apps/api`. The two defaults have to agree on that, because they did not
   * once: `../../data/evidence` resolved against the repo root put every
   * screenshot, trace, and video two directories *above* the project, outside
   * the checkout and outside `.gitignore`.
   */
  EVIDENCE_DIR: z.string().min(1).default('data/evidence'),

  ANTHROPIC_API_KEY: z.string().min(1, {
    error: 'required — the agent cannot plan, verify, or diagnose without it',
  }),

  ANTHROPIC_MODEL: z.string().min(1).default('claude-sonnet-5'),

  /** The recorder needs a visible browser, so this defaults to headed. */
  PLAYWRIGHT_HEADLESS: booleanFromEnv.default(false),

  /**
   * What one step, and one run, are allowed to cost.
   *
   * Every default below is the constant it replaced, so an unset environment
   * behaves exactly as the code did when these lived in `runner.service.ts` and
   * `observation-collector.ts`. They moved here because they were tuned against
   * `examples/demo-app` — a local server with no CDN, no analytics, and no
   * consent platform — and a real site needs different numbers without needing
   * a different build.
   */

  /** How long one step may take before it is failed. */
  AGENTX_STEP_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),

  /** How long a whole run may take before it is ended. */
  AGENTX_RUN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(300_000),

  /**
   * Ceiling on model calls for one run, shared by the resolver and the verifier.
   *
   * A guard against a pathological spec quietly costing a fortune — a run that
   * needs more than this is telling you its hints have rotted, not that it needs
   * a bigger allowance.
   */
  AGENTX_MAX_LLM_CALLS_PER_RUN: z.coerce.number().int().min(0).default(20),

  /**
   * How many responses a run remembers for `API_RESPONSE` checks.
   *
   * Reached inside the first step on a site with an analytics stack. Past it the
   * run-level log drops its oldest entries rather than refusing new ones, so the
   * expectations that read it keep working.
   */
  AGENTX_MAX_RUN_NETWORK: z.coerce.number().int().min(1).default(400),

  /** How many responses one step records as its own evidence. */
  AGENTX_MAX_STEP_NETWORK: z.coerce.number().int().min(1).default(200),

  /**
   * How much of the accessibility tree reaches a prompt.
   *
   * A snapshot cut here is a page the model can only see the top of, which on a
   * long marketing page means it resolves against the header and nothing else.
   */
  AGENTX_MAX_SNAPSHOT_CHARS: z.coerce.number().int().min(500).default(6000),

  /**
   * Refuse anything that would change the world outside the browser.
   *
   * For a site you do not own. The explorer and the feature checker walk an
   * application by choosing their own moves, and their existing bounds refuse
   * what would *damage* it — delete, cancel, sign out. Those bounds say nothing
   * about a newsletter signup, an enquiry form, or a booking, because on your
   * own staging environment those are fine.
   *
   * With this set they navigate, click controls that only read, hover, and
   * scroll. They do not type into anything at all: deciding which text field is
   * safe to fill is a judgement call, and refusing every one of them is a rule.
   */
  AGENTX_READ_ONLY_TARGET: booleanFromEnv.default(false),

  /**
   * Shortest gap between two actions against the site under test.
   *
   * Zero locally. On a third party's site, a request rate no human could produce
   * is what gets an IP blocked, and being blocked presents as every rung of the
   * resolver failing at once — the single hardest failure to read from evidence.
   */
  AGENTX_MIN_ACTION_INTERVAL_MS: z.coerce.number().int().min(0).default(0),

  /**
   * On boot, close out runs and checks left mid-flight by the previous process.
   *
   * Rests on an assumption worth stating: **one API process per database**. The
   * queues are in memory, so a `RUNNING` row with no process behind it is
   * stranded — but this process cannot tell "nobody is driving that" from
   * "somebody else is driving that". Where a second instance shares the file,
   * booting one would error the other's live runs.
   *
   * That is the single-instance design everywhere except the e2e harness, which
   * starts an app per test file against one database on purpose. `setup-e2e.ts`
   * turns this off for exactly that reason.
   */
  AGENTX_SWEEP_INTERRUPTED_ON_BOOT: booleanFromEnv.default(true),
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
