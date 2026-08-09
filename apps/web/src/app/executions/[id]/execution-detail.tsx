"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  TERMINAL_EVENT_TYPES,
  executionDetailSchema,
  executionSchema,
  executionSseEventSchema,
  type Artifact,
  type ExecutionStepWithObservations,
} from "@agentx/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/executions/status-badge";
import { RunReportPanel } from "@/components/executions/run-report-panel";
import { CredentialChecklist } from "@/components/catalog/credential-checklist";
import { Term } from "@/components/vocab-badge";
import { Async } from "@/components/async";
import {
  CardListSkeleton,
  EmptyState,
  ErrorBanner,
} from "@/components/ui-bits";
import { apiFetch, evidenceUrl } from "@/lib/api";
import { useEventStream } from "@/lib/events";
import { describe, useResource } from "@/lib/use-api";
import { toast } from "@/lib/use-toast";
import { cn } from "@/lib/utils";

const RUNNING_STATUSES = ["PENDING", "RUNNING"];

/**
 * A run, live or finished.
 *
 * Live step events arrive over SSE and are merged over the stored ones by id;
 * a run opened after it finished renders identically from history alone.
 *
 * The report lives here as a tab rather than at its own route. It was a second
 * page over the same run, and the split had a cost beyond duplication: the
 * report was the only screen that named the specification, so the page people
 * actually watched could not say what it was running.
 */
export function ExecutionDetail({ executionId }: { executionId: string }) {
  const search = useSearchParams();
  const [view, setView] = useState<"timeline" | "report">(
    search.get("view") === "report" ? "report" : "timeline",
  );

  const resource = useResource(
    () => apiFetch(`/executions/${executionId}`, executionDetailSchema),
    executionId,
  );

  const isRunning =
    resource.status === "ok" &&
    RUNNING_STATUSES.includes(resource.data.status);

  const stream = useEventStream(
    isRunning ? `/executions/${executionId}/events` : null,
    executionSseEventSchema,
    {
      // Shared with the API rather than hand-written. Spelled out here as
      // `execution.finished` alone, this missed `execution.error` — so a run
      // that errored never closed its stream, never reloaded, and sat on an
      // empty timeline indefinitely.
      isTerminal: (event) => TERMINAL_EVENT_TYPES.includes(event.type),
    },
  );

  // When the run reaches a terminal event, pull the final state (evidence rows
  // and all) exactly once.
  //
  // In an effect, not in the render body. Settling raises a toast, and a toast
  // is a state update in `Toaster` — a *different* component — which React
  // rejects during render: "Cannot update a component (`Toaster`) while
  // rendering a different component (`ExecutionDetail`)". It warned on every
  // run that finished with this page open.
  const terminal = stream.events.find((event) =>
    TERMINAL_EVENT_TYPES.includes(event.type),
  );

  // A ref, not state: this guard renders nothing, and under StrictMode's
  // double-invoked effects a state flag would still read false on the second
  // pass and announce the same run twice.
  const settled = useRef(false);

  // `reload` is a fresh closure every render, so depending on it directly would
  // re-run this effect forever. Same reason `useEventStream` holds its callbacks
  // in refs — and assigned in an effect, because writing a ref during render is
  // the rule this block was breaking to begin with.
  const reload = useRef(resource.reload);

  useEffect(() => {
    reload.current = resource.reload;
  });

  useEffect(() => {
    if (terminal === undefined || settled.current) return;

    settled.current = true;
    reload.current();

    if (terminal.type === "execution.finished") {
      const passed = terminal.status === "PASSED";
      const message = `Run ${passed ? "passed" : terminal.status.toLowerCase()}`;
      if (passed) toast.success(message, terminal.summary ?? undefined);
      else toast.info(message, terminal.summary ?? undefined);
    } else {
      toast.error("The run could not complete");
    }
  }, [terminal]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/executions"
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        ← Runs
      </Link>

      <Async resource={resource} skeleton={<CardListSkeleton cards={4} />}>
        {(execution) => {
          const live = mergeLiveSteps(execution.steps, stream.events);
          const running = RUNNING_STATUSES.includes(execution.status);

          const trace = execution.artifacts.find((a) => a.kind === "TRACE");
          const video = execution.artifacts.find((a) => a.kind === "VIDEO");

          return (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="font-heading truncate text-2xl font-semibold">
                    {execution.specName}
                  </h1>
                  <p className="text-muted-foreground mt-1 text-sm">
                    version {execution.specVersion} ·{" "}
                    {execution.environmentName} ·{" "}
                    {new Date(execution.startedAt).toLocaleString()}
                    {execution.summary === null
                      ? ""
                      : ` · ${execution.summary}`}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <StatusBadge status={execution.status} />

                  {running ? (
                    <CancelButton
                      executionId={executionId}
                      onCancelled={resource.reload}
                    />
                  ) : null}
                </div>
              </div>

              {execution.error !== null ? (
                <div className="space-y-3">
                  <ErrorBanner message={execution.error} />
                  {/* A run that never opened a browser because a variable was
                      unset is the one error with a fix the dashboard can
                      actually show, so it shows it here rather than making
                      someone go looking for the environment. */}
                  {looksLikeMissingCredential(execution.error) ? (
                    <CredentialChecklist
                      environmentId={execution.environmentId}
                    />
                  ) : null}
                </div>
              ) : null}

              <Tabs
                view={view}
                onChange={setView}
                reportEnabled={!running}
                stepCount={live.length}
              />

              {view === "report" ? (
                <RunReportPanel executionId={executionId} />
              ) : (
                <>
                  {trace !== undefined || video !== undefined ? (
                    <div className="border-border bg-card flex flex-wrap items-center gap-4 rounded-lg border p-4 text-sm">
                      <span className="font-medium">Whole-run evidence</span>
                      {trace !== undefined ? (
                        <EvidenceLink
                          relPath={trace.relPath}
                          label="Playwright trace"
                          hint="Opens with npx playwright show-trace"
                        />
                      ) : null}
                      {video !== undefined ? (
                        <EvidenceLink
                          relPath={video.relPath}
                          label="Video"
                        />
                      ) : null}
                      <span className="text-muted-foreground text-xs">
                        {execution.totals.llmCallCount === 0
                          ? "no model calls"
                          : `${execution.totals.llmCallCount} model calls`}
                      </span>
                    </div>
                  ) : null}

                  {live.length === 0 ? (
                    <NoSteps status={execution.status} />
                  ) : (
                    <ol className="space-y-2">
                      {live.map((step) => (
                        <StepRow
                          key={step.index}
                          step={step}
                          artifacts={execution.artifacts}
                          executionId={executionId}
                          onAdjudicated={resource.reload}
                        />
                      ))}
                    </ol>
                  )}
                </>
              )}
            </>
          );
        }}
      </Async>
    </div>
  );
}

