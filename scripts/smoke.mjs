/**
 * The happy path, against the real model.
 *
 * Every automated test in this repository stubs the LLM — `setup-e2e.ts` sets a
 * fake key, and each suite either overrides `LlmService` or asserts that no
 * model call happened. That is the right place for a test to sit: it makes them
 * fast, free, and deterministic. It also means the eight prompts under
 * `apps/api/src/llm/prompts/` are, strictly speaking, unverified.
 *
 * This closes that gap without putting a paid dependency into `npm test`. It
 * boots the real stack, runs the seeded specification against the real demo
 * app with a real key, and asserts the three properties the design rests on:
 *
 *   1. A healthy run passes with exactly ONE model call — the semantic step.
 *      This is the "deterministic before intelligent" claim, stated as a number.
 *   2. A drifted run is diagnosed TEST_DRIFT, healed, reverified, and passes.
 *      Not APP_BUG, which would mean the system heals over broken applications.
 *   3. Two runs of an unchanged application produce byte-identical report
 *      bodies. This is what makes a report worth diffing.
 *
 * Run it before a demo. `npm run smoke`.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { REPORT_BODY_MARKER } = require('@agentx/shared');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The same two files `main.ts` reads, anchored the same way and in the same
// order, so the key lives in exactly one place rather than also having to be
// exported into whatever shell happens to run this.
const dotenv = require('dotenv');
dotenv.config({ path: path.join(ROOT, 'apps', 'api', '.env') });
dotenv.config({ path: path.join(ROOT, '.env') });

const DEMO_PORT = Number(process.env.SMOKE_DEMO_PORT ?? 4331);
const API_PORT = Number(process.env.SMOKE_API_PORT ?? 3011);
const API = `http://localhost:${API_PORT}`;

const CREDENTIALS = {
  DEMO_APP_USER: 'demo@example.com',
  DEMO_APP_PASSWORD: 'hunter2',
};

/** Ports of its own, so a smoke run never collides with a dev server. */
const BASE_ENV = {
  ...process.env,
  ...CREDENTIALS,
  DEMO_PORT: String(DEMO_PORT),
  DEMO_APP_URL: `http://localhost:${DEMO_PORT}`,
  PORT: String(API_PORT),
  PLAYWRIGHT_HEADLESS: 'true',
};

const children = [];
let failures = 0;

async function main() {
  if (
    process.env.ANTHROPIC_API_KEY === undefined ||
    process.env.ANTHROPIC_API_KEY === ''
  ) {
    fail(
      'ANTHROPIC_API_KEY is not set. This script exists to exercise the real model, so there is nothing useful it can do without one.',
    );
    return;
  }

  step('Seeding the database');
  await run('npm', ['run', 'demo:setup'], BASE_ENV);

  step(`Starting the example app on ${DEMO_PORT}`);
  let demo = start('node', ['examples/demo-app/server.js'], BASE_ENV);
  await waitForHttp(`http://localhost:${DEMO_PORT}/`, 'the example app');

  step(`Starting the API on ${API_PORT}`);
  start('npm', ['run', 'start', '--workspace', '@agentx/api'], BASE_ENV);
  await waitForHttp(`${API}/health`, 'the API', 120_000);

  const spec = await seededSpec();
  const environmentId = await seededEnvironment(spec.applicationId);

  // ---- 1. Healthy run --------------------------------------------------

  step('Run 1 — healthy application');
  const first = await execute(spec.id, environmentId);

  assert(
    first.status === 'PASSED',
    `the healthy run passes (got ${first.status}${first.error === null ? '' : `: ${first.error}`})`,
  );
  assert(
    first.steps.every((s) => s.status === 'PASS'),
    `every step passes (got ${summarize(first)})`,
  );
  assert(
    first.totals.llmCallCount === 1,
    `exactly one model call — the semantic step (got ${first.totals.llmCallCount})`,
  );

  // ---- 2. Determinism --------------------------------------------------

  step('Run 2 — same application, unchanged');
  const second = await execute(spec.id, environmentId);
  assert(second.status === 'PASSED', 'the second healthy run also passes');

  const bodies = await Promise.all([
    reportBody(first.id),
    reportBody(second.id),
  ]);
  assert(
    bodies[0] === bodies[1],
    'two runs of an unchanged application produce byte-identical report bodies',
  );
  assert(
    bodies[0].length > 0,
    'the comparable body is not simply empty (which would make the check meaningless)',
  );

  // ---- 3. Drift, diagnosed and healed ----------------------------------

  step('Restarting the example app with BREAK_REDESIGN=1');
  await stop(demo);
  demo = start('node', ['examples/demo-app/server.js'], {
    ...BASE_ENV,
    BREAK_REDESIGN: '1',
  });
  await waitForHttp(`http://localhost:${DEMO_PORT}/`, 'the redesigned app');

  step('Run 3 — the submit button renamed and duplicated');
  const drifted = await execute(spec.id, environmentId);

  const diagnosed = drifted.steps.filter((s) => s.diagnosis !== null);
  const healed = drifted.steps.filter((s) => s.status === 'HEALED');

  assert(
    diagnosed.some((s) => s.diagnosis === 'TEST_DRIFT'),
    `a step is diagnosed TEST_DRIFT (got ${diagnosed.map((s) => s.diagnosis).join(', ') || 'no diagnosis at all'})`,
  );
  assert(
    !diagnosed.some((s) => s.diagnosis === 'APP_BUG'),
    'nothing is diagnosed APP_BUG — the application is fine, only the test drifted',
  );
  assert(healed.length > 0, 'at least one step healed and reverified');
  assert(
    drifted.status === 'PASSED',
    `the healed run passes overall (got ${drifted.status})`,
  );

  const queued = await json(`${API}/healings`);
  assert(
    queued.items.length > 0,
    'the repair is waiting in the healing queue for a human',
  );
}

