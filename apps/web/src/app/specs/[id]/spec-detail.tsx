"use client";

import Link from "next/link";
import { useState } from "react";
import {
  saveVersionSchema,
  testSpecWithCurrentVersionSchema,
  testVersionSchema,
  testVersionWithStepsSchema,
  type DraftTestStep,
  type TestStep,
} from "@agentx/shared";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ExpectationEditor } from "@/components/specs/expectation-editor";
import { EmptyState, ErrorBanner, Loading } from "@/components/ui-bits";
import { apiFetch } from "@/lib/api";
import { describe, useResource } from "@/lib/use-api";

/**
 * The compiled specification, and its editor.
 *
 * Editing never mutates a version — saving writes version N+1 and leaves N
 * byte-identical. That is what makes an automated change (a heal, later)
 * reviewable and reversible.
 */
export function SpecDetail({ specId }: { specId: string }) {
  const [draft, setDraft] = useState<DraftTestStep[] | null>(null);
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const resource = useResource(
    () => apiFetch(`/specs/${specId}`, testSpecWithCurrentVersionSchema),
    specId,
  );

  const versions = useResource(
    () => apiFetch(`/specs/${specId}/versions`, z.array(testVersionSchema)),
    `${specId}-versions`,
  );

  if (resource.status === "loading") return <Loading what="specification" />;

  if (resource.status === "error") {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <ErrorBanner message={resource.error} />
        <Link href="/projects" className="text-sm underline">
          Back to projects
        </Link>
      </div>
    );
  }

  const spec = resource.data;
  const version = spec.currentVersion;
  const steps: DraftTestStep[] = draft ?? (version?.steps ?? []).map(toDraft);
  const editing = draft !== null;

  function update(index: number, patch: Partial<DraftTestStep>) {
    setDraft(
      steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    );
  }

  function move(index: number, by: number) {
    const next = [...steps];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setDraft(next);
  }

  async function save() {
    setFailure(null);

    const parsed = saveVersionSchema.safeParse({
      note: note.trim() === "" ? null : note,
      steps,
    });

    if (!parsed.success) {
      setFailure(parsed.error.issues[0]?.message ?? "The steps are not valid");
      return;
    }

    setSaving(true);

    try {
      await apiFetch(`/specs/${specId}/versions`, testVersionWithStepsSchema, {
        method: "POST",
        body: parsed.data,
      });
      setDraft(null);
      setNote("");
      resource.reload();
      versions.reload();
    } catch (error) {
      setFailure(describe(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href={`/applications/${spec.applicationId}`}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        ← Application
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{spec.name}</h1>
          {spec.description !== null ? (
            <p className="text-muted-foreground mt-1 text-sm">
              {spec.description}
            </p>
          ) : null}
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="outline">{spec.source}</Badge>
            {version !== null ? (
              <Badge variant="secondary">version {version.version}</Badge>
            ) : null}
          </div>
        </div>

        <div className="flex gap-2">
          {editing ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDraft(null)}
                disabled={saving}
              >
                Discard
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save as new version"}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDraft(steps)}
              disabled={steps.length === 0}
            >
              Edit
            </Button>
          )}
        </div>
      </div>

      {failure ? <ErrorBanner message={failure} /> : null}

      {editing ? (
        <div className="border-border bg-card space-y-2 rounded-lg border p-4">
          <p className="text-sm font-medium">Saving creates a new version</p>
          <p className="text-muted-foreground text-xs">
            Version {version?.version ?? 0} stays exactly as it is, so this
            change can always be reviewed or undone.
          </p>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What changed, and why (optional)"
            className="mt-2"
          />
        </div>
      ) : null}

      {steps.length === 0 ? (
        <EmptyState
          title="This specification has no steps"
          hint="Compile a recording to produce one."
        />
      ) : (
        <ol className="space-y-3">
          {steps.map((step, index) => (
            <StepCard
              key={index}
              step={step}
              index={index}
              editing={editing}
              onChange={(patch) => update(index, patch)}
              onMove={(by) => move(index, by)}
              onDelete={() => setDraft(steps.filter((_, i) => i !== index))}
            />
          ))}
        </ol>
      )}

      <section className="space-y-2">
        <h2 className="font-heading text-sm font-semibold">Version history</h2>
        {versions.status === "ok" ? (
          <ul className="border-border divide-border divide-y rounded-lg border text-sm">
            {versions.data.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between px-4 py-2"
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">v{entry.version}</span>
                  <Badge variant="outline" className="text-xs">
                    {entry.source}
                  </Badge>
                  <span className="text-muted-foreground">
                    {entry.note ?? "—"}
                  </span>
                </span>
                <span className="text-muted-foreground text-xs">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Loading what="versions" />
        )}
      </section>
    </div>
  );
}

function StepCard({
  step,
  index,
  editing,
  onChange,
  onMove,
  onDelete,
}: {
  step: DraftTestStep;
  index: number;
  editing: boolean;
  onChange: (patch: Partial<DraftTestStep>) => void;
  onMove: (by: number) => void;
  onDelete: () => void;
}) {
  const hints = step.targetHints;

  return (
    <li className="border-border bg-card rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <span className="text-muted-foreground w-6 shrink-0 font-mono text-xs leading-6">
          {index + 1}
        </span>

        <div className="min-w-0 flex-1 space-y-3">
          {editing ? (
            <Textarea
              value={step.intent}
              onChange={(e) => onChange({ intent: e.target.value })}
              rows={2}
              className="font-medium"
            />
          ) : (
            <p className="font-medium">{step.intent}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {step.action}
            </Badge>
            {step.optional ? (
              <Badge variant="secondary" className="text-xs">
                optional
              </Badge>
            ) : null}
            {step.data?.kind === "ENV_REF" ? (
              <Badge variant="secondary" className="font-mono text-xs">
                ${step.data.envVar}
              </Badge>
            ) : null}
            {step.data?.kind === "LITERAL" ? (
              <span className="text-muted-foreground text-xs">
                types “{step.data.value}”
              </span>
            ) : null}
          </div>

          {editing ? (
            <Input
              value={step.targetDescription ?? ""}
              onChange={(e) =>
                onChange({
                  targetDescription:
                    e.target.value === "" ? null : e.target.value,
                })
              }
              placeholder="how a person would point at the target"
              className="text-sm"
            />
          ) : step.targetDescription !== null ? (
            <p className="text-muted-foreground text-sm">
              targets {step.targetDescription}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground mb-1 text-xs font-medium">
                Expectation
              </p>
              {editing ? (
                <ExpectationEditor
                  value={step.expectation}
                  onChange={(expectation) => onChange({ expectation })}
                />
              ) : (
                <p className="text-sm">{summarize(step)}</p>
              )}
            </div>

            <div>
              <p className="text-muted-foreground mb-1 text-xs font-medium">
                Recorded hints (fallbacks)
              </p>
              <p className="text-muted-foreground font-mono text-xs">
                {[
                  hints.role === undefined ? null : `role=${hints.role}`,
                  hints.name === undefined ? null : `name="${hints.name}"`,
                  hints.testId === undefined ? null : `testid=${hints.testId}`,
                ]
                  .filter((part) => part !== null)
                  .join(" ") || "none — resolved from the description alone"}
              </p>
            </div>
          </div>
        </div>

        {editing ? (
          <div className="flex shrink-0 flex-col gap-1">
            <Button variant="ghost" size="sm" onClick={() => onMove(-1)}>
              ↑
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onMove(1)}>
              ↓
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete}>
              ✕
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function toDraft(step: TestStep): DraftTestStep {
  return {
    intent: step.intent,
    action: step.action,
    targetDescription: step.targetDescription,
    targetHints: step.targetHints,
    data: step.data,
    expectation: step.expectation,
    optional: step.optional,
  };
}

function summarize(step: DraftTestStep): string {
  const expectation = step.expectation;

  switch (expectation.kind) {
    case "URL":
      return `URL ${expectation.match} “${expectation.value}”`;
    case "VISIBLE":
      return `${expectation.description} is visible`;
    case "NOT_VISIBLE":
      return `${expectation.description} is gone`;
    case "TEXT":
      return `“${expectation.value}” appears`;
    case "NETWORK_OK":
      return `no request fails (above ${expectation.maxStatus})`;
    case "NO_CONSOLE_ERRORS":
      return "no console errors";
    case "SEMANTIC":
      return `${expectation.description} (checked by the model)`;
  }
}
