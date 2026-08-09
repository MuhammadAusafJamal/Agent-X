import { FeatureCheckDetail } from "./feature-check-detail";

export default async function FeatureCheckPage({
  params,
}: PageProps<"/features/[id]">) {
  const { id } = await params;

  return <FeatureCheckDetail featureCheckId={id} />;
}
