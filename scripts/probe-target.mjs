/**
 * Measures a real website before Agent X is pointed at it.
 *
 * Every budget, timeout, and bound in this codebase was chosen against
 * `examples/demo-app` — a 358-line zero-dependency server on localhost. A real
 * site fronted by a CDN, an analytics stack, and a consent platform breaks
 * several of those assumptions at once, and it breaks them *silently*: the
 * network cap is hit inside step one, the per-step observation buffer stops
 * filling, every later verification escalates to the model, the model budget
 * runs out, and the run ends `UNCERTAIN` with no evidence pointing at the cause.
 *
 * So: measure first, then decide. This asserts nothing and changes nothing. It
 * opens the target twice — headless and headed — records eight things, and
 * prints the decision each one drives. It writes screenshots, ARIA snapshots,
 * and a JSON summary to a directory outside the repository.
 *
 * ```
 * npm run probe                                    # the default target
 * npm run probe -- https://example.com             # some other one
 * PROBE_OUT=/some/dir npm run probe                # somewhere else to write
 * ```
 *
 * It is deliberately not part of `npm test`: it reaches the public internet,
 * takes minutes, and its output is evidence for a human rather than a pass/fail.
 *
 * **It only ever reads.** It navigates, it screenshots, and it asks Playwright
 * whether a click *would* succeed — `{ trial: true }` runs the actionability
 * checks and then does not click. Nothing here submits a form, and nothing here
 * loads a page more than a handful of times. The target is somebody else's
 * website.
 */

import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const TARGET =
  process.argv[2] ?? process.env.PROBE_TARGET ?? 'https://visitabudhabi.ae/en';

const OUT =
  process.env.PROBE_OUT ?? path.join(os.tmpdir(), 'agentx-probe');

/** The caps this run is measured against, mirrored from the source that owns them. */
const LIMITS = {
  // apps/api/src/runner/observation-collector.ts
  MAX_PER_RUN: 400,
  MAX_PER_STEP: 200,
  // apps/api/src/resolver/resolver.service.ts, verifier.service.ts, explorer.service.ts
  MAX_SNAPSHOT_CHARS: 6000,
  // apps/api/src/runner/runner.service.ts
  STEP_TIMEOUT_MS: 15_000,
  RUN_TIMEOUT_MS: 5 * 60_000,
};

/** How long to watch traffic after the page reports it is loaded. */
const TRAFFIC_WINDOW_MS = 30_000;

/** Reloads used to measure how much of the page is stable between visits. */
const CHURN_RELOADS = 3;
const CHURN_INTERVAL_MS = 10_000;

/**
 * Body text a WAF challenge page shows instead of the site.
 *
 * Matched against text rather than status, because several of these are served
 * with a perfectly ordinary 200.
 */
const WAF_MARKERS = [
  'Just a moment',
  'Access Denied',
  'Attention Required',
  'cf-browser-verification',
  'Checking your browser',
  'Request unsuccessful',
  'Pardon Our Interruption',
  'unusual traffic',
];

const CONSENT_NAME =
  /accept|agree|consent|cookie|got it|allow all|reject|decline|manage/i;

// -----------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  say(`Target   ${TARGET}`);
  say(`Output   ${OUT}`);
  say('');

  const results = {};

  for (const headless of [true, false]) {
    const mode = headless ? 'headless' : 'headed';
    say(`── ${mode} ${'─'.repeat(60 - mode.length)}`);

    try {
      results[mode] = await probe(headless);
    } catch (error) {
      results[mode] = { fatal: message(error) };
      say(`  FATAL  ${message(error)}`);
    }

    say('');
  }

  results.robots = await robots(TARGET);
  results.target = TARGET;
  results.limits = LIMITS;

  const file = path.join(OUT, 'probe.json');
  fs.writeFileSync(file, JSON.stringify(results, null, 2));

  verdicts(results);

  say('');
  say(`Wrote ${file}`);
}

/**
 * One full pass in one launch mode.
 *
 * The order matters: traffic is watched from before the first byte, the ARIA
 * snapshot is taken once the page has settled, and the churn reloads come last
 * so the earlier numbers describe a first visit rather than a warm cache.
 */
