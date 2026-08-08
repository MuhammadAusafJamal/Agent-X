import { KnowledgeList } from "./knowledge-list";

export default async function ApplicationKnowledgePage({
  params,
}: PageProps<"/knowledge/[applicationId]">) {
  const { applicationId } = await params;

  return <KnowledgeList applicationId={applicationId} />;
}
