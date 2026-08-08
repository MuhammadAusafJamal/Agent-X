import { ProjectDetail } from "./project-detail";

export default async function ProjectPage({
  params,
}: PageProps<"/projects/[id]">) {
  const { id } = await params;

  return <ProjectDetail projectId={id} />;
}