async function probe(headless) {
  const mode = headless ? 'headless' : 'headed';
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  const responses = [];
  context.on('response', (response) => {
    responses.push({
      url: response.url(),
      status: response.status(),
      resourceType: response.request().resourceType(),
    });
  });

  const out = { mode };

  try {
    // (1) reachability and timing ---------------------------------------------
    const startedAt = Date.now();
    const response = await page.goto(TARGET, {
      waitUntil: 'commit',
      timeout: 60_000,
    });

    out.status = response === null ? null : response.status();
    out.commitMs = Date.now() - startedAt;
    out.domContentLoadedMs = await settle(page, 'domcontentloaded', startedAt);
    out.loadMs = await settle(page, 'load', startedAt);
    out.networkIdleMs = await settle(page, 'networkidle', startedAt, 45_000);

    const body = await page.locator('body').innerText().catch(() => '');
    out.wafMarkers = WAF_MARKERS.filter((marker) => body.includes(marker));
    out.title = await page.title().catch(() => '');

    const shot = path.join(OUT, `${mode}.jpg`);
    await page
      .screenshot({ path: shot, quality: 60, type: 'jpeg' })
      .catch(() => undefined);
    out.screenshot = shot;

    say(
      `  status ${out.status}  dcl ${out.domContentLoadedMs}ms  load ${out.loadMs}ms  idle ${fmt(out.networkIdleMs)}`,
    );

    if (out.wafMarkers.length > 0) {
      say(`  WAF markers in body: ${out.wafMarkers.join(', ')}`);
    }

    // (3) where the redirects landed ------------------------------------------
    out.finalUrl = page.url();
    out.requestedOrigin = new URL(TARGET).origin;
    out.finalOrigin = new URL(out.finalUrl).origin;
    out.originMatches = out.requestedOrigin === out.finalOrigin;

    if (!out.originMatches) {
      say(`  origin moved ${out.requestedOrigin} -> ${out.finalOrigin}`);
    }

    // (2) traffic volume -------------------------------------------------------
    const watchUntil = Date.now() + TRAFFIC_WINDOW_MS;
    while (Date.now() < watchUntil) await sleep(500);

    out.responseCount = responses.length;
    out.byResourceType = tally(responses.map((one) => one.resourceType));
    out.origins = [...new Set(responses.map((one) => originOf(one.url)))].sort();
    out.nonOkCount = responses.filter(
      (one) => one.status >= 400 && one.status !== 0,
    ).length;
    out.heavyTypes = ['image', 'font', 'media', 'stylesheet'].reduce(
      (sum, type) => sum + (out.byResourceType[type] ?? 0),
      0,
    );

    say(
      `  ${out.responseCount} responses in ${TRAFFIC_WINDOW_MS / 1000}s across ${out.origins.length} origins (${out.heavyTypes} of them image/font/media/css)`,
    );

    // (5) how much page the model would actually see ---------------------------
    const snapshot = await page
      .locator('body')
      .ariaSnapshot()
      .catch(() => '');

    out.snapshotChars = snapshot.length;
    out.snapshotLines = snapshot === '' ? 0 : snapshot.split('\n').length;
    fs.writeFileSync(path.join(OUT, `${mode}.aria.txt`), snapshot);

    say(
      `  ARIA snapshot ${out.snapshotChars} chars (cap ${LIMITS.MAX_SNAPSHOT_CHARS}, ${pct(LIMITS.MAX_SNAPSHOT_CHARS, out.snapshotChars)} visible)`,
    );

    // (4) consent overlay ------------------------------------------------------
    out.consentCandidates = await namesMatching(page, CONSENT_NAME);
    out.interception = await trialClick(page);

    if (out.consentCandidates.length > 0) {
      say(`  consent-ish controls: ${out.consentCandidates.join(' | ')}`);
    }

    say(
      `  trial click on first link: ${out.interception.ok ? 'would succeed' : out.interception.reason}`,
    );

    // (7) forms, so the read-only bounds know what they are refusing -----------
    out.forms = await page
      .$$eval('form', (forms) =>
        forms.map((form) => ({
          action: form.getAttribute('action'),
          method: (form.getAttribute('method') ?? 'get').toLowerCase(),
          submits: [
            ...form.querySelectorAll(
              'button, input[type=submit], input[type=button]',
            ),
          ]
            .map((el) =>
              (
                el.getAttribute('aria-label') ??
                el.textContent ??
                el.getAttribute('value') ??
                ''
              ).trim(),
            )
            .filter((name) => name !== ''),
          fields: form.querySelectorAll('input, textarea, select').length,
        })),
      )
      .catch(() => []);

    say(`  ${out.forms.length} form(s) on the landing page`);

    // (6) churn ----------------------------------------------------------------
    out.churn = [];

    for (let round = 1; round <= CHURN_RELOADS; round += 1) {
      await sleep(CHURN_INTERVAL_MS);
      await page.reload({ waitUntil: 'load', timeout: 60_000 });

      const again = await page
        .locator('body')
        .ariaSnapshot()
        .catch(() => '');

      out.churn.push(lineDrift(snapshot, again));
    }

    say(
      `  ARIA drift over ${CHURN_RELOADS} reloads: ${out.churn.map((one) => `${one}%`).join(', ')}`,
    );
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }

  return out;
}

