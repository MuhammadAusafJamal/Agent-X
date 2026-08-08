"use client";

import Link from "next/link";
import { useState } from "react";
import {
  executionDetailSchema,
  executionSchema,
  executionSseEventSchema,
  type Artifact,
  type ExecutionStepWithObservations,
} from "@agentx/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/executions/status-badge";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui-bits";
import { apiFetch, evidenceUrl } from "@/lib/api";
import { useEventStream } from "@/lib/events";
import { describe, useResource } from "@/lib/use-api";

/**
 * A run, live or finished.
 *
 * Live step events arrive over SSE and are merged over the stored ones by id;
 * a run opened after it finished renders identically from history alone.
 */
export function ExecutionDetail({ executionId }: { executionId: string }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const resource = useResource(
    () => apiFetch(`/executions/${executionId}`, executionDetailSchema),
    executionId,
  );

  const isRunning =
    resource.status === "ok" &&
    ["PENDING", "RUNNING"].includes(resource.data.status);

  const stream = useEventStream(
    isRunning ? `/executions/${executionId}/events` : null,
    executionSseEventSchema,
    { isTerminal: (event) => event.type === "execution.finished" },
  );

  // When the run finishes, pull the final state (evidence rows and all).
  const finished = stream.events.some(
    (event) => event.type === "execution.finished",
  );
  const [reloadedAt, setReloadedAt] = useState<string | null>(null);
  if (finished && reloadedAt === null) {
    setReloadedAt(new Date().toISOString());
    resource.reload();
  }

  if (resource.status === "loading") return <Loading what="run" />;

  if (resource.status === "error") {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <ErrorBanner message={resource.error} />
        <Link href="/executions" className="text-sm underline">
          Back to runs
        </Link>
      </div>
    );
  }

  const execution = resource.data;

  // Live steps override stored ones of the same index, so a step that is
  // RUNNING updates in place instead of appearing twice.
  const liveByIndex = new Map(
    stream.events
      .filter((event) => event.type === "execution.step")
      .map((event) => [event.step.index, event.step]),
  );

  const steps: ExecutionStepWithObservations[] = execution.steps.map((step) => {
    const live = liveByIndex.get(step.index);
    return live === undefined ? step : { ...step, ...live };
  });

  for (const [index, live] of liveByIndex) {
    if (!steps.some((step) => step.index === index)) {
      steps.push({ ...live, observations: [] });
    }
  }
  steps.sort((a, b) => a.index - b.index);

  const trace = execution.artifacts.find(
    (artifact) => artifact.kind === "TRACE",
  );
  const video = execution.artifacts.find(
    (artifact) => artifact.kind === "VIDEO",
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/executions"
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        ← Runs
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Run</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {new Date(execution.startedAt).toLocaleString()}
            {execution.summary === null ? "" : ` · ${execution.summary}`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <StatusBadge status={execution.status} />

          {isRunning ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                apiFetch(`/executions/${executionId}/cancel`, executionSchema, {
                  method: "POST",
                })
                  .then(() => resource.reload())
                  .catch((error: unknown) => setFailure(describe(error)))
                  .finally(() => setBusy(false));
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      {failure ? <ErrorBanner message={failure} /> : null}
      {execution.error !== null ? (
        <ErrorBanner message={execution.error} />
      ) : null}

      {trace !== undefined || video !== undefined ? (
        <div className="border-border bg-card flex flex-wrap items-center gap-4 rounded-lg border p-4 text-sm">
          <span className="font-medium">Whole-run evidence</span>
          {trace !== undefined ? (
            <a
              className="underline"
              href={evidenceUrl(trace.relPath)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Playwright trace
            </a>
          ) : null}
          {video !== undefined ? (
            <a
              className="underline"
              href={evidenceUrl(video.relPath)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Video
            </a>
          ) : null}
          <span className="text-muted-foreground text-xs">
            {execution.totals.llmCallCount === 0
              ? "no model calls"
              : `${execution.totals.llmCallCount} model calls`}
          </span>
        </div>
      ) : null}

      {steps.length === 0 ? (
        <EmptyState
          title="No steps ran"
          hint="The run ended before any step executed — check the error above."
        />
      ) : (
        <ol className="space-y-2">
          {steps.map((step) => (
            <StepRow
              key={step.index}
              step={step}
              artifacts={execution.artifacts}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function StepRow({
  step,
  artifacts,
}: {
  step: ExecutionStepWithObservations;
  artifacts: Artifact[];
}) {
  const mine = artifacts.filter(
    (artifact) => artifact.executionStepId === step.id,
  );
  const shot = mine.find((artifact) => artifact.kind === "SCREENSHOT");

  return (
    <li className="border-border bg-card flex gap-4 rounded-lg border p-3">
      {shot === undefined ? (
        <div className="bg-muted size-16 shrink-0 rounded" />
      ) : (
        <a
          href={evidenceUrl(shot.relPath)}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={evidenceUrl(shot.relPath)}
            alt={`Screen after step ${step.index + 1}`}
            className="border-border size-16 rounded border object-cover object-top"
          />
        </a>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground font-mono text-xs">
            {step.index + 1}
          </span>
          <StatusBadge status={step.status} className="text-xs" />
          <Badge variant="outline" className="text-xs">
            {step.action}
          </Badge>
          {step.resolutionStrategy !== null ? (
            <Badge variant="secondary" className="font-mono text-xs">
              {step.resolutionStrategy}
              {step.candidateCount !== null && step.candidateCount > 1
                ? ` · ${step.candidateCount} matches`
                : ""}
            </Badge>
          ) : null}
          {step.durationMs !== null ? (
            <span className="text-muted-foreground text-xs">
              {step.durationMs} ms
            </span>
          ) : null}
        </div>

        <p className="mt-1 text-sm font-medium">{step.intent}</p>

        {step.error !== null ? (
          <p className="text-destructive mt-1 text-xs">{step.error}</p>
        ) : null}

        {mine.length > 0 ? (
          <div className="text-muted-foreground mt-2 flex flex-wrap gap-3 text-xs">
            {mine
              .filter((artifact) => artifact.kind !== "SCREENSHOT")
              .map((artifact) => (
                <a
                  key={artifact.id}
                  className="underline"
                  href={evidenceUrl(artifact.relPath)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {artifact.kind.toLowerCase()}
                </a>
              ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}
