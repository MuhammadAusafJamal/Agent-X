import { RunReport } from "./run-report";

export default async function ReportPage({
  params,
}: PageProps<"/executions/[id]/report">) {
  const { id } = await params;

  return <RunReport executionId={id} />;
}