/**
 * Whether a click would be allowed to happen, without letting it happen.
 *
 * `{ trial: true }` runs Playwright's actionability checks — visible, stable,
 * receives events, enabled — and then returns instead of dispatching. A full
 * screen consent overlay fails the third of those with `intercepts pointer
 * events`, which is the one piece of evidence that separates "the resolver
 * needs an overlay pass" from "the resolver is fine".
 */
async function trialClick(page) {
  const link = page.getByRole('link').first();

  try {
    await link.click({ trial: true, timeout: 5000 });
    return { ok: true, reason: null };
  } catch (error) {
    const text = message(error);

    return {
      ok: false,
      intercepted: /intercepts pointer events/i.test(text),
      reason: text.split('\n')[0],
    };
  }
}

/** Accessible names of buttons and links matching a pattern. */
async function namesMatching(page, pattern) {
  const names = await page
    .$$eval('button, a, [role=button]', (nodes) =>
      nodes
        .map((node) =>
          (node.getAttribute('aria-label') ?? node.textContent ?? '').trim(),
        )
        .filter((name) => name !== '' && name.length < 60),
    )
    .catch(() => []);

  return [...new Set(names.filter((name) => pattern.test(name)))].slice(0, 12);
}

/** Milliseconds from navigation start to a load state, or null if it never came. */
async function settle(page, state, startedAt, timeout = 30_000) {
  try {
    await page.waitForLoadState(state, { timeout });
    return Date.now() - startedAt;
  } catch {
    return null;
  }
}

/** Percentage of lines that differ between two ARIA snapshots. */
function lineDrift(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const seen = new Set(b);
  const changed = a.filter((line) => !seen.has(line)).length;
  const total = Math.max(a.length, b.length, 1);

  return Math.round((changed / total) * 100);
}

async function robots(target) {
  const url = new URL('/robots.txt', target).toString();

  try {
    const response = await fetch(url);
    const text = await response.text();

    return { url, status: response.status, body: text.slice(0, 2000) };
  } catch (error) {
    return { url, error: message(error) };
  }
}

/**
 * The point of the whole script: each measurement, and what it decides.
 *
 * Written out rather than left as numbers in a JSON file, because the decisions
 * are the deliverable and a number without its threshold beside it is a number
 * somebody has to go and look up.
 */
