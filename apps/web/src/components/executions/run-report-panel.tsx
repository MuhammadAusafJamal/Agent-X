"use client";

import { reportSchema } from "@agentx/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/executions/status-badge";
import { Term } from "@/components/vocab-badge";
import { Async } from "@/components/async";
import { CardListSkeleton } from "@/components/ui-bits";
import { API_BASE_URL, apiFetch, evidenceUrl } from "@/lib/api";
import { useResource } from "@/lib/use-api";
import { toast } from "@/lib/use-toast";

/**
 * A run, written down.
 *
 * Renders the structured document rather than the Markdown, so evidence stays
 * clickable — but the Markdown is what the download serves, and both come from
 * the same source.
 *
 * A panel rather than a page. It used to be `/executions/[id]/report`, a second
 * full layout over the same run, which meant the only screen that told you
 * *which specification had run* was one you had to navigate away to find.
 */
export function RunReportPanel({ executionId }: { executionId: string }) {
  const resource = useResource(
    () => apiFetch(`/executions/${executionId}/report`, reportSchema),
    `${executionId}-report`,
  );

  return (
    <Async resource={resource} skeleton={<CardListSkeleton cards={3} />}>
      {({ markdown, json }) => {
        const { run, body } = json;

        return (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(markdown)
                    .then(() => toast.success("Report copied as Markdown"))
                    .catch(() => toast.error("Could not copy to the clipboard"));
                }}
              >
                Copy Markdown
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a
                  href={`${API_BASE_URL}/executions/${executionId}/report/markdown`}
                >
                  Download
                </a>
              </Button>
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
                label="Tokens in / out"
                value={
                  run.llmCallCount === 0
                    ? "—"
                    : `${run.inputTokens} / ${run.outputTokens}`
                }
              />
              <Figure
                label="Needs you"
                value={String(body.counts.uncertain)}
                muted={body.counts.uncertain === 0}
              />
            </div>

            {/* Two runs of an unchanged application produce the same bytes below
                this point, which is what makes a report worth diffing. */}
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
                      <StatusBadge
                        status={step.status}
                        kind="stepStatus"
                        className="text-xs"
                      />
                      <Badge variant="outline" className="text-xs">
                        {step.action}
                      </Badge>
                      <Term
                        kind="resolutionStrategy"
                        value={step.resolutionStrategy}
                        variant="secondary"
                        className="text-xs"
                      />
                      <Term
                        kind="diagnosis"
                        value={step.diagnosis}
                        className="text-xs"
                      />
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
                      <p className="text-destructive mt-1 text-xs">
                        {step.error}
                      </p>
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
                            {evidenceLabel(path)}
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
                        <Term
                          kind="healingStatus"
                          value={healing.status}
                          className="text-xs"
                        />
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
                        <Term
                          kind="severity"
                          value={bug.severity}
                          className="text-xs"
                        />
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
      }}
    </Async>
  );
}

/** `step-3/shot.jpg` reads as "screenshot", not as a path. */
function evidenceLabel(relPath: string): string {
  const file = relPath.split("/").pop() ?? relPath;

  if (file.startsWith("shot")) return "screenshot";
  if (file.startsWith("healed-shot")) return "screenshot after the repair";
  if (file.startsWith("dom")) return "page structure";
  if (file.startsWith("aria")) return "accessibility tree";
  if (file.startsWith("network")) return "network";
  if (file.startsWith("console")) return "console";

  return file;
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
