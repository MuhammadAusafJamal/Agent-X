import * as dotenv from 'dotenv';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  resolveDatabasePath,
  resolveDatabaseUrl,
} from '../src/prisma/database-url';
import type { DraftTestStep } from '@agentx/shared';

/**
 * The same two `.env` files the API loads, anchored the same way.
 *
 * Without this the seed writes to `data/agentx.db` — the fallback — while an API
 * configured with a `DATABASE_URL` reads somewhere else entirely, and the demo
 * shows an empty dashboard with no error anywhere to explain it.
 */
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

/**
 * Everything a clean clone needs to demo without recording anything by hand.
 *
 * Recording is the headline input path and the thing worth showing a person, but
 * it needs a human at a browser. This seeds the *output* of that step — a
 * project, an application, an environment, and a specification written the way
 * the compiler writes them — so `npm run demo` reaches a passing run on its own.
 *
 * Idempotent by name: running it twice leaves one of everything. It never
 * deletes, because the database it runs against is usually one somebody has been
 * working in.
 */

const DEMO_URL = process.env['DEMO_APP_URL'] ?? 'http://localhost:4321';

/**
 * The demo application's own hard-coded account, mirrored from
 * `examples/demo-app/server.js`.
 *
 * Seeded as literals rather than as `ENV_REF`s so a clean clone reaches a
 * passing run with nothing exported: `npm run dev` is enough, and
 * `MissingCredentialError` cannot fire on a credential that was never a
 * reference. The env vars still win when they are set, so `npm run demo` and
 * `npm run smoke` behave exactly as before.
 *
 * This is safe *only* because the demo app's account is public and local. A
 * real application's credentials belong in `credentialRefs` and `ENV_REF`,
 * which is the path everything else in the codebase is built around — literals
 * are written to SQLite, and from there they can reach evidence and reports.
 */
const DEMO_USER = process.env['DEMO_APP_USER'] ?? 'demo@example.com';
const DEMO_PASSWORD = process.env['DEMO_APP_PASSWORD'] ?? 'hunter2';

// Prisma 7 reaches SQLite through a driver adapter, the same way the app does.
fs.mkdirSync(path.dirname(resolveDatabasePath()), { recursive: true });

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: resolveDatabaseUrl() }),
});

/**
 * The sign-in flow, as a recording of it would compile.
 *
 * The hints are what the recorder captures — role, accessible name, test id,
 * landmark — with the *description* carrying the intent. That split is the whole
 * premise: rename the button and the hints go stale while the description stays
 * true, which is what Phase 5 and Phase 6 demo against.
 */
const SIGN_IN_STEPS: DraftTestStep[] = [
  {
    intent: 'open the sign-in page',
    action: 'NAVIGATE',
    targetDescription: null,
    targetHints: { selectorCandidates: [] },
    data: { kind: 'LITERAL', value: DEMO_URL },
    expectation: { kind: 'TEXT', value: 'Sign in' },
    optional: false,
  },
  {
    intent: 'enter the email address of the seeded user',
    action: 'FILL',
    targetDescription: 'the email field in the sign-in form',
    targetHints: {
      role: 'textbox',
      name: 'Email',
      landmark: 'form "Sign in"',
      selectorCandidates: [{ strategy: 'CSS', value: '#email', score: 0.8 }],
    },
    data: { kind: 'LITERAL', value: DEMO_USER },
    expectation: { kind: 'TEXT', value: 'Password' },
    optional: false,
  },
  {
    intent: 'enter the password',
    action: 'FILL',
    targetDescription: 'the password field in the sign-in form',
    targetHints: {
      landmark: 'form "Sign in"',
      selectorCandidates: [{ strategy: 'CSS', value: '#password', score: 0.9 }],
    },
    data: { kind: 'LITERAL', value: DEMO_PASSWORD },
    expectation: { kind: 'TEXT', value: 'Password' },
    optional: false,
  },
  {
    intent: 'submit the sign-in form',
    action: 'CLICK',
    targetDescription: 'the primary submit button in the sign-in form',
    targetHints: {
      role: 'button',
      name: 'Sign in',
      testId: 'login-submit',
      text: 'Sign in',
      landmark: 'form "Sign in"',
      selectorCandidates: [],
    },
    data: null,
    expectation: { kind: 'URL', match: 'prefix', value: '/dashboard' },
    optional: false,
  },
  {
    intent: 'confirm the dashboard greets the signed-in user',
    action: 'ASSERT',
    targetDescription: null,
    targetHints: { selectorCandidates: [] },
    data: null,
    // Semantic on purpose: it is the step that shows the verifier escalating
    // when BREAK_MESSAGE changes the wording.
    expectation: {
      kind: 'SEMANTIC',
      description: 'the page confirms the user is signed in',
    },
    optional: false,
  },
];

