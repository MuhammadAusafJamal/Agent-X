"use client";

import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import {
  healingRecordWithContextSchema,
  paginated,
  type HealingRecordWithContext,
  type TargetHints,
} from "@agentx/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui-bits";
import { apiFetch, evidenceUrl } from "@/lib/api";
import { describe, useResource } from "@/lib/use-api";

const reviewResultSchema = z.object({
  appliedToVersionId: z.string().nullable(),
  reviewed: z.number(),
});

/**
 * Repairs the agent proposed, waiting on a person.
 *
 * Approving writes a **new version** of the specification; the version that
 * drifted is left exactly as it was. That is what makes an automated change to a
 * test something you can audit and undo, rather than something you discover
 * later in a diff nobody reviewed.
 */
export function HealingQueue() {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const healings = useResource(
    () =>
      apiFetch("/healings", paginated(healingRecordWithContextSchema)),
    "healings",
  );

  function review(
    healingIds: string[],
    decision: "APPROVE" | "REJECT",
    key: string,
  ) {
    setPending(key);
    setFailure(null);

    apiFetch("/healings/review", reviewResultSchema, {
      method: "POST",
      body: { healingIds, decision },
    })
      .then(healings.reload)
      .catch((error: unknown) => setFailure(describe(error)))
      .finally(() => setPending(null));
  }

  // Heals from one run are approved together, into a single new version.
  const byExecution = new Map<string, HealingRecordWithContext[]>();

  if (healings.status === "ok") {
    for (const item of healings.data.items) {
      byExecution.set(item.executionId, [
        ...(byExecution.get(item.executionId) ?? []),
        item,
      ]);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Healing queue</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Repairs the agent proposed after a step drifted. Approving writes a new
          version of the specification — the one that drifted is never edited.
        </p>
      </div>

      {failure ? <ErrorBanner message={failure} /> : null}
      {healings.status === "loading" ? <Loading what="proposed repairs" /> : null}
      {healings.status === "error" ? (
        <ErrorBanner message={healings.error} />
      ) : null}

      {healings.status === "ok" && healings.data.items.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          hint="When a run finds that a step's targeting no longer matches the application, the repair it proposes shows up here for you to approve."
        />
      ) : null}

      {[...byExecution.entries()].map(([executionId, items]) => (
        <section key={executionId} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-heading text-sm font-semibold">
                {items[0]?.specName}{" "}
                <span className="text-muted-foreground font-normal">
                  version {items[0]?.specVersion}
                </span>
              </h2>
              <Link
                href={`/executions/${executionId}`}
                className="text-muted-foreground hover:text-foreground text-xs underline"
              >
                the run that found it
              </Link>
            </div>

            {items.length > 1 ? (
              <Button
                size="sm"
                disabled={pending !== null}
                onClick={() =>
                  review(
                    items.map((item) => item.id),
                    "APPROVE",
                    executionId,
                  )
                }
              >
                Approve all {items.length}
              </Button>
            ) : null}
          </div>

          <ul className="space-y-3">
            {items.map((item) => (
              <HealingCard
                key={item.id}
                healing={item}
                busy={pending !== null}
                onReview={(decision) => review([item.id], decision, item.id)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function HealingCard({
  healing,
  busy,
  onReview,
}: {
  healing: HealingRecordWithContext;
  busy: boolean;
  onReview: (decision: "APPROVE" | "REJECT") => void;
}) {
  return (
    <li className="border-border bg-card space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground font-mono text-xs">
          step {healing.stepIndex + 1}
        </span>
        <Badge variant="outline" className="text-xs">
          {healing.diagnosis}
        </Badge>
        <Badge
          variant={healing.status === "APPLIED" ? "secondary" : "outline"}
          className="text-xs"
          title={
            healing.status === "APPLIED"
              ? "The repair was applied during the run and the step then passed"
              : "Proposed, but not proven during the run"
          }
        >
          {healing.status === "APPLIED" ? "proven in the run" : "proposed"}
        </Badge>
      </div>

      <p className="text-sm font-medium">{healing.stepIntent}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <TargetPanel
          title="Was looking for"
          hints={healing.originalTarget}
          tone="muted"
        />
        <TargetPanel
          title="Proposed"
          hints={healing.proposedTarget}
          tone="accent"
        />
      </div>

      {healing.proposedDescription !== null ? (
        <p className="text-muted-foreground text-xs">
          Description becomes “{healing.proposedDescription}”
        </p>
      ) : null}

      <p className="text-muted-foreground text-xs">{healing.rationale}</p>

      {/* Before and after, side by side: the reviewer's real question is what
          changed on the page, and prose is a poor way to answer it. */}
      {healing.beforeShotPath !== null || healing.afterShotPath !== null ? (
        <div className="flex flex-wrap gap-4">
          <Shot label="At failure" path={healing.beforeShotPath} />
          <Shot label="After the repair" path={healing.afterShotPath} />
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => onReview("APPROVE")}>
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onReview("REJECT")}
          title="Leaves the specification untouched — the next run fails the same way"
        >
          Reject
        </Button>
      </div>
    </li>
  );
}

function TargetPanel({
  title,
  hints,
  tone,
}: {
  title: string;
  hints: TargetHints;
  tone: "muted" | "accent";
}) {
  const lines = [
    hints.role === undefined ? null : `role: ${hints.role}`,
    hints.name === undefined ? null : `name: “${hints.name}”`,
    hints.testId === undefined ? null : `test id: ${hints.testId}`,
    hints.text === undefined ? null : `text: “${hints.text}”`,
    hints.landmark === undefined ? null : `inside: ${hints.landmark}`,
  ].filter((line) => line !== null);

  return (
    <div
      className={
        tone === "accent"
          ? "border-border bg-background rounded-md border p-3"
          : "border-border bg-muted/40 rounded-md border p-3"
      }
    >
      <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
        {title}
      </p>
      {lines.length === 0 ? (
        <p className="text-muted-foreground font-mono text-xs">
          (nothing recorded)
        </p>
      ) : (
        <ul className="space-y-0.5 font-mono text-xs">
          {lines.map((line) => (
            <li key={line} className="truncate">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Shot({ label, path }: { label: string; path: string | null }) {
  if (path === null) return null;

  return (
    <figure className="space-y-1">
      <a href={evidenceUrl(path)} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={evidenceUrl(path)}
          alt={label}
          className="border-border h-28 rounded border object-cover object-top"
        />
      </a>
      <figcaption className="text-muted-foreground text-xs">{label}</figcaption>
    </figure>
  );
}
