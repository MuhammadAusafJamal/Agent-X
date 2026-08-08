import type { ExecutionStatus, StepStatus } from "@agentx/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * One badge for both run and step status.
 *
 * `UNCERTAIN` gets its own colour rather than being folded in with pass or fail:
 * it is a real outcome that needs a human, and hiding it inside either of the
 * other two would defeat the point of having three states.
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
  className,
}: {
  status: ExecutionStatus | StepStatus;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(TONE[status], className)}>
      {status}
    </Badge>
  );
}
