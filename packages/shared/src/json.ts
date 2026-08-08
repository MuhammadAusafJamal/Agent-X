import { z } from 'zod';

/**
 * Helpers for the JSON-in-TEXT columns.
 *
 * Prisma has no `Json` type on SQLite, so every structured field is a TEXT
 * column holding JSON. The tempting shape is:
 *
 *     const hints = JSON.parse(row.targetHints) as TargetHints
 *
 * which is a cast, not a parse: it asserts a shape nobody checked, and the
 * failure surfaces later as `undefined is not a function` somewhere unrelated.
 * `CONTRIBUTING.md` forbids exactly this. Everything reading or writing a JSON
 * column goes through the functions below instead.
 */

/**
 * Thrown when a JSON column cannot be read. Carries the column context so the
 * error names the row that is bad rather than just the shape that is missing —
 * a bare `SyntaxError: Unexpected token` from deep in a run is unactionable.
 */
export class JsonColumnError extends Error {
  constructor(
    message: string,
    readonly context: string,
    readonly cause?: unknown,
  ) {
    super(`${context}: ${message}`);
    this.name = 'JsonColumnError';
  }
}

/**
 * Parse a JSON column into a validated value.
 *
 * @param schema  the shape the column is expected to hold
 * @param raw     the raw TEXT value straight from the database
 * @param context where this came from, e.g. `TestStep.targetHints#abc123` —
 *                used verbatim in the error message
 */
export function parseJson<T extends z.ZodType>(
  schema: T,
  raw: string,
  context = 'json column',
): z.infer<T> {
  let decoded: unknown;

  try {
    decoded = JSON.parse(raw);
  } catch (cause) {
    throw new JsonColumnError(
      `column does not contain valid JSON (got ${truncate(raw)})`,
      context,
      cause,
    );
  }

  const result = schema.safeParse(decoded);

  if (!result.success) {
    throw new JsonColumnError(
      `JSON did not match the expected shape — ${formatIssues(result.error)}`,
      context,
      result.error,
    );
  }

  return result.data;
}

/**
 * Parse a nullable JSON column. Returns `null` for `null`/`undefined`/`''`
 * rather than throwing, so optional columns do not need a guard at every site.
 */
export function parseJsonNullable<T extends z.ZodType>(
  schema: T,
  raw: string | null | undefined,
  context = 'json column',
): z.infer<T> | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }

  return parseJson(schema, raw, context);
}

/**
 * Validate a value and serialize it for storage. Validating on the way *in*
 * means a malformed column can only originate outside this codebase.
 */
export function stringifyJson<T extends z.ZodType>(
  schema: T,
  value: unknown,
  context = 'json column',
): string {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new JsonColumnError(
      `refusing to store a value that does not match its schema — ${formatIssues(result.error)}`,
      context,
      result.error,
    );
  }

  return JSON.stringify(result.data);
}

/** Flatten zod issues into one readable line: `path: message; path: message`. */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function truncate(value: string, max = 80): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
