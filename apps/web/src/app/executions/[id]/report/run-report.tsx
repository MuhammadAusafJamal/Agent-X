"use client";

import Link from "next/link";
import { useState } from "react";
import { reportSchema } from "@agentx/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/executions/status-badge";
import { ErrorBanner, Loading } from "@/components/ui-bits";
import { API_BASE_URL, apiFetch, evidenceUrl } from "@/lib/api";
import { useResource } from "@/lib/use-api";

/**
 * A run, written down.
 *
 * The page renders the structured document rather than the Markdown, so
 * evidence stays clickable — but the Markdown is what the download button
 * serves, and the two are generated from the same source.
 */
export function RunReport({ executionId }: { executionId: string }) {
  const [copied, setCopied] = useState(false);

  const resource = useResource(
    () => apiFetch(`/executions/${executionId}/report`, reportSchema),
    `${executionId}-report`,
  );

  if (resource.status === "loading") return <Loading what="the report" />;

  if (resource.status === "error") {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <ErrorBanner message={resource.error} />
        <Link href={`/executions/${executionId}`} className="text-sm underline">
          Back to the run
        </Link>
      </div>
    );
  }

  const { markdown, json } = resource.data;
  const { run, body } = json;

  function copy() {
    void navigator.clipboard.writeText(markdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href={`/executions/${executionId}`}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        ← Run
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">
            {body.specName}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            version {run.specVersion} · {body.environmentName} ·{" "}
            {new Date(run.startedAt).toLocaleString()}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <StatusBadge status={body.status} />
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? "Copied" : "Copy Markdown"}
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a
              href={`${API_BASE_URL}/executions/${executionId}/report/markdown`}
            >
              Download
            </a>
          </Button>
        </div>
      </div>

      <div className="border-border bg-card grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-4">
        <Figure label="Steps" value={String(body.counts.total)} />
        <Figure label="Passed" value={String(body.counts.passed)} />
        <Figure
          label="Healed"
          value={String(body.counts.healed)}
          muted={body.counts.healed === 0}
        />
        <Figure
          label="Failed"
          value={String(body.counts.failed)}
          muted={body.counts.failed === 0}
        />
        <Figure
          label="Duration"
          value={run.durationMs === null ? "—" : `${run.durationMs} ms`}
        />
        <Figure label="Model calls" value={String(run.llmCallCount)} />
        <Figure
          label="Tokens"
          value={
            run.llmCallCount === 0
              ? "—"
              : `${run.inputTokens} / ${run.outputTokens}`
          }
        />
        <Figure
          label="Uncertain"
          value={String(body.counts.uncertain)}
          muted={body.counts.uncertain === 0}
        />
      </div>

      {/* Two runs of an unchanged application produce the same bytes below this
          point, which is what makes a report worth diffing. */}
      <section className="space-y-3">
        <h2 className="font-heading text-sm font-semibold">Steps</h2>

        <ol className="space-y-2">
          {body.steps.map((step) => (
            <li
              key={step.position}
              className="border-border bg-card rounded-lg border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground font-mono text-xs">
                  {step.position}
                </span>
                <StatusBadge status={step.status} className="text-xs" />
                <Badge variant="outline" className="text-xs">
                  {step.action}
                </Badge>
                {step.resolutionStrategy !== null ? (
                  <Badge variant="secondary" className="font-mono text-xs">
                    {step.resolutionStrategy}
                  </Badge>
                ) : null}
                {step.diagnosis !== null ? (
                  <Badge variant="outline" className="text-xs">
                    {step.diagnosis}
                  </Badge>
                ) : null}
              </div>

              <p className="mt-1 font-medium">{step.intent}</p>

              {step.resolvedSelector !== null ? (
                <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">
                  {step.resolvedSelector}
                </p>
              ) : null}

              {step.verifierRationale !== null ? (
                <p className="text-muted-foreground mt-1 text-xs">
                  {step.verifierRationale}
                </p>
              ) : null}

              {step.error !== null ? (
                <p className="text-destructive mt-1 text-xs">{step.error}</p>
              ) : null}

              {step.diagnosisRationale !== null ? (
                <p className="text-muted-foreground mt-1 text-xs">
                  {step.diagnosisRationale}
                </p>
              ) : null}

              {step.evidence.length > 0 ? (
                <div className="text-muted-foreground mt-2 flex flex-wrap gap-3 text-xs">
                  {step.evidence.map((path) => (
                    <a
                      key={path}
                      className="underline"
                      href={evidenceUrl(`${run.evidenceBase}/${path}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {path}
                    </a>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {body.healings.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-heading text-sm font-semibold">Repairs</h2>
          <ul className="space-y-2">
            {body.healings.map((healing, index) => (
              <li
                key={index}
                className="border-border bg-card rounded-lg border p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground font-mono text-xs">
                    step {healing.stepPosition}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {healing.status}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-1 font-mono text-xs">
                  {healing.from} → {healing.to}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {healing.rationale}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {body.bugs.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-heading text-sm font-semibold">Defects</h2>
          <ul className="space-y-2">
            {body.bugs.map((bug, index) => (
              <li
                key={index}
                className="border-border bg-card rounded-lg border p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {bug.severity}
                  </Badge>
                  <span className="font-medium">{bug.title}</span>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  {bug.summary}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Figure({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p
        className={
          muted === true ? "text-muted-foreground font-medium" : "font-medium"
        }
      >
        {value}
      </p>
    </div>
  );
}
