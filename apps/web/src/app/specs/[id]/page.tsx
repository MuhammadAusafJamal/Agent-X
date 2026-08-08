import { SpecDetail } from "./spec-detail";

export default async function SpecPage({ params }: PageProps<"/specs/[id]">) {
  const { id } = await params;

  return <SpecDetail specId={id} />;
}
