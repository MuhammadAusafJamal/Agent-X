"use client";

import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import {
  applicationSchema,
  knowledgeItemSchema,
  paginated,
  type KnowledgeItem,
} from "@agentx/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui-bits";
import { apiFetch } from "@/lib/api";
import { describe, useResource } from "@/lib/use-api";

/** Matches CONFIDENCE_FLOOR on the server. */
const FLOOR = 0.3;

/**
 * What the agent believes about one application.
 *
 * Confidence is shown as it will actually be used — age decay already applied —
 * because an entry that reads 0.8 but is about to be ignored is worse than no
 * number at all.
 */
export function KnowledgeList({ applicationId }: { applicationId: string }) {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const application = useResource(
    () => apiFetch(`/applications/${applicationId}`, applicationSchema),
    applicationId,
  );

  const knowledge = useResource(
    () =>
      apiFetch(
        `/knowledge/${applicationId}`,
        paginated(knowledgeItemSchema),
      ),
    `${applicationId}-knowledge`,
  );

  function forget(item: KnowledgeItem) {
    setPending(item.id);
    setFailure(null);

    apiFetch(`/knowledge/items/${item.id}`, z.undefined(), {
      method: "DELETE",
    })
      .then(knowledge.reload)
      .catch((error: unknown) => setFailure(describe(error)))
      .finally(() => setPending(null));
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/knowledge"
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        ← Knowledge
      </Link>

      <div>
        <h1 className="font-heading text-2xl font-semibold">
          {application.status === "ok" ? application.data.name : "Knowledge"}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Learned each time a step resolved. A remembered selector is tried
          first on the next run, which is why the second run of a specification
          is faster and cheaper than the first.
        </p>
      </div>

      {failure ? <ErrorBanner message={failure} /> : null}
      {knowledge.status === "loading" ? <Loading what="knowledge" /> : null}
      {knowledge.status === "error" ? (
        <ErrorBanner message={knowledge.error} />
      ) : null}

      {knowledge.status === "ok" && knowledge.data.items.length === 0 ? (
        <EmptyState
          title="Nothing learned about this application yet"
          hint="Run one of its specifications — every step that resolves teaches the agent something."
        />
      ) : null}

      {knowledge.status === "ok" && knowledge.data.items.length > 0 ? (
        <ul className="space-y-2">
          {knowledge.data.items.map((item) => {
            const trusted = item.confidence >= FLOOR;

            return (
              <li
                key={item.id}
                className="border-border bg-card flex items-start gap-4 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {item.kind}
                    </Badge>
                    <Badge
                      variant={trusted ? "secondary" : "outline"}
                      className="text-xs"
                      title={
                        trusted
                          ? "Tried first on the next run"
                          : "Below the trust floor — it will be skipped rather than tried"
                      }
                    >
                      confidence {item.confidence.toFixed(2)}
                      {trusted ? "" : " · not trusted"}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {item.hitCount} hit{item.hitCount === 1 ? "" : "s"}
                      {item.missCount > 0 ? ` · ${item.missCount} missed` : ""}
                    </span>
                  </div>

                  <p className="mt-1 truncate text-sm font-medium">{item.key}</p>

                  {item.value.kind === "SELECTOR_MEMORY" ? (
                    <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">
                      {item.value.selector}
                    </p>
                  ) : null}

                  <p className="text-muted-foreground mt-1 text-xs">
                    last confirmed {new Date(item.lastSeenAt).toLocaleString()}
                  </p>
                </div>

                {/* A wrong learned fact has to be removable without reaching
                    for a database client. */}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending === item.id}
                  onClick={() => forget(item)}
                >
                  Forget
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
