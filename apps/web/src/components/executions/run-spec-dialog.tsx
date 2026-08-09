"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  environmentCredentialStatusSchema,
  environmentSchema,
  executionSchema,
  paginated,
} from "@agentx/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CredentialChecklist } from "@/components/catalog/credential-checklist";
import { Async } from "@/components/async";
import { Field } from "@/components/ui-bits";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { describe, useResource } from "@/lib/use-api";
import { toast } from "@/lib/use-toast";

/**
 * Starting a run.
 *
 * The common case — one environment, credentials resolved — does not open a
 * dialog at all: the button posts and navigates. A modal asking which of one
 * option to use is a click that teaches nobody anything.
 *
 * The dialog is still here for the cases that genuinely need a decision: more
 * than one environment, or a credential that is not set. That second one used
 * to be invisible until the run had already failed.
 */
export function RunSpecDialog({
  specId,
  applicationId,
  disabled,
}: {
  specId: string;
  applicationId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [environmentId, setEnvironmentId] = useState("");
  const [pending, setPending] = useState(false);

  const environments = useResource(
    () =>
      apiFetch(
        `/environments?applicationId=${applicationId}`,
        paginated(environmentSchema),
      ),
    `${applicationId}-environments`,
  );

  const options =
    environments.status === "ok" ? environments.data.items : [];
  const only = options.length === 1 ? options[0] : undefined;

  // Only asked for when there is a single environment; with several, the
  // dialog is opening regardless and the checklist renders inside it.
  const credentials = useResource(
    () =>
      only === undefined
        ? Promise.resolve(null)
        : apiFetch(
            `/environments/${only.id}/credentials`,
            environmentCredentialStatusSchema,
          ),
    `${only?.id ?? "none"}-credentials`,
  );

  const straightThrough =
    only !== undefined &&
    credentials.status === "ok" &&
    credentials.data !== null &&
    credentials.data.allResolved;

  const selected = environmentId === "" ? options[0]?.id : environmentId;

  async function start(id: string, environmentName: string) {
    setPending(true);

    try {
      const execution = await apiFetch("/executions", executionSchema, {
        method: "POST",
        body: { specId, environmentId: id },
      });
      setOpen(false);
      toast.success(`Run queued · ${environmentName}`);
      router.push(`/executions/${execution.id}`);
    } catch (error) {
      toast.error(describe(error));
    } finally {
      setPending(false);
    }
  }

  if (straightThrough && only !== undefined) {
    return (
      <Button
        size="sm"
        disabled={disabled === true || pending}
        onClick={() => void start(only.id, only.name)}
      >
        {pending ? "Starting…" : "Run"}
      </Button>
    );
  }

  return (
    <>
      <Button
        size="sm"
        disabled={disabled === true || environments.status === "loading"}
        onClick={() => setOpen(true)}
      >
        Run
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run this specification</DialogTitle>
            <DialogDescription>
              Replays the current version against an environment. Runs are
              queued one at a time.
            </DialogDescription>
          </DialogHeader>

          {/* Through `Async` so a failed request cannot be rendered as
              "no environments yet" — which is what it said before, sending
              people off to create one they already had. */}
          <Async
            resource={environments}
            skeleton={<Skeleton className="h-16 w-full" />}
            isEmpty={(page) => page.items.length === 0}
            empty={{
              title: "No environments yet",
              hint: "An environment says where this application runs. Add one on the application's Setup tab.",
              action: (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/applications/${applicationId}?tab=setup`}>
                    Go to Setup
                  </Link>
                </Button>
              ),
            }}
          >
            {() => (
              <div className="space-y-4">
                {options.length > 1 ? (
                  <Field label="Environment" htmlFor="run-env">
                    <select
                      id="run-env"
                      value={selected}
                      onChange={(e) => setEnvironmentId(e.target.value)}
                      className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                    >
                      {options.map((environment) => (
                        <option key={environment.id} value={environment.id}>
                          {environment.name} — {environment.baseUrl}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}

                {selected !== undefined ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Credentials</p>
                    <CredentialChecklist environmentId={selected} />
                  </div>
                ) : null}
              </div>
            )}
          </Async>

          <DialogFooter>
            <Button
              onClick={() => {
                const environment = options.find((o) => o.id === selected);
                if (environment !== undefined) {
                  void start(environment.id, environment.name);
                }
              }}
              disabled={pending || selected === undefined}
            >
              {pending
                ? "Starting…"
                : // Never blocked on a missing credential: the API fails fast
                  // and names every missing variable at once, which is the
                  // honest answer. The warning is above; the choice is theirs.
                  "Start run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
