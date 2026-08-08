"use client";

import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { API_BASE_URL } from "./api";

/**
 * Subscribes to one of the API's SSE streams — live recording events, live
 * execution steps.
 *
 * Frames are parsed through a schema from `@agentx/shared`, so a malformed or
 * changed payload becomes a visible error rather than a component rendering
 * half a step.
 */

export type StreamStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface UseEventStreamResult<TEvent> {
  events: TEvent[];
  latest: TEvent | null;
  status: StreamStatus;
  error: string | null;
}

export interface UseEventStreamOptions<TEvent> {
  /** Closes the stream when it returns true — a finished run has nothing more to send. */
  isTerminal?: (event: TEvent) => boolean;
}

/**
 * @param path   API path to stream, or `null` to stay idle (nothing to watch yet)
 * @param schema the event union this stream emits
 */
export function useEventStream<T extends z.ZodType>(
  path: string | null,
  schema: T,
  options: UseEventStreamOptions<z.infer<T>> = {},
): UseEventStreamResult<z.infer<T>> {
  type TEvent = z.infer<T>;

  const [events, setEvents] = useState<TEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus>(
    path === null ? "idle" : "connecting",
  );
  const [error, setError] = useState<string | null>(null);

  // Resetting during render, rather than in an effect, is React's documented
  // way to adjust state when a prop changes — an effect would render the
  // previous stream's events once before clearing them.
  const [lastPath, setLastPath] = useState(path);
  if (path !== lastPath) {
    setLastPath(path);
    setEvents([]);
    setError(null);
    setStatus(path === null ? "idle" : "connecting");
  }

  // Held in refs so changing the callback or schema identity does not tear down
  // a live connection. Assigned in an effect because writing a ref during
  // render is not allowed.
  const isTerminalRef = useRef(options.isTerminal);
  const schemaRef = useRef(schema);

  useEffect(() => {
    isTerminalRef.current = options.isTerminal;
    schemaRef.current = schema;
  });

  useEffect(() => {
    if (path === null) {
      return;
    }

    const source = new EventSource(`${API_BASE_URL}${path}`);
    let closed = false;

    const close = () => {
      if (!closed) {
        closed = true;
        source.close();
      }
    };

    source.onopen = () => setStatus("open");

    source.onmessage = (message: MessageEvent<string>) => {
      let payload: unknown;

      try {
        payload = JSON.parse(message.data);
      } catch {
        setError("Received a malformed event from the API");
        return;
      }

      const result = schemaRef.current.safeParse(payload);

      if (!result.success) {
        setError(
          `Unexpected event shape: ${result.error.issues
            .map(
              (issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`,
            )
            .join("; ")}`,
        );
        return;
      }

      const event = result.data as TEvent;
      setEvents((previous) => [...previous, event]);

      if (isTerminalRef.current?.(event)) {
        close();
        setStatus("closed");
      }
    };

    source.onerror = () => {
      // EventSource reconnects on its own; only a closed connection is final.
      if (source.readyState === EventSource.CLOSED) {
        setStatus("error");
        setError("Lost connection to the API");
        close();
      }
    };

    // Runs on unmount and whenever `path` changes — without this, navigating
    // away mid-run leaves the connection open and its state updates firing.
    return close;
  }, [path]);

  return {
    events,
    latest: events.length > 0 ? (events[events.length - 1] ?? null) : null,
    status,
    error,
  };
}
