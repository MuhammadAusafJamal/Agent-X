"use client";

import { environmentCredentialStatusSchema } from "@agentx/shared";
import { Button } from "@/components/ui/button";
import { Async } from "@/components/async";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { useResource } from "@/lib/use-api";
import { toast } from "@/lib/use-toast";

/**
 * The one step in the whole product with no UI, given one.
 *
 * Setting a credential means editing `apps/api/.env` and restarting the API.
 * The dashboard cannot do that for you — deliberately: the values live in the
 * API's process environment precisely so they never reach SQLite, the evidence
 * tree, a report, or a prompt, and a form that wrote them anywhere would undo
 * that. What it *can* do is stop leaving people to guess.
 *
 * So this shows which variables are missing, hands over a block to paste with
 * the values left blank, and re-checks on demand — the status endpoint re-reads
 * `process.env` on every call, so a restart shows up immediately.
 */
export function CredentialChecklist({
  environmentId,
}: {
  environmentId: string;
}) {
  const resource = useResource(
    () =>
      apiFetch(
        `/environments/${environmentId}/credentials`,
        environmentCredentialStatusSchema,
      ),
    `${environmentId}-credentials`,
  );

  return (
    <Async resource={resource} skeleton={<Skeleton className="h-24 w-full" />}>
      {(status) => {
        if (status.entries.length === 0) {
          return (
            <p className="text-muted-foreground text-xs">
              This environment needs no credentials.
            </p>
          );
        }

        const missing = status.entries.filter((entry) => !entry.resolved);
        const snippet = missing
          .map((entry) => `${entry.envVar}=`)
          .join("\n");

        return (
          <div className="border-border bg-card space-y-3 rounded-lg border p-4">
            <ul className="space-y-1">
              {status.entries.map((entry) => (
                <li
                  key={entry.envVar}
                  className="flex items-center gap-2 font-mono text-xs"
                >
                  <span
                    className={
                      entry.resolved
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-destructive"
                    }
                    aria-hidden
                  >
                    {entry.resolved ? "✓" : "✗"}
                  </span>
                  <span>{entry.envVar}</span>
                  <span className="text-muted-foreground">
                    {entry.resolved ? "set" : "not set"}
                  </span>
                </li>
              ))}
            </ul>

            {missing.length > 0 ? (
              <>
                <p className="text-muted-foreground text-xs">
                  Paste this into <code className="font-mono">apps/api/.env</code>,
                  fill in the values, then restart the API (
                  <code className="font-mono">npm run dev:api</code>). Agent X
                  stores only the variable names — the values are read from the
                  API&rsquo;s own environment when a run starts, and never reach
                  the database, the evidence files, a report, or a prompt.
                </p>

                <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">
                  {snippet}
                </pre>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(snippet)
                        .then(() => toast.success("Copied"))
                        .catch(() =>
                          toast.error("Could not copy to the clipboard"),
                        );
                    }}
                  >
                    Copy
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      resource.reload();
                      toast.info("Re-checking the API's environment");
                    }}
                  >
                    Re-check
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-xs">
                Every referenced variable is set. Agent X stores only the names;
                the values stay in the API&rsquo;s process environment.
              </p>
            )}
          </div>
        );
      }}
    </Async>
  );
}
