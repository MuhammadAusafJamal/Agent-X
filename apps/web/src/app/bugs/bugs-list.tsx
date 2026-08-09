"use client";

import Link from "next/link";
import { useState } from "react";
import {
  bugReportWithContextSchema,
  paginated,
  type BugReportWithContext,
  type Severity,
} from "@agentx/shared";
import { Button } from "@/components/ui/button";
import { Term } from "@/components/vocab-badge";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui-bits";
import { apiFetch, evidenceUrl } from "@/lib/api";
import { describe, useResource } from "@/lib/use-api";
import { toast } from "@/lib/use-toast";

const SEVERITY_STYLE: Record<Severity, string> = {
  CRITICAL: "bg-destructive/15 text-destructive border-destructive/40",
  HIGH: "bg-destructive/10 text-destructive border-destructive/30",
  MEDIUM: "",
  LOW: "",
};

/**
 * Defects the diagnoser attributed to the application under test.
 *
 * These are the failures the agent refused to heal. Everything here reproduces
 * from steps that actually ran, so a developer can act on one without opening
 * the run that found it.
 */
export function BugsList() {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const bugs = useResource(
    () => apiFetch("/bugs", paginated(bugReportWithContextSchema)),
    "bugs",
  );

  function setStatus(id: string, status: "ACKNOWLEDGED" | "DISMISSED") {
    setPending(id);
    setFailure(null);

    apiFetch(`/bugs/${id}`, bugReportWithContextSchema, {
      method: "PATCH",
      body: { status },
    })
      .then(bugs.reload)
      .catch((error: unknown) => setFailure(describe(error)))
      .finally(() => setPending(null));
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Bugs</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Failures the agent attributed to the application rather than to the
          test — so it filed a report instead of healing over them.
        </p>
      </div>

      {failure ? <ErrorBanner message={failure} /> : null}
      {bugs.status === "loading" ? <Loading what="bugs" /> : null}
      {bugs.status === "error" ? <ErrorBanner message={bugs.error} /> : null}

      {bugs.status === "ok" && bugs.data.items.length === 0 ? (
        <EmptyState
          title="No defects found"
          hint="When a run fails and the diagnoser concludes the application is at fault, the report it writes shows up here."
        />
      ) : null}

      {bugs.status === "ok" && bugs.data.items.length > 0 ? (
        <ul className="space-y-3">
          {bugs.data.items.map((bug) => (
            <BugCard
              key={bug.id}
              bug={bug}
              busy={pending === bug.id}
              onStatus={(status) => setStatus(bug.id, status)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function BugCard({
  bug,
  busy,
  onStatus,
}: {
  bug: BugReportWithContext;
  busy: boolean;
  onStatus: (status: "ACKNOWLEDGED" | "DISMISSED") => void;
}) {
  function copy() {
    void navigator.clipboard
      .writeText(asMarkdown(bug))
      .then(() => toast.success("Copied as Markdown"))
      .catch(() => toast.error("Could not copy to the clipboard"));
  }

  return (
    <li className="border-border bg-card space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Term
          kind="severity"
          value={bug.severity}
          className={`text-xs ${SEVERITY_STYLE[bug.severity]}`}
        />
        <Term
          kind="bugStatus"
          value={bug.status}
          variant={bug.status === "OPEN" ? "secondary" : "outline"}
          className="text-xs"
        />
        {bug.occurrences > 1 ? (
          <span
            className="text-muted-foreground text-xs"
            title="The same defect, seen across this many runs"
          >
            seen {bug.occurrences} times
          </span>
        ) : null}
        <span className="text-muted-foreground text-xs">
          {bug.applicationName} · {bug.specName}
        </span>
      </div>

      <h2 className="text-sm font-semibold">{bug.title}</h2>
      <p className="text-muted-foreground text-sm">{bug.summary}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="border-border bg-muted/40 rounded-md border p-3">
          <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
            Expected
          </p>
          <p className="text-xs">{bug.expected}</p>
        </div>
        <div className="border-border bg-muted/40 rounded-md border p-3">
          <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
            Actual
          </p>
          <p className="text-xs">{bug.actual}</p>
        </div>
      </div>

      {/* Taken from the steps that actually ran, not from the model's
          recollection — a reproduction that does not reproduce is worse than
          none at all. */}
      <div>
        <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
          Steps to reproduce
        </p>
        <ol className="space-y-0.5 text-xs">
          {bug.reproSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>

      {bug.evidencePaths.length > 0 ? (
        <div className="text-muted-foreground flex flex-wrap gap-3 text-xs">
          {bug.evidencePaths.map((path) => (
            <a
              key={path}
              className="underline"
              href={evidenceUrl(path)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {path.split("/").pop()}
            </a>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={copy}>
          Copy as Markdown
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link href={`/executions/${bug.executionId}`}>The run</Link>
        </Button>
        {bug.status === "OPEN" ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onStatus("ACKNOWLEDGED")}
            >
              Acknowledge
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onStatus("DISMISSED")}
            >
              Dismiss
            </Button>
          </>
        ) : null}
      </div>
    </li>
  );
}

/** The report, ready to paste into an issue tracker. */
function asMarkdown(bug: BugReportWithContext): string {
  return [
    `# ${bug.title}`,
    "",
    `**Severity:** ${bug.severity}  `,
    `**Application:** ${bug.applicationName}  `,
    `**Found by:** ${bug.specName}`,
    "",
    bug.summary,
    "",
    "## Steps to reproduce",
    "",
    ...bug.reproSteps,
    "",
    "## Expected",
    "",
    bug.expected,
    "",
    "## Actual",
    "",
    bug.actual,
    "",
  ].join("\n");
}
