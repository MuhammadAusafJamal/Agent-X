import { RecordingDetail } from "./recording-detail";

export default async function RecordingPage({
  params,
}: PageProps<"/recordings/[id]">) {
  const { id } = await params;

  return <RecordingDetail recordingId={id} />;
}
