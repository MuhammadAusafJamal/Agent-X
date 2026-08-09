"use client";

import Link from "next/link";
import {
  executionListItemSchema,
  paginated,
  testSpecSchema,
} from "@agentx/shared";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/executions/status-badge";
import { QuickStartDialog } from "@/components/catalog/quick-start-dialog";
import { RunSpecDialog } from "@/components/executions/run-spec-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { useResource } from "@/lib/use-api";

const IN_FLIGHT = ["PENDING", "RUNNING"];

/**
 * The first screen, doing an actual job.
 *
 * `/` used to be a static blurb with no links at all — and, because nothing in
 * the sidebar pointed at it, a screen you could not get back to once you had
 * clicked anything. It was also the only place the API's health was shown.
 *
 * Now it answers the two questions someone actually has when they open this:
 * what do I do first, and what happened last. On a seeded database it also puts
 * the demo one click away, which is the number that matters on a stage.
 */
export function StartHere() {
  const specs = useResource(
    () => apiFetch("/specs", paginated(testSpecSchema)),
    "home-specs",
  );

  const runs = useResource(
    () => apiFetch("/executions", paginated(executionListItemSchema)),
    "home-runs",
    {
      pollMs: 3000,
      shouldPoll: (page) =>
        page.items.some((run) => IN_FLIGHT.includes(run.status)),
    },
  );

  if (specs.status === "loading") {
    return <Skeleton className="h-40 w-full" />;
  }

  const ready = specs.status === "ok" ? specs.data.items : [];
  const recent = runs.status === "ok" ? runs.data.items.slice(0, 5) : [];

  return (
    <div className="space-y-6">
      {ready.length === 0 ? (
        <FirstRun />
      ) : (
        <section className="border-border bg-card rounded-lg border p-5">
          <h2 className="font-heading text-sm font-semibold">
            Ready to run
          </h2>
          <ul className="mt-4 space-y-3">
            {ready.slice(0, 5).map((spec) => (
              <li
                key={spec.id}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <Link
                  href={`/specs/${spec.id}`}
                  className="text-sm font-medium hover:underline"
                >
                  {spec.name}
                </Link>
                <RunSpecDialog
                  specId={spec.id}
                  applicationId={spec.applicationId}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {recent.length > 0 ? (
        <section className="border-border bg-card rounded-lg border p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-sm font-semibold">Recent runs</h2>
            <Link
              href="/executions"
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              All runs →
            </Link>
          </div>

          <ul className="mt-4 space-y-2">
            {recent.map((run) => (
              <li
                key={run.id}
                className="flex flex-wrap items-center justify-between gap-3 text-sm"
              >
                <Link
                  href={`/executions/${run.id}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {run.specName}
                </Link>
                <span className="text-muted-foreground text-xs">
                  {new Date(run.startedAt).toLocaleString()}
                </span>
                <StatusBadge status={run.status} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** What to do when the database is empty — the only thing worth saying then. */
function FirstRun() {
  return (
    <section className="border-border bg-card rounded-lg border p-5">
      <h2 className="font-heading text-sm font-semibold">Start here</h2>

      <ol className="mt-4 space-y-3 text-sm">
        <Step n={1} title="Add the application you want to test">
          A browser opens on this machine and records one session.
        </Step>
        <Step n={2} title="Click through the flow, then stop">
          Every action is captured with the context needed to replay it.
        </Step>
        <Step n={3} title="Run it">
          The agent finds each target by intent, so the test survives the page
          changing underneath it.
        </Step>
      </ol>

      <div className="mt-5 flex flex-wrap gap-2">
        <QuickStartDialog trigger={<Button>Add an application</Button>} />
        <Button variant="outline" asChild>
          <Link href="/projects">Browse the catalog</Link>
        </Button>
      </div>
    </section>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-xs">
        {n}
      </span>
      <span>
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground block text-xs">{children}</span>
      </span>
    </li>
  );
}
