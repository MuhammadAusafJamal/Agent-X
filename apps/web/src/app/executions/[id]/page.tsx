import { ExecutionDetail } from "./execution-detail";

export default async function ExecutionPage({
  params,
}: PageProps<"/executions/[id]">) {
  const { id } = await params;

  return <ExecutionDetail executionId={id} />;
}