/**
 * The zero-step state, split by what the run is actually doing.
 *
 * One message for all three said "the run ended before any step executed" —
 * which, while the run was still sitting in the queue, was simply untrue.
 */
function NoSteps({ status }: { status: string }) {
  if (status === "PENDING") {
    return (
      <EmptyState
        title="Queued"
        hint="Waiting for the runner. Runs go one at a time, so this starts as soon as the one ahead of it finishes."
      />
    );
  }

  if (status === "RUNNING") {
    return (
      <EmptyState
        title="Starting the browser…"
        hint="Steps appear here as they run."
      />
    );
  }

  return (
    <EmptyState
      title="No steps ran"
      hint="The run ended before any step executed — the error above says why."
    />
  );
}

function Tabs({
  view,
  onChange,
  reportEnabled,
  stepCount,
}: {
  view: "timeline" | "report";
  onChange: (view: "timeline" | "report") => void;
  reportEnabled: boolean;
  stepCount: number;
}) {
  return (
    <div className="border-border flex gap-1 border-b">
      <TabButton
        active={view === "timeline"}
        onClick={() => onChange("timeline")}
      >
        Timeline{stepCount > 0 ? ` (${stepCount})` : ""}
      </TabButton>
      <TabButton
        active={view === "report"}
        // Requesting the report is what *writes* it, so asking for one
        // mid-run would cache a half-finished document.
        disabled={!reportEnabled}
        title={reportEnabled ? undefined : "Available once the run finishes"}
        onClick={() => onChange("report")}
      >
        Report
      </TabButton>
    </div>
  );
}

function TabButton({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
        active
          ? "border-primary text-foreground font-medium"
          : "text-muted-foreground hover:text-foreground border-transparent",
        disabled === true && "cursor-not-allowed opacity-40 hover:text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function CancelButton({
  executionId,
  onCancelled,
}: {
  executionId: string;
  onCancelled: () => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        apiFetch(`/executions/${executionId}/cancel`, executionSchema, {
          method: "POST",
        })
          .then(() => {
            toast.info("Cancelling — the run stops after the current step");
            onCancelled();
          })
          .catch((error: unknown) => toast.error(describe(error)))
          .finally(() => setBusy(false));
      }}
    >
      Cancel
    </Button>
  );
}

function EvidenceLink({
  relPath,
  label,
  hint,
}: {
  relPath: string;
  label: string;
  hint?: string;
}) {
  return (
    <a
      className="underline"
      href={evidenceUrl(relPath)}
      target="_blank"
      rel="noopener noreferrer"
      title={hint}
    >
      {label}
    </a>
  );
}

