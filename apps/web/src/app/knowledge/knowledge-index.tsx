"use client";

import Link from "next/link";
import { applicationSchema, paginated } from "@agentx/shared";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui-bits";
import { apiFetch } from "@/lib/api";
import { useResource } from "@/lib/use-api";

export function KnowledgeIndex() {
  const resource = useResource(
    () => apiFetch("/applications", paginated(applicationSchema)),
    "applications",
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Knowledge</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          What the agent has learned about each application. Scoped per
          application — nothing learned about one is ever used on another.
        </p>
      </div>

      {resource.status === "loading" ? <Loading what="applications" /> : null}
      {resource.status === "error" ? (
        <ErrorBanner message={resource.error} />
      ) : null}

      {resource.status === "ok" && resource.data.items.length === 0 ? (
        <EmptyState
          title="Nothing learned yet"
          hint="The agent records what worked each time it resolves a step, so knowledge appears once a specification has run."
        />
      ) : null}

      {resource.status === "ok" && resource.data.items.length > 0 ? (
        <ul className="border-border divide-border divide-y rounded-lg border">
          {resource.data.items.map((application) => (
            <li key={application.id}>
              <Link
                href={`/knowledge/${application.id}`}
                className="hover:bg-accent/40 flex items-center justify-between px-4 py-3 text-sm"
              >
                <span className="font-medium">{application.name}</span>
                <span className="text-muted-foreground font-mono text-xs">
                  {application.baseUrl}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
