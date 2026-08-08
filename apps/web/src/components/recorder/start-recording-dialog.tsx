"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  recordingSchema,
  startRecordingSchema,
  type Environment,
} from "@agentx/shared";
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
import { Input } from "@/components/ui/input";
import { ErrorBanner, Field } from "@/components/ui-bits";
import { apiFetch } from "@/lib/api";
import { describe, fieldErrors } from "@/lib/use-api";

export function StartRecordingDialog({
  applicationId,
  baseUrl,
  environments,
}: {
  applicationId: string;
  baseUrl: string;
  environments: Environment[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [startUrl, setStartUrl] = useState(baseUrl);
  const [environmentId, setEnvironmentId] = useState<string>(
    environments[0]?.id ?? "",
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);

    const parsed = startRecordingSchema.safeParse({
      applicationId,
      environmentId: environmentId === "" ? null : environmentId,
      startUrl,
    });

    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            issue.path.join("."),
            issue.message,
          ]),
        ),
      );
      return;
    }

    setErrors({});
    setPending(true);

    try {
      const recording = await apiFetch("/recordings", recordingSchema, {
        method: "POST",
        body: parsed.data,
      });
      setOpen(false);
      router.push(`/recordings/${recording.id}`);
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(describe(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Record a session</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Record a session</DialogTitle>
            <DialogDescription>
              A browser window opens on this machine. Click through the flow you
              want to test, then stop the recording — every action is captured
              with the context needed to replay it by intent.
            </DialogDescription>
          </DialogHeader>

          {failure ? <ErrorBanner message={failure} /> : null}

          <Field
            label="Start URL"
            htmlFor="record-url"
            error={errors.startUrl}
            hint="Where the browser opens."
          >
            <Input
              id="record-url"
              value={startUrl}
              onChange={(e) => setStartUrl(e.target.value)}
              autoFocus
            />
          </Field>

          {environments.length > 0 ? (
            <Field
              label="Environment"
              htmlFor="record-env"
              error={errors.environmentId}
            >
              <select
                id="record-env"
                value={environmentId}
                onChange={(e) => setEnvironmentId(e.target.value)}
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              >
                <option value="">None</option>
                {environments.map((environment) => (
                  <option key={environment.id} value={environment.id}>
                    {environment.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Opening browser…" : "Start recording"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
