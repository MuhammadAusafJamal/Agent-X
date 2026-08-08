/**
 * Stands in for a route whose real UI lands in a later phase. Keeps the nav
 * honest — every link goes somewhere, and says what will be there.
 */
export function PhasePlaceholder({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-2xl py-16 text-center">
      <h1 className="font-heading text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground mt-3 text-sm">{description}</p>
      <p className="border-border text-muted-foreground mt-6 inline-block rounded-md border px-3 py-1 font-mono text-xs">
        arrives in {phase}
      </p>
    </div>
  );
}