function verdicts(results) {
  const headless = results.headless ?? {};
  const headed = results.headed ?? {};

  say('── verdicts ' + '─'.repeat(52));

  const blocked = (one) =>
    one.fatal !== undefined ||
    (one.wafMarkers ?? []).length > 0 ||
    [403, 429, 503].includes(one.status);

  if (blocked(headless) && blocked(headed)) {
    say('  WAF     BOTH MODES BLOCKED. Stop; do not fight it. Pick another target.');
  } else if (blocked(headless)) {
    say('  WAF     headless blocked, headed clean -> PLAYWRIGHT_HEADLESS=false,');
    say('          which pins AGENTX_MAX_CONCURRENT_RUNS to 1 in Phase C.');
  } else {
    say('  WAF     clean in both modes -> headless is viable.');
  }

  const worst = Math.max(headless.responseCount ?? 0, headed.responseCount ?? 0);

  if (worst >= LIMITS.MAX_PER_RUN) {
    say(
      `  NETWORK ${worst} responses vs MAX_PER_RUN ${LIMITS.MAX_PER_RUN} -> A1 is MANDATORY.`,
    );
    say('          The cap is hit inside step 1 and the per-step buffer stops filling.');
  } else {
    say(`  NETWORK ${worst} responses, under the ${LIMITS.MAX_PER_RUN} cap.`);
  }

  const chars = Math.max(headless.snapshotChars ?? 0, headed.snapshotChars ?? 0);

  if (chars > LIMITS.MAX_SNAPSHOT_CHARS) {
    say(
      `  SNAPSHOT ${chars} chars vs cap ${LIMITS.MAX_SNAPSHOT_CHARS} -> the model sees the top ${pct(LIMITS.MAX_SNAPSHOT_CHARS, chars)} of the page only.`,
    );
  } else {
    say(`  SNAPSHOT ${chars} chars, fits under the cap.`);
  }

  const intercepted =
    headless.interception?.intercepted === true ||
    headed.interception?.intercepted === true;

  if (intercepted) {
    say('  OVERLAY intercepts pointer events -> build A2 option 1 (runner/overlay.ts).');
  } else if (
    (headless.consentCandidates ?? headed.consentCandidates ?? []).length > 0
  ) {
    say('  OVERLAY consent controls present but clicks are not blocked ->');
    say('          A2 option 2 is enough: record the dismissal, compiler marks it optional.');
  } else {
    say('  OVERLAY none detected.');
  }

  const drift = [...(headless.churn ?? []), ...(headed.churn ?? [])];

  if (drift.length > 0) {
    const worstDrift = Math.max(...drift);
    say(
      `  CHURN   up to ${worstDrift}% of ARIA lines change between reloads -> ${
        worstDrift > 10
          ? 'TEXT and SEMANTIC expectations will not hold. URL + VISIBLE only.'
          : 'VISIBLE expectations on landmarks should hold.'
      }`,
    );
  }

  const forms = headless.forms ?? headed.forms ?? [];
  const posts = forms.filter((form) => form.method === 'post');

  if (posts.length > 0) {
    say(
      `  FORMS   ${posts.length} POST form(s): ${posts
        .flatMap((form) => form.submits)
        .slice(0, 6)
        .join(' | ')}`,
    );
    say('          -> AGENTX_READ_ONLY_TARGET=true before the explorer sees this site.');
  } else {
    say(`  FORMS   ${forms.length} form(s), none POST.`);
  }

  const slow = Math.max(headless.loadMs ?? 0, headed.loadMs ?? 0);

  if (slow > LIMITS.STEP_TIMEOUT_MS) {
    say(
      `  TIMING  load took ${slow}ms vs STEP_TIMEOUT_MS ${LIMITS.STEP_TIMEOUT_MS} -> raise AGENTX_STEP_TIMEOUT_MS / AGENTX_NAV_TIMEOUT_MS.`,
    );
  } else {
    say(`  TIMING  load ${slow}ms, inside the ${LIMITS.STEP_TIMEOUT_MS}ms step timeout.`);
  }

  if (results.robots?.status === 200) {
    say('  ROBOTS  fetched; read it before scheduling anything against this site.');
  }
}

// -----------------------------------------------------------------------------

function tally(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '(unparseable)';
  }
}

function pct(part, whole) {
  if (whole === 0) return '100%';
  return `${Math.min(100, Math.round((part / whole) * 100))}%`;
}

function fmt(value) {
  return value === null ? 'never' : `${value}ms`;
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function say(line) {
  process.stdout.write(`${line}\n`);
}

main().catch((error) => {
  process.stderr.write(`probe failed: ${message(error)}\n`);
  process.exitCode = 1;
});
