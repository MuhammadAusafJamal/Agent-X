import { redirect } from "next/navigation";

/**
 * The report is a tab on the run now, not a page of its own.
 *
 * Kept as a redirect rather than deleted: links to it exist in the wild, and a
 * route that used to work should not start 404ing to save four lines.
 */
export default async function RunReportPage({
  params,
}: PageProps<"/executions/[id]/report">) {
  const { id } = await params;

  redirect(`/executions/${id}?view=report`);
}
