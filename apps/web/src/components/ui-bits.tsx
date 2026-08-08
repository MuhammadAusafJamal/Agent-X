import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/** Small shared pieces, so every catalog screen fails and empties the same way. */

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-4 py-3 text-sm">
      {message}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-border rounded-lg border border-dashed py-14 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
        {hint}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return <p className="text-muted-foreground text-sm">Loading {what}…</p>;
}

/**
 * A labelled input with its server-side error rendered against it, rather than
 * as a toast — a validation failure should point at the field that caused it.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
