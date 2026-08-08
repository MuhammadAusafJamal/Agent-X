"use client";

import { useState } from "react";
import {
  createProjectSchema,
  projectSchema,
  type Project,
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

export function ProjectDialog({
  project,
  trigger,
  onSaved,
}: {
  project?: Project;
  trigger: React.ReactNode;
  onSaved: () => void;
}) {
  const editing = project !== undefined;

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);

    const body = {
      name,
      description: description.trim() === "" ? null : description,
    };

    // Validated client-side against the very schema the API validates with, so
    // the two cannot disagree about what a valid project is.
    const parsed = createProjectSchema.safeParse(body);

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
        editing ? `/projects/${project.id}` : "/projects",
        projectSchema,
        { method: editing ? "PATCH" : "POST", body: parsed.data },
      );
      setOpen(false);
      if (!editing) {
        setName("");
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
            <DialogTitle>{editing ? "Edit project" : "New project"}</DialogTitle>
            <DialogDescription>
              A project groups the applications you test together.
            </DialogDescription>
          </DialogHeader>

          {failure ? <ErrorBanner message={failure} /> : null}

          <Field label="Name" htmlFor="project-name" error={errors.name}>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Checkout revamp"
              autoFocus
            />
          </Field>

          <Field
            label="Description"
            htmlFor="project-description"
            error={errors.description}
            hint="Optional."
          >
            <Textarea
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </Field>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