// ---- assertions and output ---------------------------------------------

function step(message) {
  process.stdout.write(`\n${message}\n`);
}

function assert(condition, description) {
  if (condition) {
    process.stdout.write(`  ✓ ${description}\n`);
  } else {
    failures += 1;
    process.stdout.write(`  ✗ ${description}\n`);
  }
}

function fail(message) {
  failures += 1;
  process.stdout.write(`\n${message}\n`);
}

function summarize(execution) {
  return execution.steps
    .map((s) => `${s.index + 1}:${s.status}`)
    .join(' ');
}

// ---- the API ------------------------------------------------------------

async function json(url, init) {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${url} → ${response.status} ${await response.text()}`,
    );
  }

  return response.json();
}

async function seededSpec() {
  const specs = await json(`${API}/specs`);
  const spec = specs.items[0];

  if (spec === undefined) {
    throw new Error(
      'No specification found. `npm run demo:setup` should have seeded one.',
    );
  }

  return spec;
}

async function seededEnvironment(applicationId) {
  const environments = await json(
    `${API}/environments?applicationId=${applicationId}`,
  );
  const environment = environments.items[0];

  if (environment === undefined) {
    throw new Error('The seeded application has no environment.');
  }

  return environment.id;
}

const TERMINAL = ['PASSED', 'FAILED', 'UNCERTAIN', 'ERROR', 'CANCELLED'];

/** Starts a run and polls until it settles. Polling, not SSE — this is a script. */
async function execute(specId, environmentId) {
  const started = await json(`${API}/executions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ specId, environmentId }),
  });

  const deadline = Date.now() + 180_000;

  for (;;) {
    const execution = await json(`${API}/executions/${started.id}`);

    if (TERMINAL.includes(execution.status)) return execution;

    if (Date.now() > deadline) {
      throw new Error(
        `Run ${started.id} was still ${execution.status} after three minutes.`,
      );
    }

    await sleep(1000);
  }
}

/** The comparable half of a report — everything below the marker. */
async function reportBody(executionId) {
  const report = await json(`${API}/executions/${executionId}/report`);
  const index = report.markdown.indexOf(REPORT_BODY_MARKER);

  return index === -1
    ? report.markdown
    : report.markdown.slice(index + REPORT_BODY_MARKER.length);
}

// ---- processes ----------------------------------------------------------

function start(command, args, env) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  children.push(child);
  return child;
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'ignore', 'inherit'],
    });

    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)),
    );
  });
}

function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  return new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
    // Never hang the script on a process that will not go quietly.
    setTimeout(resolve, 5000).unref();
  });
}

async function waitForHttp(url, what, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }

    if (Date.now() > deadline) {
      throw new Error(`${what} did not come up at ${url}`);
    }

    await sleep(500);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- entry --------------------------------------------------------------

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await Promise.all(children.map(stop));

  if (failures === 0) {
    process.stdout.write('\nSmoke passed.\n');
    process.exit(0);
  } else {
    process.stdout.write(
      `\n${failures} check${failures === 1 ? '' : 's'} failed.\n`,
    );
    process.exit(1);
  }
}
