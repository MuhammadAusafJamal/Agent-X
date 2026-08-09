import { redirect } from "next/navigation";

/** Folded into the application workspace as a tab. */
export default async function ApplicationKnowledgePage({
  params,
}: PageProps<"/knowledge/[applicationId]">) {
  const { applicationId } = await params;

  redirect(`/applications/${applicationId}?tab=knowledge`);
}
