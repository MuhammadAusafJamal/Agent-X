"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  applicationSchema,
  createApplicationSchema,
  createEnvironmentSchema,
  createProjectSchema,
  environmentSchema,
  projectSchema,
  recordingSchema,
  startRecordingSchema,
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
import { toast } from "@/lib/use-toast";

/**
 * Everything between an empty database and a browser opening, in one form.
 *
 * The cold-start path used to be four screens and five dialogs: create a
 * project, navigate to it, create an application, navigate to it, create an
 * environment, then start a recording — twelve fields, three of them URLs
 * collected in three different places with only one of the three explaining how
 * it related to the others.
 *
 * They are three separate records for good reasons, but a person setting up
 * their first test does not have those reasons yet. So this asks for what is
 * genuinely unknown — a name and a URL — and writes all four records, using the
 * single URL as the application's base, the environment's base, and the
 * recording's start. Anyone who needs those to differ can edit them afterwards,
 * where the difference has somewhere to be explained.
 */
export function QuickStartDialog({
  projectId,
  trigger,
}: {
  /** Skips creating a project when there already is one to hang this on. */
  projectId?: string;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projectName, setProjectName] = useState("My project");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [usernameEnv, setUsernameEnv] = useState("");
  const [passwordEnv, setPasswordEnv] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setErrors({});

    try {
      // The project first, unless one was handed in.
      let owningProjectId = projectId;

      if (owningProjectId === undefined) {
        setPending("Creating the project…");
        const parsedProject = createProjectSchema.safeParse({
          name: projectName,
          description: null,
        });

        if (!parsedProject.success) {
          setErrors(issuesOf(parsedProject.error.issues, "projectName"));
          return;
        }

        const project = await apiFetch("/projects", projectSchema, {
          method: "POST",
          body: parsedProject.data,
        });
        owningProjectId = project.id;
      }

      setPending("Creating the application…");
      const parsedApplication = createApplicationSchema.safeParse({
        projectId: owningProjectId,
        name,
        baseUrl: url,
        description: null,
      });

      if (!parsedApplication.success) {
        setErrors(issuesOf(parsedApplication.error.issues));
        return;
      }

      const application = await apiFetch("/applications", applicationSchema, {
        method: "POST",
        body: parsedApplication.data,
      });

      setPending("Creating the environment…");
      const parsedEnvironment = createEnvironmentSchema.safeParse({
        applicationId: application.id,
        name: "local",
        baseUrl: url,
        credentialRefs: {
          // Names, never values. Empty strings mean "no reference", not "".
          usernameEnv: needsLogin && usernameEnv !== "" ? usernameEnv : undefined,
          passwordEnv: needsLogin && passwordEnv !== "" ? passwordEnv : undefined,
          extra: {},
        },
      });

      if (!parsedEnvironment.success) {
        setErrors(issuesOf(parsedEnvironment.error.issues));
        return;
      }

      const environment = await apiFetch("/environments", environmentSchema, {
        method: "POST",
        body: parsedEnvironment.data,
      });

      setPending("Opening the browser…");
      const parsedRecording = startRecordingSchema.safeParse({
        applicationId: application.id,
        environmentId: environment.id,
        startUrl: url,
      });

      if (!parsedRecording.success) {
        setErrors(issuesOf(parsedRecording.error.issues));
        return;
      }

      const recording = await apiFetch("/recordings", recordingSchema, {
        method: "POST",
        body: parsedRecording.data,
      });

      setOpen(false);
      toast.success(
        `${application.name} is set up`,
        "A browser window is opening — click through the flow you want to test.",
      );
      router.push(`/recordings/${recording.id}`);
    } catch (error) {
      setErrors(fieldErrors(error));
      setFailure(describe(error));
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add an application</DialogTitle>
            <DialogDescription>
              A browser opens on this machine and records what you click. That
              recording becomes a test written as intent, which the agent can
              replay even after the page changes.
            </DialogDescription>
          </DialogHeader>

          {failure ? <ErrorBanner message={failure} /> : null}

          {projectId === undefined ? (
            <Field
              label="Project"
              htmlFor="quick-project"
              error={errors.projectName ?? errors.name}
              hint="Just a folder for applications you test together."
            >
              <Input
                id="quick-project"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </Field>
          ) : null}

          <Field
            label="Application name"
            htmlFor="quick-name"
            error={errors.name}
          >
            <Input
              id="quick-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Storefront"
              autoFocus
            />
          </Field>

          <Field
            label="Where does it run?"
            htmlFor="quick-url"
            error={errors.baseUrl ?? errors.startUrl}
            hint="The browser opens here. You can add other deployments later."
          >
            <Input
              id="quick-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:4321"
            />
          </Field>

          <div className="border-border rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={needsLogin}
                onChange={(e) => setNeedsLogin(e.target.checked)}
              />
              Needs a login?
            </label>

            {needsLogin ? (
              <div className="mt-3 space-y-3">
                <p className="text-muted-foreground text-xs">
                  These are environment <strong>variable names</strong>, not the
                  credentials themselves. The values are read from the API&rsquo;s
                  process environment when a run starts, so no secret is stored
                  in the database or written to evidence.
                </p>

                <Field
                  label="Username variable"
                  htmlFor="quick-user"
                  error={errors["credentialRefs.usernameEnv"]}
                >
                  <Input
                    id="quick-user"
                    value={usernameEnv}
                    onChange={(e) => setUsernameEnv(e.target.value)}
                    placeholder="DEMO_APP_USER"
                    className="font-mono"
                  />
                </Field>

                <Field
                  label="Password variable"
                  htmlFor="quick-pass"
                  error={errors["credentialRefs.passwordEnv"]}
                >
                  <Input
                    id="quick-pass"
                    value={passwordEnv}
                    onChange={(e) => setPasswordEnv(e.target.value)}
                    placeholder="DEMO_APP_PASSWORD"
                    className="font-mono"
                  />
                </Field>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending !== null}>
              {pending ?? "Create and record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Zod issues keyed by field path, with an optional rename for the leading field. */
function issuesOf(
  issues: { path: PropertyKey[]; message: string }[],
  renameName?: string,
): Record<string, string> {
  return Object.fromEntries(
    issues.map((issue) => {
      const path = issue.path.map(String).join(".");
      return [
        renameName !== undefined && path === "name" ? renameName : path,
        issue.message,
      ];
    }),
  );
}
