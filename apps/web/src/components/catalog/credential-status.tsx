"use client";

import { environmentCredentialStatusSchema } from "@agentx/shared";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { useResource } from "@/lib/use-api";

/**
 * Shows whether each referenced environment variable is currently set.
 *
 * Names and states only — the API never sends the values, and this component
 * could not render them if it wanted to.
 */
export function CredentialStatus({ environmentId }: { environmentId: string }) {
  const resource = useResource(
    () =>
      apiFetch(
        `/environments/${environmentId}/credentials`,
        environmentCredentialStatusSchema,
      ),
    environmentId,
  );

  if (resource.status !== "ok") {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  if (resource.data.entries.length === 0) {
    return <span className="text-muted-foreground text-xs">none</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {resource.data.entries.map((entry) => (
        <Badge
          key={entry.envVar}
          variant={entry.resolved ? "secondary" : "outline"}
          className="font-mono text-xs"
          title={
            entry.resolved
              ? `${entry.envVar} is set in the API's environment`
              : `${entry.envVar} is not set — a run using this environment will fail before the browser opens`
          }
        >
          {entry.resolved ? "✓" : "✗"} {entry.envVar}
        </Badge>
      ))}
    </div>
  );
}
