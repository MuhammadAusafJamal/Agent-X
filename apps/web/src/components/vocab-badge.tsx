"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { explain, label, type VocabKind } from "@/lib/vocab";
import { cn } from "@/lib/utils";

/**
 * An enum value, rendered as a word with its meaning one hover away.
 *
 * The tooltip is the point. A badge reading "Test drift" is already better than
 * `TEST_DRIFT`, but it still does not tell a first-time user why that step was
 * repaired while the one below it filed a bug report instead.
 */
export function Term({
  kind,
  value,
  variant = "outline",
  className,
}: {
  kind: VocabKind;
  value: string | null | undefined;
  variant?: "outline" | "secondary" | "default" | "destructive" | "ghost";
  className?: string;
}) {
  if (value === null || value === undefined) return null;

  return (
    <Explained kind={kind} value={value}>
      <Badge variant={variant} className={className}>
        {label(kind, value)}
      </Badge>
    </Explained>
  );
}

/**
 * Wraps anything in the explanation for a term, when there is one.
 *
 * Split out so a coloured `StatusBadge` can keep its own styling and still gain
 * the tooltip, rather than having to become a `Term`.
 */
export function Explained({
  kind,
  value,
  children,
}: {
  kind: VocabKind;
  value: string | null | undefined;
  children: ReactNode;
}) {
  const detail = explain(kind, value);

  if (detail === null) return <>{children}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("cursor-help")}>{children}</span>
      </TooltipTrigger>
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
  );
}
