"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import {
  TERMINAL_EVENT_TYPES,
  recordingSchema,
  recordingSseEventSchema,
  recordingWithEventsSchema,
  testSpecWithCurrentVersionSchema,
  type RecordedEvent,
} from "@agentx/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui-bits";
import { apiFetch, evidenceUrl } from "@/lib/api";
import { useEventStream } from "@/lib/events";
import { describe, useResource } from "@/lib/use-api";

/**
 * Live view of a recording.
 *
 * Stored events come from the API; anything captured while this page is open
 * arrives over SSE and is merged in by id. That combination is what lets the
 * page be opened mid-session, reloaded, or opened long after the fact.
 */
export function RecordingDetail({ recordingId }: { recordingId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const resource = useResource(
    () => apiFetch(`/recordings/${recordingId}`, recordingWithEventsSchema),
    recordingId,
  );

  const isRecording =
    resource.status === "ok" && resource.data.status === "RECORDING";

  const stream = useEventStream(
    isRecording ? `/recordings/${recordingId}/events` : null,
    recordingSseEventSchema,
    {
      // Shared with the API rather than hand-written. Spelled out as
      // `recording.stopped` alone, this missed `recording.error`, so a
      // recorder that crashed left the stream open on a page that never
      // stopped saying it was live.
      isTerminal: (event) => TERMINAL_EVENT_TYPES.includes(event.type),
    },
  );

  if (resource.status === "loading") return <Loading what="recording" />;

  if (resource.status === "error") {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <ErrorBanner message={resource.error} />
        <Link href="/projects" className="text-sm underline">
          Back to projects
        </Link>
      </div>
    );
  }

  const recording = resource.data;

  // Live events merged over the stored ones, de-duplicated by id.
  const live = stream.events
    .filter((event) => event.type === "recording.event")
    .map((event) => event.event);
  const seen = new Set(recording.events.map((event) => event.id));
  const events: RecordedEvent[] = [
    ...recording.events,
    ...live.filter((event) => !seen.has(event.id)),
  ];

  async function act(label: string, run: () => Promise<void>) {
    setBusy(label);
    setFailure(null);
    try {
      await run();
    } catch (error) {
      setFailure(describe(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href={`/applications/${recording.applicationId}`}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        ← Application
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Recording</h1>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            {recording.startUrl}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <StatusBadge status={recording.status} live={stream.status} />

          {isRecording ? (
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                act("stop", async () => {
                  await apiFetch(
                    `/recordings/${recordingId}/stop`,
                    recordingSchema,
                    { method: "POST" },
                  );
                  resource.reload();
                })
              }
            >
              {busy === "stop" ? "Stopping…" : "Stop recording"}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy !== null || events.length === 0}
              onClick={() =>
                act("compile", async () => {
                  const spec = await apiFetch(
                    `/recordings/${recordingId}/compile`,
                    testSpecWithCurrentVersionSchema,
                    { method: "POST" },
                  );
                  router.push(`/specs/${spec.id}`);
                })
              }
            >
              {busy === "compile"
                ? "Compiling…"
                : "Compile into a specification"}
            </Button>
          )}
        </div>
      </div>

      {failure ? <ErrorBanner message={failure} /> : null}
      {stream.error ? <ErrorBanner message={stream.error} /> : null}

      {isRecording ? (
        <p className="border-border text-muted-foreground rounded-md border border-dashed px-4 py-3 text-sm">
          A browser window is open. Click through the flow you want to test —
          actions appear here as you go.
        </p>
      ) : null}

      {events.length === 0 ? (
        <EmptyState
          title="Nothing captured yet"
          hint="Actions appear here the moment they happen in the recorded browser."
        />
      ) : (
        <ol className="space-y-2">
          {events.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              canDelete={!isRecording}
              onDelete={() =>
                act(`delete-${event.id}`, async () => {
                  await apiFetch(
                    `/recordings/${recordingId}/events/${event.id}`,
                    z.undefined(),
                    { method: "DELETE" },
                  );
                  resource.reload();
                })
              }
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function StatusBadge({ status, live }: { status: string; live: string }) {
  if (status === "RECORDING") {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <span className="size-2 animate-pulse rounded-full bg-red-500" />
        Recording{live === "open" ? " · live" : ""}
      </Badge>
    );
  }

  return <Badge variant="outline">{status}</Badge>;
}

/**
 * One captured action.
 *
 * Shows role and accessible name rather than a selector — that is the visible
 * evidence that the recorder captured intent, not a CSS path.
 */
function EventRow({
  event,
  canDelete,
  onDelete,
}: {
  event: RecordedEvent;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <li className="border-border bg-card flex gap-4 rounded-lg border p-3">
      {event.screenshotRef === null ? (
        <div className="bg-muted size-16 shrink-0 rounded" />
      ) : (
        <a
          href={evidenceUrl(event.screenshotRef)}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={evidenceUrl(event.screenshotRef)}
            alt={`Screen at step ${event.index}`}
            className="border-border size-16 rounded border object-cover object-top"
          />
        </a>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-mono text-xs">
            #{event.index}
          </span>
          <Badge variant="outline" className="text-xs">
            {event.type}
          </Badge>
          {event.isSecret ? (
            <Badge variant="secondary" className="text-xs">
              secret — value not stored
            </Badge>
          ) : null}
        </div>

        <p className="mt-1 truncate text-sm">
          {event.targetRole !== null ? (
            <span className="text-muted-foreground">{event.targetRole} </span>
          ) : null}
          <span className="font-medium">
            {event.targetName ?? event.targetText ?? event.url}
          </span>
          {event.value !== null && event.value !== "" ? (
            <span className="text-muted-foreground"> = {event.value}</span>
          ) : null}
        </p>

        {event.landmark !== null ? (
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            in {event.landmark}
          </p>
        ) : null}
      </div>

      {canDelete ? (
        <Button variant="ghost" size="sm" onClick={onDelete}>
          Remove
        </Button>
      ) : null}
    </li>
  );
}
