"use client";

import Link from "next/link";
import { useState } from "react";
import {
  environmentSchema,
  featureCheckSchema,
  featureRunResultSchema,
  paginated,
  type FeatureCaseResult,
  type FeatureCheck,
} from "@agentx/shared";
import { Button } from "@/components/ui/button";
import { ErrorBanner, Loading } from "@/components/ui-bits";
import { apiFetch } from "@/lib/api";
import { describe, useResource } from "@/lib/use-api";
import { toast } from "@/lib/use-toast";
import { verdictClass } from "../feature-checks-list";

/**
 * One check: what was asked, what was tried, and what it decided.
 *
 * The criteria table is the screen. Everything else — the cases, the runs — is
 * how the verdicts were reached, and a person who trusts the verdicts should
 * never have to read it.
 */
export function FeatureCheckDetail({
  featureCheckId,
}: {
  featureCheckId: string;
}) {
  const check = useResource(
    () => apiFetch(`/feature-checks/${featureCheckId}`, featureCheckSchema),
    `feature-check:${featureCheckId}`,
    {
      pollMs: 2000,
      shouldPoll: (row) => row.status !== "COMPLETED" && row.status !== "FAILED",
    },
  );

  if (check.status === "loading") return <Loading what="this check" />;
  if (check.status === "error") return <ErrorBanner message={check.error} />;

  const data = check.data;

  return (
    <div className="space-y-6">
      <header>
        <Link
          href="/features"
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Feature checks
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{data.name}</h1>
          <span className="text-muted-foreground text-xs uppercase tracking-wide">
            {data.status}
          </span>
        </div>
        {data.description !== "" ? (
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            {data.description}
          </p>
        ) : null}
        {data.error !== null ? (
          <div className="mt-3">
            <ErrorBanner message={data.error} />
          </div>
        ) : null}
      </header>

      <Criteria check={data} />
      <Cases cases={data.cases} />
      <RunSuite check={data} />
    </div>
  );
}

function Criteria({ check }: { check: FeatureCheck }) {
  const verdictFor = (key: string) =>
    check.verdicts.find((verdict) => verdict.key === key);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Acceptance criteria</h2>

      <div className="border-border overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <tbody>
            {check.criteria.map((criterion) => {
              const verdict = verdictFor(criterion.key);
              const status = verdict?.status ?? "NOT_RUN";

              return (
                <tr key={criterion.key} className="border-border border-b last:border-0">
                  <td className="text-muted-foreground w-16 px-3 py-3 align-top font-mono text-xs">
                    {criterion.key}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <p>{criterion.text}</p>
                    {verdict?.rationale != null ? (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {verdict.rationale}
                      </p>
                    ) : null}
                    {verdict !== undefined && verdict.executionIds.length > 0 ? (
                      <div className="mt-1 flex gap-3">
                        {verdict.executionIds.map((id) => (
                          <Link
                            key={id}
                            href={`/executions/${id}`}
                            className="text-xs hover:underline"
                          >
                            Evidence →
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </td>
                  <td className="w-32 px-3 py-3 text-right align-top">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${verdictClass(status)}`}
                    >
                      {status.toLowerCase().replace("_", " ")}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {check.verdicts.some((verdict) => verdict.status === "UNCOVERED") ? (
        <p className="text-muted-foreground text-xs">
          An uncovered criterion is neither a pass nor a failure: no case was
          planned for it, so nothing was checked.
        </p>
      ) : null}
    </section>
  );
}

function Cases({ cases }: { cases: FeatureCaseResult[] }) {
  if (cases.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Cases</h2>

      <ul className="space-y-2">
        {cases.map((one, index) => (
          <li
            key={`${one.name}:${index}`}
            className="border-border rounded-lg border p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{one.name}</span>
              <span className="text-muted-foreground text-xs">
                {one.kind} · {one.priority}
                {one.status === null ? "" : ` · ${one.status}`}
              </span>
            </div>

            <p className="text-muted-foreground mt-1 text-xs">{one.goal}</p>

            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              {one.coversCriteria.map((key) => (
                <span key={key} className="text-muted-foreground font-mono">
                  {key}
                </span>
              ))}
              {one.specId !== null ? (
                <Link href={`/specs/${one.specId}`} className="hover:underline">
                  Specification →
                </Link>
              ) : null}
              {one.executionId !== null ? (
                <Link
                  href={`/executions/${one.executionId}`}
                  className="hover:underline"
                >
                  Run →
                </Link>
              ) : null}
            </div>

            {one.skippedBecause !== null ? (
              <p className="text-muted-foreground mt-2 text-xs">
                Not realized: {one.skippedBecause}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Re-running the saved suite.
 *
 * Regression is every case; smoke is the critical ones. Running against another
 * environment is the same call with a different id — which is why there is no
 * third button here.
 */
function RunSuite({ check }: { check: FeatureCheck }) {
  const [environmentId, setEnvironmentId] = useState(check.environmentId);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const environments = useResource(
    () =>
      apiFetch(
        `/environments?applicationId=${check.applicationId}`,
        paginated(environmentSchema),
      ),
    `environments:${check.applicationId}`,
  );

  const runnable = check.cases.some((one) => one.specId !== null);

  if (!runnable) return null;

  function run(filter: "ALL" | "CRITICAL") {
    setPending(filter);
    setFailure(null);

    apiFetch(`/features/${check.featureId}/runs`, featureRunResultSchema, {
      method: "POST",
      body: { environmentId, filter },
    })
      .then((result) => {
        toast.success(
          `Started ${result.executionIds.length} run${result.executionIds.length === 1 ? "" : "s"}`,
          result.skipped.length === 0
            ? "Watch them on the runs page."
            : `${result.skipped.length} spec(s) were skipped.`,
        );
      })
      .catch((error: unknown) => setFailure(describe(error)))
      .finally(() => setPending(null));
  }

  return (
    <section className="border-border space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="text-sm font-medium">Re-run this suite</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          The cases are ordinary specifications now. Point them at any
          environment for this application.
        </p>
      </div>

      {failure !== null ? <ErrorBanner message={failure} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Environment"
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          value={environmentId}
          onChange={(event) => setEnvironmentId(event.target.value)}
        >
          {environments.status === "ok"
            ? environments.data.items.map((environment) => (
                <option key={environment.id} value={environment.id}>
                  {environment.name} — {environment.baseUrl}
                </option>
              ))
            : null}
        </select>

        <Button
          onClick={() => run("ALL")}
          disabled={pending !== null}
          variant="outline"
        >
          {pending === "ALL" ? "Starting…" : "Regression (all cases)"}
        </Button>

        <Button
          onClick={() => run("CRITICAL")}
          disabled={pending !== null}
          variant="outline"
        >
          {pending === "CRITICAL" ? "Starting…" : "Smoke (critical only)"}
        </Button>
      </div>
    </section>
  );
}
