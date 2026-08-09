"use client";

import { useState } from "react";
import { z } from "zod";
import {
  knowledgeItemSchema,
  paginated,
  type KnowledgeItem,
} from "@agentx/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Term } from "@/components/vocab-badge";
import { Async } from "@/components/async";
import { CardListSkeleton } from "@/components/ui-bits";
import { apiFetch } from "@/lib/api";
import { describe, useResource } from "@/lib/use-api";
import { toast } from "@/lib/use-toast";
import { TRUST_FLOOR } from "@/lib/vocab";

/**
 * What the agent believes about one application.
 *
 * Confidence is shown as it will actually be used — age decay already applied —
 * because an entry that reads 0.8 but is about to be ignored is worse than no
 * number at all.
 *
 * A panel on the application rather than a route under a parallel `/knowledge`
 * tree: knowledge is scoped per application and means nothing without one.
 */
export function KnowledgePanel({ applicationId }: { applicationId: string }) {
  const [pending, setPending] = useState<string | null>(null);

  const knowledge = useResource(
    () => apiFetch(`/knowledge/${applicationId}`, paginated(knowledgeItemSchema)),
    `${applicationId}-knowledge`,
  );

  function forget(item: KnowledgeItem) {
    setPending(item.id);

    apiFetch(`/knowledge/items/${item.id}`, z.undefined(), {
      method: "DELETE",
    })
      .then(() => {
        toast.success("Forgotten", "The next run works it out from scratch.");
        knowledge.reload();
      })
      .catch((error: unknown) => toast.error(describe(error)))
      .finally(() => setPending(null));
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Learned each time a step resolved and then verified. A remembered
        selector is tried first on the next run, which is why the second run of
        a specification is faster and cheaper than the first.
      </p>

      <Async
        resource={knowledge}
        skeleton={<CardListSkeleton cards={2} />}
        isEmpty={(page) => page.items.length === 0}
        empty={{
          title: "Nothing learned about this application yet",
          hint: "Run one of its specifications — every step that resolves and then passes teaches the agent something.",
        }}
      >
        {(page) => (
          <ul className="space-y-2">
            {page.items.map((item) => {
              const trusted = item.confidence >= TRUST_FLOOR;

              return (
                <li
                  key={item.id}
                  className="border-border bg-card flex items-start gap-4 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Term
                        kind="knowledgeKind"
                        value={item.kind}
                        className="text-xs"
                      />
                      <Badge
                        variant={trusted ? "secondary" : "outline"}
                        className="text-xs"
                        title={
                          trusted
                            ? "Tried first on the next run"
                            : `Below the trust floor of ${TRUST_FLOOR} — skipped rather than tried`
                        }
                      >
                        confidence {item.confidence.toFixed(2)}
                        {trusted ? "" : " · not trusted"}
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        worked {item.hitCount} time
                        {item.hitCount === 1 ? "" : "s"}
                        {item.missCount > 0
                          ? ` · missed ${item.missCount}`
                          : ""}
                      </span>
                    </div>

                    <p className="mt-1 truncate text-sm font-medium">
                      {item.key}
                    </p>

                    {item.value.kind === "SELECTOR_MEMORY" ? (
                      <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">
                        {item.value.selector}
                      </p>
                    ) : null}

                    <p className="text-muted-foreground mt-1 text-xs">
                      last confirmed{" "}
                      {new Date(item.lastSeenAt).toLocaleString()}
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
        )}
      </Async>
    </div>
  );
}
