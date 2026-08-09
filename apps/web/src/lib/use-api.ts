"use client";

import { useEffect, useRef, useState } from "react";
import { ApiRequestError } from "./api";

/**
 * Loads a resource from the API, with the states a real screen needs: loading,
 * an error you can render, and a way to reload after a mutation.
 */

export type Resource<T> =
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "error"; error: string };

export interface ResourceOptions<T> {
  /**
   * Refetch every N milliseconds while `shouldPoll` says to.
   *
   * There is no push channel for a list — only a run's own page has an event
   * stream — so a queued run sat at PENDING on the runs list until somebody
   * reloaded by hand. Polling stops as soon as nothing is in flight, so an idle
   * dashboard makes no requests at all.
   */
  pollMs?: number;
  /** Given the current data, is there still something worth watching? */
  shouldPoll?: (data: T) => boolean;
}

export function useResource<T>(
  load: () => Promise<T>,
  /** Changing this refetches — pass whatever the request depends on. */
  key: string,
  options: ResourceOptions<T> = {},
): Resource<T> & { reload: () => void } {
  const [state, setState] = useState<Resource<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  // Reset during render rather than in an effect, so a key change never shows
  // the previous resource's data under the new heading.
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setState({ status: "loading" });
  }

  // Held in a ref so an inline `load` closure does not refetch every render.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;

    loadRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ status: "ok", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", error: describe(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [key, nonce]);

  const { pollMs, shouldPoll } = options;

  // Polling is driven off the *loaded* data, so a screen that has finished
  // settling stops asking. An errored resource stops too: retrying a failing
  // endpoint every three seconds turns one outage into a stream of them.
  //
  // `shouldPoll` is called during render rather than held in a ref because it
  // is a pure predicate over data we already have, and what the effect below
  // depends on is the boolean it produces — which is stable even though the
  // callback's identity is not.
  const active =
    pollMs !== undefined &&
    state.status === "ok" &&
    (shouldPoll?.(state.data) ?? true);

  useEffect(() => {
    if (!active || pollMs === undefined) return;

    const timer = setInterval(() => setNonce((n) => n + 1), pollMs);
    return () => clearInterval(timer);
  }, [active, pollMs]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}

export function describe(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.message;
  }

  return error instanceof Error ? error.message : "Something went wrong";
}

/** Field-level problems from a rejected request, keyed by field path. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiRequestError)) {
    return {};
  }

  return Object.fromEntries(
    error.issues.map((issue) => [issue.path, issue.message]),
  );
}
