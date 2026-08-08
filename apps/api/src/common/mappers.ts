/**
 * Prisma rows → wire shapes.
 *
 * The two differ on purpose. Prisma hands back `Date` objects and raw TEXT for
 * JSON columns; `@agentx/shared` describes what actually crosses the wire, where
 * a date is an ISO string and a JSON column is a parsed object. Converting in
 * one place gives the parsing and, later, the credential redaction a single home
 * rather than a rule everyone has to remember at every call site.
 */

export function toIso(date: Date): string {
  return date.toISOString();
}

export function toIsoOrNull(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}
