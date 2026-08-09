"use client";

import Link from "next/link";
import {
  applicationSchema,
  paginated,
  projectSchema,
  type Application,
  type Project,
} from "@agentx/shared";
import { Button } from "@/components/ui/button";
import { ApplicationDialog } from "@/components/catalog/application-dialog";
import { ProjectDialog } from "@/components/catalog/project-dialog";
import { QuickStartDialog } from "@/components/catalog/quick-start-dialog";
import { Async } from "@/components/async";
import { CardListSkeleton } from "@/components/ui-bits";
import { apiFetch } from "@/lib/api";
import { useResource } from "@/lib/use-api";

/**
 * The catalog: applications, grouped by the project they belong to.
 *
 * Projects used to get a list screen of their own, so reaching an application
 * meant two clicks through a page whose entire content was "here are the two
 * applications in this project". They are a grouping, so they are rendered as
 * one.
 */
export function ProjectsList() {
  const projects = useResource(
    () => apiFetch("/projects", paginated(projectSchema)),
    "projects",
  );

  const applications = useResource(
    () => apiFetch("/applications", paginated(applicationSchema)),
    "applications",
  );

  const reload = () => {
    projects.reload();
    applications.reload();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Applications</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            The websites you test, grouped by project.
          </p>
        </div>

        <div className="flex gap-2">
          <ProjectDialog
            trigger={
              <Button variant="outline" size="sm">
                New project
              </Button>
            }
            onSaved={reload}
          />
          <QuickStartDialog trigger={<Button>Add an application</Button>} />
        </div>
      </div>

      <Async
        resource={projects}
        skeleton={<CardListSkeleton cards={2} />}
        isEmpty={(page) => page.items.length === 0}
        empty={{
          title: "Nothing here yet",
          hint: "Add the application you want to test. Agent X opens a browser, records one session, and turns it into a test that keeps working when the page changes.",
          action: (
            <QuickStartDialog trigger={<Button>Add an application</Button>} />
          ),
        }}
      >
        {(projectPage) => (
          <Async resource={applications} skeleton={<CardListSkeleton />}>
            {(applicationPage) => (
              <div className="space-y-8">
                {projectPage.items.map((project) => (
                  <ProjectGroup
                    key={project.id}
                    project={project}
                    applications={applicationPage.items.filter(
                      (application) => application.projectId === project.id,
                    )}
                    onChanged={reload}
                  />
                ))}
              </div>
            )}
          </Async>
        )}
      </Async>
    </div>
  );
}

function ProjectGroup({
  project,
  applications,
  onChanged,
}: {
  project: Project;
  applications: Application[];
  onChanged: () => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-sm font-semibold">{project.name}</h2>
          {project.description ? (
            <p className="text-muted-foreground text-xs">
              {project.description}
            </p>
          ) : null}
        </div>

        <ApplicationDialog
          projectId={project.id}
          trigger={
            <Button variant="ghost" size="sm">
              New application
            </Button>
          }
          onSaved={onChanged}
        />
      </div>

      {applications.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-6 text-center text-sm">
          No applications in this project yet.
        </p>
      ) : (
        <ul className="border-border divide-border divide-y rounded-lg border">
          {applications.map((application) => (
            <li key={application.id} className="px-4 py-3">
              <Link
                href={`/applications/${application.id}`}
                className="font-medium hover:underline"
              >
                {application.name}
              </Link>
              <p className="text-muted-foreground truncate font-mono text-xs">
                {application.baseUrl}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
