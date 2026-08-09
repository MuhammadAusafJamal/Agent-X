"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import {
  applicationSchema,
  environmentSchema,
  featureCheckSchema,
  paginated,
  type CriterionStatus,
  type FeatureCheck,
} from "@agentx/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorBanner, Field, Loading } from "@/components/ui-bits";
import { apiFetch } from "@/lib/api";
import { describe, useResource } from "@/lib/use-api";
import { toast } from "@/lib/use-toast";

/**
 * Testing a feature against criteria a person wrote.
 *
 * Everywhere else in Agent X a test starts from a recording, which quietly makes
 * the application's own behaviour the definition of correct. Here the acceptance
 * criteria are the input, so the tool can be wrong about them — which is the
 * only way a check can tell you something you did not already know.
 */
export function FeatureChecksList() {
  const [composing, setComposing] = useState(false);

  const checks = useResource(
    () => apiFetch("/feature-checks", z.array(featureCheckSchema)),
    "feature-checks",
    {
      pollMs: 3000,
      shouldPoll: (rows) =>
        rows.some(
          (row) => row.status !== "COMPLETED" && row.status !== "FAILED",
        ),
    },
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Feature checks</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Name a feature, write what it must do, and the agent plans the cases,
            drives the app, and reports a verdict per criterion. The criteria are
            the oracle — a recording only ever tells you what changed.
          </p>
        </div>
        <Button onClick={() => setComposing((open) => !open)}>
          {composing ? "Cancel" : "New check"}
        </Button>
      </header>

      {composing ? (
        <NewCheckForm
          onStarted={() => {
            setComposing(false);
            checks.reload();
          }}
        />
      ) : null}

      {checks.status === "loading" ? <Loading what="checks" /> : null}
      {checks.status === "error" ? <ErrorBanner message={checks.error} /> : null}

      {checks.status === "ok" && checks.data.length === 0 && !composing ? (
        <EmptyState
          title="No feature checks yet"
          hint="A check needs a feature name and at least one acceptance criterion. Everything else it works out for itself."
          action={<Button onClick={() => setComposing(true)}>New check</Button>}
        />
      ) : null}

      {checks.status === "ok" && checks.data.length > 0 ? (
        <ul className="space-y-3">
          {checks.data.map((check) => (
            <li key={check.id}>
              <CheckCard check={check} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CheckCard({ check }: { check: FeatureCheck }) {
  const counts = tally(check);

  return (
    <Link
      href={`/features/${check.id}`}
      className="border-border hover:bg-muted/40 block rounded-lg border p-4 transition-colors"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{check.name}</span>
        <span className="text-muted-foreground text-xs uppercase tracking-wide">
          {check.status}
        </span>
      </div>

      <p className="text-muted-foreground mt-1 text-sm">
        {check.criteria.length} criteri
        {check.criteria.length === 1 ? "on" : "a"} · {check.cases.length} case
        {check.cases.length === 1 ? "" : "s"}
      </p>

      {check.verdicts.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            ["FAIL", "UNCERTAIN", "PASS", "UNCOVERED", "NOT_RUN"] as const
          ).map((status) =>
            counts[status] > 0 ? (
              <VerdictPill key={status} status={status} count={counts[status]} />
            ) : null,
          )}
        </div>
      ) : null}

      {check.error !== null ? (
        <p className="text-destructive mt-2 text-xs">{check.error}</p>
      ) : null}
    </Link>
  );
}

function VerdictPill({
  status,
  count,
}: {
  status: CriterionStatus;
  count: number;
}) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs ${verdictClass(status)}`}
    >
      {count} {status.toLowerCase().replace("_", " ")}
    </span>
  );
}

/**
 * The one thing worth colouring: whether a criterion was settled, and how.
 *
 * `UNCOVERED` is deliberately not green and not red. Nothing was checked, and
 * showing it as either would be a number that is not true.
 */
export function verdictClass(status: CriterionStatus): string {
  switch (status) {
    case "PASS":
      return "border-emerald-500/40 text-emerald-600 dark:text-emerald-400";
    case "FAIL":
      return "border-destructive/40 text-destructive";
    case "UNCERTAIN":
      return "border-amber-500/40 text-amber-600 dark:text-amber-400";
    case "UNCOVERED":
      return "border-purple-500/40 text-purple-600 dark:text-purple-400";
    case "NOT_RUN":
      return "border-border text-muted-foreground";
  }
}

function tally(check: FeatureCheck): Record<CriterionStatus, number> {
  const counts: Record<CriterionStatus, number> = {
    PASS: 0,
    FAIL: 0,
    UNCERTAIN: 0,
    UNCOVERED: 0,
    NOT_RUN: 0,
  };

  for (const verdict of check.verdicts) counts[verdict.status] += 1;

  return counts;
}

interface CriterionDraft {
  key: string;
  text: string;
}

function NewCheckForm({ onStarted }: { onStarted: () => void }) {
  const router = useRouter();

  const [applicationId, setApplicationId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState<CriterionDraft[]>([
    { key: "AC1", text: "" },
  ]);
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const applications = useResource(
    () => apiFetch("/applications", paginated(applicationSchema)),
    "applications",
  );

  const environments = useResource(
    () =>
      applicationId === ""
        ? Promise.resolve({ items: [], total: 0, limit: 0, offset: 0 })
        : apiFetch(
            `/environments?applicationId=${applicationId}`,
            paginated(environmentSchema),
          ),
    `environments:${applicationId}`,
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFailure(null);

    apiFetch("/feature-checks", featureCheckSchema, {
      method: "POST",
      body: {
        applicationId,
        environmentId,
        name,
        description,
        criteria: criteria
          .filter((one) => one.text.trim() !== "")
          .map((one) => ({ key: one.key.trim(), text: one.text.trim() })),
      },
    })
      .then((check) => {
        toast.success(
          "Check started",
          "Planning cases from the criteria. Watch it on the check's page.",
        );
        onStarted();
        router.push(`/features/${check.id}`);
      })
      .catch((error: unknown) => setFailure(describe(error)))
      .finally(() => setSubmitting(false));
  }

  const ready =
    applicationId !== "" &&
    environmentId !== "" &&
    name.trim() !== "" &&
    criteria.some((one) => one.text.trim() !== "");

  return (
    <form
      onSubmit={submit}
      className="border-border space-y-4 rounded-lg border p-4"
    >
      {failure !== null ? <ErrorBanner message={failure} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Application" htmlFor="application">
          <select
            id="application"
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
            value={applicationId}
            onChange={(event) => {
              setApplicationId(event.target.value);
              setEnvironmentId("");
            }}
          >
            <option value="">Choose an application…</option>
            {applications.status === "ok"
              ? applications.data.items.map((application) => (
                  <option key={application.id} value={application.id}>
                    {application.name}
                  </option>
                ))
              : null}
          </select>
        </Field>

        <Field
          label="Environment"
          htmlFor="environment"
          hint="The same check can be re-run against any other environment later."
        >
          <select
            id="environment"
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
            value={environmentId}
            disabled={applicationId === ""}
            onChange={(event) => setEnvironmentId(event.target.value)}
          >
            <option value="">Choose an environment…</option>
            {environments.status === "ok"
              ? environments.data.items.map((environment) => (
                  <option key={environment.id} value={environment.id}>
                    {environment.name} — {environment.baseUrl}
                  </option>
                ))
              : null}
          </select>
        </Field>
      </div>

      <Field label="Feature" htmlFor="name">
        <Input
          id="name"
          value={name}
          placeholder="Invoice creation"
          onChange={(event) => setName(event.target.value)}
        />
      </Field>

      <Field
        label="What it is"
        htmlFor="description"
        hint="Context for the planner: what the feature is for, how a user reaches it."
      >
        <Textarea
          id="description"
          rows={3}
          value={description}
          placeholder="A signed-in user creates an invoice from the dashboard by entering an amount."
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>

      <div className="space-y-2">
        <p className="text-sm font-medium">Acceptance criteria</p>
        <p className="text-muted-foreground text-xs">
          One statement per row, each checkable on its own. Be specific about
          values — “the total equals the amount entered” can fail; “it works”
          cannot.
        </p>

        {criteria.map((criterion, index) => (
          <div key={index} className="flex gap-2">
            <Input
              aria-label={`Criterion ${index + 1} key`}
              className="w-24 shrink-0"
              value={criterion.key}
              onChange={(event) =>
                setCriteria((rows) =>
                  rows.map((row, at) =>
                    at === index ? { ...row, key: event.target.value } : row,
                  ),
                )
              }
            />
            <Input
              aria-label={`Criterion ${index + 1}`}
              value={criterion.text}
              placeholder="the invoice total equals the amount entered"
              onChange={(event) =>
                setCriteria((rows) =>
                  rows.map((row, at) =>
                    at === index ? { ...row, text: event.target.value } : row,
                  ),
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              disabled={criteria.length === 1}
              onClick={() =>
                setCriteria((rows) => rows.filter((_, at) => at !== index))
              }
            >
              Remove
            </Button>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setCriteria((rows) => [
              ...rows,
              { key: `AC${rows.length + 1}`, text: "" },
            ])
          }
        >
          Add criterion
        </Button>
      </div>

      <Button type="submit" disabled={!ready || submitting}>
        {submitting ? "Starting…" : "Start check"}
      </Button>
    </form>
  );
}