async function main(): Promise<void> {
  const project = await upsertProject();

  const application = await upsertApplication(project.id);
  const environment = await upsertEnvironment(application.id);

  const spec = await upsertSpec(application.id);

  // A version is only written when there is not already one, so re-seeding does
  // not bury a spec somebody edited under a fresh copy of the original.
  const versions = await prisma.testVersion.count({
    where: { specId: spec.id },
  });

  if (versions === 0) {
    await writeVersion(spec.id);
  }

  process.stdout.write(
    [
      'Seeded:',
      `  project      ${project.name}`,
      `  application  ${application.name} → ${application.baseUrl}`,
      `  environment  ${environment.name}`,
      `  spec         ${spec.name} (${SIGN_IN_STEPS.length} steps${
        versions === 0 ? '' : ', existing version kept'
      })`,
      '',
      `Signs in as ${DEMO_USER}. Set DEMO_APP_USER and DEMO_APP_PASSWORD before`,
      'seeding to use a different account.',
      '',
    ].join('\n'),
  );
}

async function upsertProject() {
  const existing = await prisma.project.findFirst({
    where: { name: 'Agent X demo' },
  });

  return (
    existing ??
    prisma.project.create({
      data: {
        name: 'Agent X demo',
        description:
          'A worked example against the deliberately-breakable app in examples/demo-app.',
      },
    })
  );
}

async function upsertApplication(projectId: string) {
  const existing = await prisma.application.findFirst({
    where: { projectId, name: 'Demo Shop' },
  });

  if (existing !== null) {
    return prisma.application.update({
      where: { id: existing.id },
      data: { baseUrl: DEMO_URL },
    });
  }

  return prisma.application.create({
    data: {
      projectId,
      name: 'Demo Shop',
      baseUrl: DEMO_URL,
      description:
        'A small storefront with a sign-in and an invoice form. Every failure mode Agent X tells apart has a switch in its server.',
    },
  });
}

async function upsertEnvironment(applicationId: string) {
  // Empty on purpose: the seeded spec carries its credentials as literals, so
  // there is nothing to resolve and nothing to fail on. Point this at real
  // variable names the moment a spec here needs a real secret.
  const credentialRefs = JSON.stringify({ extra: {} });

  const existing = await prisma.environment.findFirst({
    where: { applicationId, name: 'local' },
  });

  if (existing !== null) {
    return prisma.environment.update({
      where: { id: existing.id },
      data: { baseUrl: DEMO_URL, credentialRefs },
    });
  }

  return prisma.environment.create({
    data: {
      applicationId,
      name: 'local',
      baseUrl: DEMO_URL,
      credentialRefs,
    },
  });
}

async function upsertSpec(applicationId: string) {
  const existing = await prisma.testSpec.findFirst({
    where: { applicationId, name: 'Sign in as the seeded user' },
  });

  return (
    existing ??
    prisma.testSpec.create({
      data: {
        applicationId,
        name: 'Sign in as the seeded user',
        description:
          'The flow every demo starts from: open the sign-in page, authenticate, and land on the dashboard.',
        source: 'RECORDED',
      },
    })
  );
}

/**
 * Writes version 1 and points the spec at it.
 *
 * Deliberately not calling `SpecsService`: a seed script that boots the whole
 * Nest application to insert five rows is a seed script that fails for reasons
 * having nothing to do with seeding.
 */
async function writeVersion(specId: string): Promise<void> {
  const version = await prisma.testVersion.create({
    data: {
      specId,
      version: 1,
      source: 'RECORDED',
      note: 'seeded',
    },
  });

  for (const [index, step] of SIGN_IN_STEPS.entries()) {
    await prisma.testStep.create({
      data: {
        versionId: version.id,
        index,
        intent: step.intent,
        action: step.action,
        targetDescription: step.targetDescription,
        targetHints: JSON.stringify(step.targetHints),
        data: step.data === null ? null : JSON.stringify(step.data),
        expectation: JSON.stringify(step.expectation),
        optional: step.optional,
      },
    });
  }

  await prisma.testSpec.update({
    where: { id: specId },
    data: { currentVersionId: version.id },
  });
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Seeding failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
