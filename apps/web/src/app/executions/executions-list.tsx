"use client";

import Link from "next/link";
import { executionSchema, paginated } from "@agentx/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/executions/status-badge";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui-bits";
import { apiFetch } from "@/lib/api";
import { useResource } from "@/lib/use-api";

export function ExecutionsList() {
  const resource = useResource(
    () => apiFetch("/executions", paginated(executionSchema)),
    "executions",
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Runs</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Every replay, with the evidence it produced.
        </p>
      </div>

      {resource.status === "loading" ? <Loading what="runs" /> : null}
      {resource.status === "error" ? (
        <ErrorBanner message={resource.error} />
      ) : null}

      {resource.status === "ok" && resource.data.items.length === 0 ? (
        <EmptyState
          title="No runs yet"
          hint="Open a test specification and run it against an environment."
        />
      ) : null}

      {resource.status === "ok" && resource.data.items.length > 0 ? (
        <div className="border-border rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resource.data.items.map((execution) => (
                <TableRow key={execution.id}>
                  <TableCell>
                    <Link
                      href={`/executions/${execution.id}`}
                      className="font-medium hover:underline"
                    >
                      {new Date(execution.startedAt).toLocaleString()}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={execution.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {execution.summary ?? execution.error ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
