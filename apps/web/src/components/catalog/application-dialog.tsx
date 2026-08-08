"use client";

import { useState } from "react";
import {
  applicationSchema,
  createApplicationSchema,
  updateApplicationSchema,
  type Application,
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
import { Textarea } from "@/components/ui/textarea";
import { ErrorBanner, Field } from "@/components/ui-bits";
import { apiFetch } from "@/lib/api";
import { describe, fieldErrors } from "@/lib/use-api";

export function ApplicationDialog({
  projectId,
  application,
  trigger,
  onSaved,
}: {
  projectId: string;
  application?: Application;
  trigger: React.ReactNode;
  onSaved: () => void;
}) {
  const editing = application !== undefined;

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(application?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(application?.baseUrl ?? "");
  const [description, setDescription] = useState(
    application?.description ?? "",
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);

    const common = {
      name,
      baseUrl,
      description: description.trim() === "" ? null : description,
    };

    const parsed = editing
      ? updateApplicationSchema.safeParse(common)
      : createApplicationSchema.safeParse({ ...common, projectId });

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
      await apiFetch(
        editing ? `/applications/${application.id}` : "/applications",
        applicationSchema,
        { method: editing ? "PATCH" : "POST", body: parsed.data },
      );
      setOpen(false);
      if (!editing) {
        setName("");
        setBaseUrl("");
        setDescription("");
      }
      onSaved();
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(describe(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit application" : "New application"}
            </DialogTitle>
            <DialogDescription>
              A website under test. Recordings and specs hang off it.
            </DialogDescription>
          </DialogHeader>

          {failure ? <ErrorBanner message={failure} /> : null}

          <Field label="Name" htmlFor="app-name" error={errors.name}>
            <Input
              id="app-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Storefront"
              autoFocus
            />
          </Field>

          <Field
            label="Base URL"
            htmlFor="app-url"
            error={errors.baseUrl}
            hint="Must be http:// or https://"
          >
            <Input
              id="app-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:4321"
            />
          </Field>

          <Field
            label="Description"
            htmlFor="app-description"
            error={errors.description}
            hint="Domain context for the agent, e.g. “a B2B invoicing app”."
          >
            <Textarea
              id="app-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </Field>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save" : "Create application"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
