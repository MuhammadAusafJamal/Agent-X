import { ApplicationDetail } from "./application-detail";

export default async function ApplicationPage({
  params,
}: PageProps<"/applications/[id]">) {
  const { id } = await params;

  return <ApplicationDetail applicationId={id} />;
}
