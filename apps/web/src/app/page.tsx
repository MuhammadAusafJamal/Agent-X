import { ApiStatus } from "@/components/api-status";

const PIPELINE = [
  { step: "Record", detail: "a human clicks through the app once" },
  { step: "Compile", detail: "the recording becomes intent, not selectors" },
  { step: "Replay", detail: "the agent resolves each target semantically" },
  { step: "Verify", detail: "deterministic first, the model only when unsure" },
  { step: "Diagnose", detail: "test drift heals; an app bug files a report" },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <h1 className="font-heading text-2xl font-semibold">Agent X</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Record a QA session once. Replay it by intent, verify what happened,
          and heal the steps that drift — without healing over a real bug.
        </p>
      </header>

      <ApiStatus />

      <section className="border-border bg-card rounded-lg border p-5">
        <h2 className="font-heading text-sm font-semibold">Pipeline</h2>
        <ol className="mt-4 space-y-3">
          {PIPELINE.map(({ step, detail }, index) => (
            <li key={step} className="flex gap-3 text-sm">
              <span className="text-muted-foreground w-4 shrink-0 font-mono text-xs leading-5">
                {index + 1}
              </span>
              <span className="w-24 shrink-0 font-medium">{step}</span>
              <span className="text-muted-foreground">{detail}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
