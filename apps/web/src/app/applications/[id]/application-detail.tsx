"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  applicationWithEnvironmentsSchema,
  paginated,
  recordingSchema,
  testSpecSchema,
} from "@agentx/shared";
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
import { CredentialChecklist } from "@/components/catalog/credential-checklist";
import { DeleteButton } from "@/components/catalog/delete-button";
import { EnvironmentDialog } from "@/components/catalog/environment-dialog";
import { StartRecordingDialog } from "@/components/recorder/start-recording-dialog";
import { KnowledgePanel } from "@/components/knowledge/knowledge-panel";
import { Term } from "@/components/vocab-badge";
import { Async } from "@/components/async";
import { CardListSkeleton, EmptyState } from "@/components/ui-bits";
import { apiFetch } from "@/lib/api";
import { useResource } from "@/lib/use-api";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "tests", label: "Tests" },
  { id: "recordings", label: "Recordings" },
  { id: "setup", label: "Setup" },
  { id: "knowledge", label: "Knowledge" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * Everything about one application, in tabs.
 *
 * This page used to be three list screens fused into one scroll — specs,
 * recordings, and environments, each with its own heading, dialogs, and empty
 * state, all mounted at once. Tabs are not decoration here: they are what makes
 * the "Record a session" button sit next to the thing it needs rather than
 * three sections above it.
 */
export function ApplicationDetail({
  applicationId,
}: {
  applicationId: string;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [tab, setTab] = useState<TabId>(tabFrom(search.get("tab")));

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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/projects"
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        ← Applications
      </Link>

      <Async resource={resource} skeleton={<CardListSkeleton cards={3} />}>
        {(application) => (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
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

              <div className="flex flex-wrap gap-2">
                <StartRecordingDialog
                  applicationId={application.id}
                  baseUrl={
                    application.environments[0]?.baseUrl ?? application.baseUrl
                  }
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
                  onDeleted={() => router.push("/projects")}
                />
              </div>
            </div>

            <div className="border-border flex gap-1 border-b">
              {TABS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={cn(
                    "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                    tab === id
                      ? "border-primary text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground border-transparent",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "tests" ? (
              <Async
                resource={specs}
                skeleton={<CardListSkeleton cards={2} />}
                isEmpty={(page) => page.items.length === 0}
                empty={{
                  title: "No test specifications yet",
                  hint: "Record a session against this application and compile it into one. The agent replays it by intent, so it keeps working when the page changes.",
                  action: (
                    <StartRecordingDialog
                      applicationId={application.id}
                      baseUrl={
                        application.environments[0]?.baseUrl ??
                        application.baseUrl
                      }
                      environments={application.environments}
                    />
                  ),
                }}
              >
                {(page) => (
                  <ul className="border-border divide-border divide-y rounded-lg border text-sm">
                    {page.items.map((spec) => (
                      <li
                        key={spec.id}
                        className="flex items-center gap-3 px-4 py-2"
                      >
                        <Link
                          href={`/specs/${spec.id}`}
                          className="flex-1 font-medium hover:underline"
                        >
                          {spec.name}
                        </Link>
                        <Term
                          kind="specSource"
                          value={spec.source}
                          className="text-xs"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </Async>
            ) : null}

            {tab === "recordings" ? (
              <Async
                resource={recordings}
                skeleton={<CardListSkeleton cards={2} />}
                isEmpty={(page) => page.items.length === 0}
                empty={{
                  title: "No recordings yet",
                  hint: "A browser opens on this machine and captures what you click, along with the context needed to replay it by intent.",
                  action: (
                    <StartRecordingDialog
                      applicationId={application.id}
                      baseUrl={
                        application.environments[0]?.baseUrl ??
                        application.baseUrl
                      }
                      environments={application.environments}
                    />
                  ),
                }}
              >
                {(page) => (
                  <ul className="border-border divide-border divide-y rounded-lg border text-sm">
                    {page.items.map((recording) => (
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
                        <Term
                          kind="recordingStatus"
                          value={recording.status}
                          variant={
                            recording.status === "RECORDING"
                              ? "secondary"
                              : "outline"
                          }
                          className="text-xs"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </Async>
            ) : null}

            {tab === "setup" ? (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <p className="text-muted-foreground max-w-lg text-sm">
                    An environment says where this application actually runs, and
                    which environment variables hold its login credentials. Its
                    base URL overrides the application&rsquo;s.
                  </p>
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
                    hint="Without one there is nowhere to run a test. It is usually the same URL as the application itself."
                    action={
                      <EnvironmentDialog
                        applicationId={application.id}
                        trigger={<Button size="sm">New environment</Button>}
                        onSaved={resource.reload}
                      />
                    }
                  />
                ) : (
                  <div className="space-y-4">
                    <div className="border-border rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Base URL</TableHead>
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

                    {application.environments.map((environment) => (
                      <div key={environment.id} className="space-y-2">
                        <h3 className="text-sm font-medium">
                          Credentials for {environment.name}
                        </h3>
                        <CredentialChecklist environmentId={environment.id} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {tab === "knowledge" ? (
              <KnowledgePanel applicationId={application.id} />
            ) : null}
          </>
        )}
      </Async>
    </div>
  );
}

function tabFrom(raw: string | null): TabId {
  return TABS.some((tab) => tab.id === raw) ? (raw as TabId) : "tests";
}
