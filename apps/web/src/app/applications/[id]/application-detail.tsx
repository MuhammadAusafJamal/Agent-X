"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  applicationWithEnvironmentsSchema,
  paginated,
  recordingSchema,
  testSpecSchema,
} from "@agentx/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApplicationDialog } from "@/components/catalog/application-dialog";
import { CredentialStatus } from "@/components/catalog/credential-status";
import { DeleteButton } from "@/components/catalog/delete-button";
import { EnvironmentDialog } from "@/components/catalog/environment-dialog";
import { StartRecordingDialog } from "@/components/recorder/start-recording-dialog";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui-bits";
import { apiFetch } from "@/lib/api";
import { useResource } from "@/lib/use-api";

export function ApplicationDetail({
  applicationId,
}: {
  applicationId: string;
}) {
  const router = useRouter();
  const resource = useResource(
    () =>
      apiFetch(
        `/applications/${applicationId}`,
        applicationWithEnvironmentsSchema,
      ),
    applicationId,
  );

  const recordings = useResource(
    () =>
      apiFetch(
        `/recordings?applicationId=${applicationId}`,
        paginated(recordingSchema),
      ),
    `${applicationId}-recordings`,
  );

  const specs = useResource(
    () =>
      apiFetch(
        `/specs?applicationId=${applicationId}`,
        paginated(testSpecSchema),
      ),
    `${applicationId}-specs`,
  );

  if (resource.status === "loading") {
    return <Loading what="application" />;
  }

  if (resource.status === "error") {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <ErrorBanner message={resource.error} />
        <Link href="/projects" className="text-sm underline">
          Back to projects
        </Link>
      </div>
    );
  }

  const application = resource.data;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href={`/projects/${application.projectId}`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← Project
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">
            {application.name}
          </h1>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            {application.baseUrl}
          </p>
          {application.description ? (
            <p className="text-muted-foreground mt-2 text-sm">
              {application.description}
            </p>
          ) : null}
        </div>

        <div className="flex gap-2">
          <StartRecordingDialog
            applicationId={application.id}
            baseUrl={application.environments[0]?.baseUrl ?? application.baseUrl}
            environments={application.environments}
          />
          <ApplicationDialog
            projectId={application.projectId}
            application={application}
            trigger={
              <Button variant="outline" size="sm">
                Edit
              </Button>
            }
            onSaved={resource.reload}
          />
          <DeleteButton
            path={`/applications/${application.id}`}
            label={application.name}
            cascadeWarning="This also deletes its environments, test specs, recorded sessions, executions, and everything the agent has learned about it. This cannot be undone."
            onDeleted={() => router.push(`/projects/${application.projectId}`)}
          />
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="font-heading text-sm font-semibold">
          Test specifications
        </h2>

        {specs.status === "ok" && specs.data.items.length > 0 ? (
          <ul className="border-border divide-border divide-y rounded-lg border text-sm">
            {specs.data.items.map((spec) => (
              <li key={spec.id} className="flex items-center gap-3 px-4 py-2">
                <Link
                  href={`/specs/${spec.id}`}
                  className="flex-1 font-medium hover:underline"
                >
                  {spec.name}
                </Link>
                <Badge variant="outline" className="text-xs">
                  {spec.source}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            None yet. Record a session and compile it into one.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-sm font-semibold">Recordings</h2>

        {recordings.status === "ok" && recordings.data.items.length > 0 ? (
          <ul className="border-border divide-border divide-y rounded-lg border text-sm">
            {recordings.data.items.map((recording) => (
              <li
                key={recording.id}
                className="flex items-center gap-3 px-4 py-2"
              >
                <Link
                  href={`/recordings/${recording.id}`}
                  className="flex-1 truncate font-mono text-xs hover:underline"
                >
                  {recording.startUrl}
                </Link>
                <span className="text-muted-foreground text-xs">
                  {recording.eventCount ?? 0} events
                </span>
                <Badge
                  variant={
                    recording.status === "RECORDING" ? "secondary" : "outline"
                  }
                  className="text-xs"
                >
                  {recording.status}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No recordings yet.</p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-heading text-sm font-semibold">Environments</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              Credentials are referenced by environment variable name; values
              are read at run time and never stored.
            </p>
          </div>
          <EnvironmentDialog
            applicationId={application.id}
            trigger={
              <Button size="sm" variant="outline">
                New environment
              </Button>
            }
            onSaved={resource.reload}
          />
        </div>

        {application.environments.length === 0 ? (
          <EmptyState
            title="No environments yet"
            hint="An environment says where this application actually runs, and which environment variables hold its login credentials."
            action={
              <EnvironmentDialog
                applicationId={application.id}
                trigger={<Button size="sm">New environment</Button>}
                onSaved={resource.reload}
              />
            }
          />
        ) : (
          <div className="border-border rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Base URL</TableHead>
                  <TableHead>Credentials</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {application.environments.map((environment) => (
                  <TableRow key={environment.id}>
                    <TableCell className="font-medium">
                      {environment.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {environment.baseUrl}
                    </TableCell>
                    <TableCell>
                      <CredentialStatus environmentId={environment.id} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <EnvironmentDialog
                          applicationId={application.id}
                          environment={environment}
                          trigger={
                            <Button variant="ghost" size="sm">
                              Edit
                            </Button>
                          }
                          onSaved={resource.reload}
                        />
                        <DeleteButton
                          path={`/environments/${environment.id}`}
                          label={environment.name}
                          cascadeWarning="This also deletes the executions that ran against this environment. This cannot be undone."
                          onDeleted={resource.reload}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
