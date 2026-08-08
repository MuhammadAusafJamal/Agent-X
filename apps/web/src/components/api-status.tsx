"use client";

import { healthResponseSchema, type HealthResponse } from "@agentx/shared";
import { useEffect, useState } from "react";
import { API_BASE_URL, ApiRequestError, apiFetch } from "@/lib/api";

type State =
  | { kind: "loading" }
  | { kind: "ok"; health: HealthResponse }
  | { kind: "error"; message: string };

/**
 * Proves the dashboard is wired to a live API and a real database — the thing
 * Phase 0 exists to demonstrate.
 */
export function ApiStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    apiFetch("/health", healthResponseSchema)
      .then((health) => {
        if (!cancelled) setState({ kind: "ok", health });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            error instanceof ApiRequestError
              ? error.message
              : "Unexpected error contacting the API",
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="border-border bg-card rounded-lg border p-5">
      <div className="flex items-center gap-2">
        <Dot state={state} />
        <h2 className="font-heading text-sm font-semibold">API</h2>
      </div>

      <div className="text-muted-foreground mt-3 space-y-1 text-sm">
        {state.kind === "loading" && <p>Checking {API_BASE_URL}…</p>}

        {state.kind === "error" && (
          <p className="text-destructive">{state.message}</p>
        )}

        {state.kind === "ok" && (
          <>
            <Row label="Endpoint" value={API_BASE_URL} />
            <Row label="Version" value={state.health.version} />
            <Row
              label="Database"
              value={state.health.db ? "connected" : "unreachable"}
            />
            <Row label="Uptime" value={`${state.health.uptimeSeconds}s`} />
          </>
        )}
      </div>
    </div>
  );
}

function Dot({ state }: { state: State }) {
  const color =
    state.kind === "ok"
      ? state.health.db
        ? "bg-emerald-500"
        : "bg-amber-500"
      : state.kind === "error"
        ? "bg-destructive"
        : "bg-muted-foreground";

  return <span className={`size-2 rounded-full ${color}`} />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex justify-between gap-4">
      <span>{label}</span>
      <span className="text-foreground font-mono text-xs">{value}</span>
    </p>
  );
}
