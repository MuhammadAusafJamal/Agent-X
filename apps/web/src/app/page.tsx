import { ApiStatus } from "@/components/api-status";
import { StartHere } from "@/components/home/start-here";

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

      <StartHere />

      <ApiStatus />
    </div>
  );
}
