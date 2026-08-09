"use client";

import type { ExecutionStatus, StepStatus } from "@agentx/shared";
import { Badge } from "@/components/ui/badge";
import { Explained } from "@/components/vocab-badge";
import { label } from "@/lib/vocab";
import { cn } from "@/lib/utils";

/**
 * One badge for both run and step status.
 *
 * `UNCERTAIN` gets its own colour rather than being folded in with pass or fail:
 * it is a real outcome that needs a human, and hiding it inside either of the
 * other two would defeat the point of having three states.
 *
 * The colours live here; the words live in `lib/vocab.ts`, so this badge and the
 * report and the healing queue cannot end up calling the same status three
 * different things — which they did.
 */
const TONE: Record<string, string> = {
  PASSED: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  PASS: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  HEALED: "bg-sky-500/15 text-sky-500 border-sky-500/30",
  FAILED: "bg-destructive/15 text-destructive border-destructive/30",
  FAIL: "bg-destructive/15 text-destructive border-destructive/30",
  UNCERTAIN: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  ERROR: "bg-destructive/15 text-destructive border-destructive/30",
  RUNNING: "bg-sky-500/15 text-sky-500 border-sky-500/30",
  PENDING: "",
  CANCELLED: "",
  SKIPPED: "",
};

export function StatusBadge({
  status,
  kind = "executionStatus",
  className,
}: {
  status: ExecutionStatus | StepStatus;
  /**
   * Which vocabulary to read from. A step's `PASS` and a run's `PASSED` are
   * different outcomes and are allowed to read differently.
   */
  kind?: "executionStatus" | "stepStatus";
  className?: string;
}) {
  return (
    <Explained kind={kind} value={status}>
      <Badge variant="outline" className={cn(TONE[status], className)}>
        {label(kind, status)}
      </Badge>
    </Explained>
  );
}
