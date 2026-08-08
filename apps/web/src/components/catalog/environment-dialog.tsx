"use client";

import { useState } from "react";
import {
  createEnvironmentSchema,
  environmentSchema,
  updateEnvironmentSchema,
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

export function EnvironmentDialog({
  applicationId,
  environment,
  trigger,
  onSaved,
}: {
  applicationId: string;
  environment?: Environment;
  trigger: React.ReactNode;
  onSaved: () => void;
}) {
  const editing = environment !== undefined;

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(environment?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(environment?.baseUrl ?? "");
  const [usernameEnv, setUsernameEnv] = useState(
    environment?.credentialRefs.usernameEnv ?? "",
  );
  const [passwordEnv, setPasswordEnv] = useState(
    environment?.credentialRefs.passwordEnv ?? "",
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
      credentialRefs: {
        // Empty means "no credential referenced", not an empty variable name.
        usernameEnv: usernameEnv.trim() === "" ? undefined : usernameEnv.trim(),
        passwordEnv: passwordEnv.trim() === "" ? undefined : passwordEnv.trim(),
        extra: environment?.credentialRefs.extra ?? {},
      },
    };

    const parsed = editing
      ? updateEnvironmentSchema.safeParse(common)
      : createEnvironmentSchema.safeParse({ ...common, applicationId });

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
        editing ? `/environments/${environment.id}` : "/environments",
        environmentSchema,
        { method: editing ? "PATCH" : "POST", body: parsed.data },
      );
      setOpen(false);
      if (!editing) {
        setName("");
        setBaseUrl("");
        setUsernameEnv("");
        setPasswordEnv("");
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
              {editing ? "Edit environment" : "New environment"}
            </DialogTitle>
            <DialogDescription>
              A deployment of this application — local, staging, and so on.
            </DialogDescription>
          </DialogHeader>

          {failure ? <ErrorBanner message={failure} /> : null}

          <Field label="Name" htmlFor="env-name" error={errors.name}>
            <Input
              id="env-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="local"
              autoFocus
            />
          </Field>

          <Field
            label="Base URL"
            htmlFor="env-url"
            error={errors.baseUrl}
            hint="Overrides the application's base URL for this deployment."
          >
            <Input
              id="env-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:4321"
            />
          </Field>

          <div className="border-border space-y-4 rounded-md border p-4">
            <div>
              <p className="text-sm font-medium">Credentials</p>
              <p className="text-muted-foreground mt-1 text-xs">
                These are environment <strong>variable names</strong>, not
                values. The runner reads them from the process environment when
                a test runs, so no secret is ever stored in the database or
                written to evidence.
              </p>
            </div>

            <Field
              label="Username variable"
              htmlFor="env-username"
              error={errors["credentialRefs.usernameEnv"]}
            >
              <Input
                id="env-username"
                value={usernameEnv}
                onChange={(e) => setUsernameEnv(e.target.value)}
                placeholder="DEMO_USER"
                className="font-mono"
              />
            </Field>

            <Field
              label="Password variable"
              htmlFor="env-password"
              error={errors["credentialRefs.passwordEnv"]}
            >
              <Input
                id="env-password"
                value={passwordEnv}
                onChange={(e) => setPasswordEnv(e.target.value)}
                placeholder="DEMO_PASSWORD"
                className="font-mono"
              />
            </Field>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save" : "Create environment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
