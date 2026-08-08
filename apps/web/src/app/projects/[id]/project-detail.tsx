"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { projectWithApplicationsSchema } from "@agentx/shared";
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
import { DeleteButton } from "@/components/catalog/delete-button";
import { ProjectDialog } from "@/components/catalog/project-dialog";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui-bits";
import { apiFetch } from "@/lib/api";
import { useResource } from "@/lib/use-api";

export function ProjectDetail({ projectId }: { projectId: string }) {
  const router = useRouter();
  const resource = useResource(
    () => apiFetch(`/projects/${projectId}`, projectWithApplicationsSchema),
    projectId,
  );

  if (resource.status === "loading") {
    return <Loading what="project" />;
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

  const project = resource.data;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/projects"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← Projects
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">
            {project.name}
          </h1>
          {project.description ? (
            <p className="text-muted-foreground mt-1 text-sm">
              {project.description}
            </p>
          ) : null}
        </div>

        <div className="flex gap-2">
          <ProjectDialog
            project={project}
            trigger={
              <Button variant="outline" size="sm">
                Edit
              </Button>
            }
            onSaved={resource.reload}
          />
          <DeleteButton
            path={`/projects/${project.id}`}
            label={project.name}
            cascadeWarning="This also deletes its applications, environments, test specs, recorded sessions, executions, and everything the agent has learned about them. This cannot be undone."
            onDeleted={() => router.push("/projects")}
          />
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-sm font-semibold">Applications</h2>
          <ApplicationDialog
            projectId={project.id}
            trigger={
              <Button size="sm" variant="outline">
                New application
              </Button>
            }
            onSaved={resource.reload}
          />
        </div>

        {project.applications.length === 0 ? (
          <EmptyState
            title="No applications yet"
            hint="Add the website you want to test. Recordings, specs, and runs all hang off an application."
            action={
              <ApplicationDialog
                projectId={project.id}
                trigger={<Button size="sm">New application</Button>}
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
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {project.applications.map((application) => (
                  <TableRow key={application.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/applications/${application.id}`}
                        className="hover:underline"
                      >
                        {application.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {application.baseUrl}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {application.description ?? "—"}
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
