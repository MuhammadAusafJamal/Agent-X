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

export function useResource<T>(
  load: () => Promise<T>,
  /** Changing this refetches — pass whatever the request depends on. */
  key: string,
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
