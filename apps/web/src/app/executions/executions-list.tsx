"use client";

import Link from "next/link";
import { executionListItemSchema, paginated } from "@agentx/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/executions/status-badge";
import { Async } from "@/components/async";
import { TableSkeleton } from "@/components/ui-bits";
import { apiFetch } from "@/lib/api";
import { useResource } from "@/lib/use-api";

const IN_FLIGHT = ["PENDING", "RUNNING"];

export function ExecutionsList() {
  const resource = useResource(
    () => apiFetch("/executions", paginated(executionListItemSchema)),
    "executions",
    {
      // A run's own page has an event stream; this list has none, so a queued
      // run sat at "Queued" until somebody reloaded. Polling stops the moment
      // nothing is in flight, so an idle dashboard is silent.
      pollMs: 3000,
      shouldPoll: (page) =>
        page.items.some((execution) => IN_FLIGHT.includes(execution.status)),
    },
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Runs</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Every replay, with the evidence it produced.
        </p>
      </div>

      <Async
        resource={resource}
        skeleton={<TableSkeleton rows={4} />}
        isEmpty={(page) => page.items.length === 0}
        empty={{
          title: "No runs yet",
          hint: "Open a test specification and run it against an environment.",
        }}
      >
        {(page) => (
          <div className="border-border rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Specification</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((execution) => (
                  <TableRow key={execution.id}>
                    <TableCell>
                      <Link
                        href={`/executions/${execution.id}`}
                        className="font-medium hover:underline"
                      >
                        {execution.specName}
                      </Link>
                      <p className="text-muted-foreground text-xs">
                        version {execution.specVersion} ·{" "}
                        {execution.environmentName}
                      </p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={execution.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(execution.startedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {execution.summary ?? execution.error ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Async>
    </div>
  );
}
