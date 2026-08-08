"use client";

import type { Expectation } from "@agentx/shared";
import { Input } from "@/components/ui/input";

const KINDS = [
  "URL",
  "VISIBLE",
  "NOT_VISIBLE",
  "TEXT",
  "NETWORK_OK",
  "NO_CONSOLE_ERRORS",
  "SEMANTIC",
] as const;

/**
 * Edits a step's expectation.
 *
 * The kinds are ordered deterministic-first, and SEMANTIC is labelled with its
 * cost: it is the only one that spends a model call on every single run, so
 * choosing it should be a deliberate act rather than the path of least
 * resistance.
 */
export function ExpectationEditor({
  value,
  onChange,
}: {
  value: Expectation;
  onChange: (next: Expectation) => void;
}) {
  function changeKind(kind: (typeof KINDS)[number]) {
    onChange(defaultFor(kind));
  }

  return (
    <div className="space-y-2">
      <select
        value={value.kind}
        onChange={(e) => changeKind(e.target.value as (typeof KINDS)[number])}
        className="border-input bg-background h-8 w-full rounded-md border px-2 text-xs"
      >
        {KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {kind === "SEMANTIC" ? "SEMANTIC (costs a model call)" : kind}
          </option>
        ))}
      </select>

      {value.kind === "URL" ? (
        <div className="flex gap-2">
          <select
            value={value.match}
            onChange={(e) =>
              onChange({
                ...value,
                match: e.target.value as "exact" | "prefix" | "pattern",
              })
            }
            className="border-input bg-background h-8 rounded-md border px-2 text-xs"
          >
            <option value="prefix">prefix</option>
            <option value="exact">exact</option>
            <option value="pattern">pattern</option>
          </select>
          <Input
            className="h-8 text-xs"
            value={value.value}
            onChange={(e) => onChange({ ...value, value: e.target.value })}
            placeholder="/dashboard"
          />
        </div>
      ) : null}

      {value.kind === "VISIBLE" ||
      value.kind === "NOT_VISIBLE" ||
      value.kind === "SEMANTIC" ? (
        <Input
          className="h-8 text-xs"
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          placeholder="what should be true"
        />
      ) : null}

      {value.kind === "TEXT" ? (
        <Input
          className="h-8 text-xs"
          value={value.value}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
          placeholder="text that should appear"
        />
      ) : null}
    </div>
  );
}

function defaultFor(kind: (typeof KINDS)[number]): Expectation {
  switch (kind) {
    case "URL":
      return { kind: "URL", match: "prefix", value: "" };
    case "VISIBLE":
      return { kind: "VISIBLE", description: "" };
    case "NOT_VISIBLE":
      return { kind: "NOT_VISIBLE", description: "" };
    case "TEXT":
      return { kind: "TEXT", value: "" };
    case "NETWORK_OK":
      return { kind: "NETWORK_OK", maxStatus: 399 };
    case "NO_CONSOLE_ERRORS":
      return { kind: "NO_CONSOLE_ERRORS", allowlist: [] };
    case "SEMANTIC":
      return { kind: "SEMANTIC", description: "" };
  }
}
