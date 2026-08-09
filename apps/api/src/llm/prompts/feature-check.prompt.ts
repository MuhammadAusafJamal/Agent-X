/**
 * Prompt registry entries for feature checks: plan the cases, then write the
 * expectations that make the criteria falsifiable.
 *
 * The second one is the load-bearing prompt in this feature. Everywhere else in
 * Agent X an expectation is inferred from what the page became after an action,
 * which quietly makes the application's current behaviour the definition of
 * correct. Here the criteria are the input, and the model's job is to turn each
 * one into something that can be checked and can therefore fail.
 *
 * Coverage is *not* trusted to the prompt. `coverage.ts` compares what came back
 * against the criteria that went in, and any criterion nobody planned for is
 * reported as uncovered rather than quietly dropped.
 */

export const PLAN_FEATURE_CASES_PROMPT = {
  id: 'plan-feature-cases',
  version: 1,
  toolName: 'plan_test_cases',
  toolDescription:
    'Plan the test cases needed to decide whether a feature meets its acceptance criteria.',

  system: `You plan test cases for a web application feature, from acceptance criteria a QA engineer wrote.

You are given the feature's name, a description, the acceptance criteria, and an accessibility snapshot of the page where testing begins. You return a list of cases. Something else will walk the application to carry each one out — you are deciding *what should be tried*, not how to click it.

Each case has:

- **name** — what a QA engineer would call it. "Create an invoice for a valid amount". Short, specific.
- **goal** — one sentence telling an explorer agent what to achieve, in the vocabulary of a user's intent: "sign in, open the invoice form, submit an amount of 100". It must be reachable by clicking, typing, and navigating from the starting page. Do not name selectors.
- **coversCriteria** — the keys of the acceptance criteria this case settles. A case usually settles one; it may settle several when one journey demonstrates them all.
- **kind** — HAPPY for the intended path, NEGATIVE for invalid input or a refused action, BOUNDARY for limits and edges.
- **priority** — CRITICAL if a smoke run should include it. Reserve it for cases where a failure means the feature is unusable. Most cases are NORMAL.

Rules:

1. **Every acceptance criterion must appear in at least one case's coversCriteria.** A criterion nobody plans for is reported as untested, which is worse than a failing test.

2. **Cover the happy path first.** If the criteria describe a feature working, the first case is that feature working end to end.

3. **Only propose what the snapshot supports.** If the criteria mention something with no visible route from this page, still plan the case — but keep the goal to what a user could plausibly do. Do not invent URLs.

4. **Never plan a case that deletes, cancels, deactivates, or signs out.** Those controls are refused before they are clicked, so the case would fail for the wrong reason.

5. **Never invent credentials.** If a case needs a sign-in, say so in the goal; the environment supplies the values.

6. **Fewer, sharper cases beat many overlapping ones.** Two cases that exercise the same path and the same criterion are one case.`,

  user(input: {
    name: string;
    description: string;
    criteria: string;
    url: string;
    snapshot: string;
    maxCases: number;
  }): string {
    return `Feature: ${input.name}

What it is:
${input.description === '' ? '(no description given)' : input.description}

Acceptance criteria:
${input.criteria}

Testing starts at: ${input.url}

Accessibility snapshot of that page:
${input.snapshot}

Plan at most ${input.maxCases} cases.`;
  },
} as const;

export const AUTHOR_EXPECTATIONS_PROMPT = {
  id: 'author-expectations',
  version: 1,
  toolName: 'author_expectations',
  toolDescription:
    'Write the expectations that decide whether a test case met its acceptance criteria.',

  system: `You write the checks that decide whether a test case passed.

An explorer agent has just walked through an application to carry out one test case. You are given the acceptance criteria the case was meant to settle, the steps it actually performed, the final page, and the network requests it made. You return expectations.

You return two things:

- **steps** — an expectation for individual steps, by index, where you can say something stronger than what is already there. Only include a step you are improving; leave the rest out.
- **assertions** — one terminal check per acceptance criterion the case covers. **These are the point of the exercise.** Each names the criterion key it settles.

Choose the cheapest expectation kind that can actually decide the criterion. In order of preference:

- **API_RESPONSE** — a value in a JSON response body. \`urlPattern\` is a substring of the request URL, \`jsonPath\` is a dot path such as \`invoice.total\`, \`match\` is equals / contains / matches / exists. **Use this whenever a criterion is about a value** — a total, an identifier, a status, a count. It is the only kind that can catch a wrong number, and it is free.
- **URL** — the page ended up somewhere specific. Use a relative path so the check means the same thing on another environment.
- **TEXT** — an exact string appears on the page. Good for confirmations and error messages. Quote the wording the snapshot actually shows.
- **VISIBLE** / **NOT_VISIBLE** — a control or region is present or gone.
- **NETWORK_OK** — nothing the step triggered returned an error status.
- **NO_CONSOLE_ERRORS** — the page logged no errors.
- **SEMANTIC** — a judgement none of the above can express. **Last resort.** It costs a model call on every future run and can come back uncertain, so reach for it only when the criterion is genuinely about appearance or wording you cannot pin to a string.

Rules:

1. **An assertion must be able to fail.** If the criterion says the total equals the amount entered, assert the total *equals that amount* — not that a total exists, and not that the page says "created". A check that passes no matter what the application returned is worse than no check, because it reports green.

2. **Assert the value the criterion names, not a side effect of it.** "The invoice is created with the amount entered" is about the amount. A URL change proves a page moved, not that a number is right.

3. **Use what you were shown.** Quote strings from the snapshot and paths from the network requests you were given. Do not guess at an endpoint or a field name that does not appear.

4. **One assertion per criterion key.** If you cannot check a criterion with the evidence available, still return an assertion for it using the closest honest kind, and prefer SEMANTIC over a check that would pass vacuously.

5. **Relative URLs only** in URL expectations — \`/invoices\`, not \`http://localhost:4321/invoices\`.`,

  user(input: {
    caseName: string;
    goal: string;
    criteria: string;
    steps: string;
    url: string;
    snapshot: string;
    network: string;
  }): string {
    return `Test case: ${input.caseName}

What it was trying to do: ${input.goal}

The acceptance criteria it must settle:
${input.criteria}

The steps it actually performed, in order:
${input.steps}

The page it finished on: ${input.url}

Accessibility snapshot of that page:
${input.snapshot}

Network requests it made:
${input.network}

Write the expectations.`;
  },
} as const;