/** Live steps override stored ones of the same index, so a RUNNING step updates in place. */
function mergeLiveSteps(
  stored: ExecutionStepWithObservations[],
  events: { type: string }[],
): ExecutionStepWithObservations[] {
  const liveByIndex = new Map(
    events
      .filter(
        (event): event is { type: "execution.step"; step: ExecutionStepWithObservations } =>
          event.type === "execution.step",
      )
      .map((event) => [event.step.index, event.step]),
  );

  const steps = stored.map((step) => {
    const live = liveByIndex.get(step.index);
    return live === undefined ? step : { ...step, ...live };
  });

  for (const [index, live] of liveByIndex) {
    if (!steps.some((step) => step.index === index)) {
      steps.push({ ...live, observations: [] });
    }
  }

  return steps.sort((a, b) => a.index - b.index);
}

/** Matches `MissingCredentialError`'s wording, which names the variables. */
function looksLikeMissingCredential(error: string): boolean {
  return /Environment variable(s)? .* (is|are) not set/.test(error);
}

function StepRow({
  step,
  artifacts,
  executionId,
  onAdjudicated,
}: {
  step: ExecutionStepWithObservations;
  artifacts: Artifact[];
  executionId: string;
  onAdjudicated: () => void;
}) {
  const [pending, setPending] = useState(false);
  const mine = artifacts.filter(
    (artifact) => artifact.executionStepId === step.id,
  );
  const shot = mine.find((artifact) => artifact.kind === "SCREENSHOT");

  const network = step.observations.find((o) => o.kind === "NETWORK");
  const failedRequests =
    network?.payload.kind === "NETWORK"
      ? network.payload.entries.filter((entry) => (entry.status ?? 0) >= 400)
      : [];

  const consoleObs = step.observations.find((o) => o.kind === "CONSOLE");
  const consoleErrors =
    consoleObs?.payload.kind === "CONSOLE"
      ? consoleObs.payload.entries.filter((entry) => entry.type === "error")
      : [];

  function adjudicate(status: "PASS" | "FAIL") {
    setPending(true);
    apiFetch(`/executions/${executionId}/steps/${step.id}`, z.unknown(), {
      method: "PATCH",
      body: { status },
    })
      .then(() => {
        toast.success(
          status === "PASS" ? "Marked as passed" : "Marked as failed",
          "The agent learns from your call.",
        );
        onAdjudicated();
      })
      // Without this a rejected adjudication did nothing visible at all: the
      // button re-enabled and the step stayed exactly as it was.
      .catch((error: unknown) => toast.error(describe(error)))
      .finally(() => setPending(false));
  }

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
          <StatusBadge
            status={step.status}
            kind="stepStatus"
            className="text-xs"
          />
          <Badge variant="outline" className="text-xs">
            {step.action}
          </Badge>
          {step.resolutionStrategy !== null ? (
            <span className="inline-flex items-center gap-1">
              <Term
                kind="resolutionStrategy"
                value={step.resolutionStrategy}
                variant="secondary"
                className="text-xs"
              />
              {step.candidateCount !== null && step.candidateCount > 1 ? (
                <span className="text-muted-foreground text-xs">
                  {step.candidateCount} matches
                </span>
              ) : null}
            </span>
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

        {/* The rationale sits next to the evidence it cites, not on another
            screen — a verdict you have to go hunting to understand is one
            people stop reading. */}
        {step.verifierRationale !== null ? (
          <p className="text-muted-foreground mt-1 text-xs">
            {step.verifierRationale}
          </p>
        ) : null}

        {/* Why it failed, next to the evidence it was concluded from. A
            classification nobody can audit is one people learn to ignore. */}
        {step.diagnosis !== null ? (
          <p className="mt-1 text-xs">
            <Term
              kind="diagnosis"
              value={step.diagnosis}
              className="mr-2 text-xs"
            />
            <span className="text-muted-foreground">
              {step.diagnosisRationale}
            </span>
          </p>
        ) : null}

        {failedRequests.length > 0 ? (
          <ul className="text-destructive mt-1 space-y-0.5 font-mono text-xs">
            {failedRequests.slice(0, 3).map((entry, index) => (
              <li key={index} className="truncate">
                {entry.status} {entry.method} {entry.url}
              </li>
            ))}
          </ul>
        ) : null}

        {consoleErrors.length > 0 ? (
          <ul className="text-destructive mt-1 space-y-0.5 font-mono text-xs">
            {consoleErrors.slice(0, 3).map((entry, index) => (
              <li key={index} className="truncate">
                console: {entry.text}
              </li>
            ))}
          </ul>
        ) : null}

        {step.status === "UNCERTAIN" ? (
          <div className="border-border mt-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2">
            <span className="text-muted-foreground text-xs">
              The verifier could not settle this either way. Your call:
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => adjudicate("PASS")}
            >
              It passed
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => adjudicate("FAIL")}
            >
              It failed
            </Button>
          </div>
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
                  {ARTIFACT_LABEL[artifact.kind] ?? artifact.kind.toLowerCase()}
                </a>
              ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** `a11y` is not a word most people know. */
const ARTIFACT_LABEL: Record<string, string> = {
  DOM: "page structure",
  A11Y: "accessibility tree",
  NETWORK: "network",
  CONSOLE: "console",
  TRACE: "trace",
  VIDEO: "video",
};
