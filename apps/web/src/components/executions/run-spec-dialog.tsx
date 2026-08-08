"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { executionSchema, environmentSchema, paginated } from "@agentx/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ErrorBanner, Field, Loading } from "@/components/ui-bits";
import { apiFetch } from "@/lib/api";
import { describe, useResource } from "@/lib/use-api";

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
  const [failure, setFailure] = useState<string | null>(null);
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
  const selected = environmentId === "" ? options[0]?.id : environmentId;

  async function start() {
    if (selected === undefined) return;

    setFailure(null);
    setPending(true);

    try {
      const execution = await apiFetch("/executions", executionSchema, {
        method: "POST",
        body: { specId, environmentId: selected },
      });
      setOpen(false);
      router.push(`/executions/${execution.id}`);
    } catch (error) {
      setFailure(describe(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          Run
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run this specification</DialogTitle>
          <DialogDescription>
            Replays the current version against an environment. Runs are queued
            one at a time.
          </DialogDescription>
        </DialogHeader>

        {failure ? <ErrorBanner message={failure} /> : null}

        {environments.status === "loading" ? (
          <Loading what="environments" />
        ) : options.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            This application has no environments yet. Add one first — it says
            where the application runs and which variables hold its credentials.
          </p>
        ) : (
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
        )}

        <DialogFooter>
          <Button
            onClick={start}
            disabled={pending || options.length === 0}
          >
            {pending ? "Starting…" : "Start run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
