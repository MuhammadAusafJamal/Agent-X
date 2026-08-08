"use client";

import Link from "next/link";
import { paginated, projectSchema } from "@agentx/shared";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProjectDialog } from "@/components/catalog/project-dialog";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui-bits";
import { apiFetch } from "@/lib/api";
import { useResource } from "@/lib/use-api";

export function ProjectsList() {
  const resource = useResource(
    () => apiFetch("/projects", paginated(projectSchema)),
    "projects",
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Projects</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            A project groups the applications you test together.
          </p>
        </div>

        <ProjectDialog
          trigger={<Button>New project</Button>}
          onSaved={resource.reload}
        />
      </div>

      {resource.status === "loading" ? <Loading what="projects" /> : null}
      {resource.status === "error" ? (
        <ErrorBanner message={resource.error} />
      ) : null}

      {resource.status === "ok" && resource.data.items.length === 0 ? (
        <EmptyState
          title="No projects yet"
          hint="Create one, add the application you want to test, then point an environment at it."
          action={
            <ProjectDialog
              trigger={<Button>New project</Button>}
              onSaved={resource.reload}
            />
          }
        />
      ) : null}

      {resource.status === "ok" && resource.data.items.length > 0 ? (
        <div className="border-border rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-32">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resource.data.items.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/projects/${project.id}`}
                      className="hover:underline"
                    >
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {project.description ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {new Date(project.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
