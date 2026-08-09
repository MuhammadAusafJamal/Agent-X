"use client";

import type { ReactNode } from "react";
import type { Resource } from "@/lib/use-api";
import { EmptyState, ErrorState, Loading } from "./ui-bits";

/**
 * One place that decides what a screen shows while it is waiting, when it
 * failed, and when there is nothing there.
 *
 * This exists because those three states kept collapsing into each other. The
 * run dialog rendered "This application has no environments yet." whenever the
 * request *failed*, because it fell back to an empty array and then asked
 * whether the array was empty. The spec page rendered "Loading versions…"
 * forever for the same reason in reverse. Both are the same mistake: deriving
 * "empty" from data that a failed request never produced.
 *
 * Resolving in a fixed order — loading, then error, then empty, then content —
 * makes that mistake unavailable rather than merely fixed, because `isEmpty` is
 * only ever handed data that actually arrived.
 */
export function Async<T>({
  resource,
  skeleton,
  isEmpty,
  empty,
  children,
}: {
  resource: Resource<T> & { reload: () => void };
  /** What to show while loading. A plain line if omitted. */
  skeleton?: ReactNode;
  /** Given loaded data, is there nothing to show? Omit if the screen is never empty. */
  isEmpty?: (data: T) => boolean;
  empty?: { title: string; hint: string; action?: ReactNode };
  children: (data: T) => ReactNode;
}) {
  if (resource.status === "loading") {
    return <>{skeleton ?? <Loading what="this" />}</>;
  }

  if (resource.status === "error") {
    return <ErrorState message={resource.error} onRetry={resource.reload} />;
  }

  if (empty !== undefined && isEmpty?.(resource.data) === true) {
    return (
      <EmptyState
        title={empty.title}
        hint={empty.hint}
        action={empty.action}
      />
    );
  }

  return <>{children(resource.data)}</>;
}
