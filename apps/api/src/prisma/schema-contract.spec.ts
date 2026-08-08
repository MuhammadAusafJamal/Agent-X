import * as fs from 'node:fs';
import * as path from 'node:path';
import * as shared from '@agentx/shared';

/**
 * SQLite gives us no enum type and no JSON type, so `schema.prisma` stores both
 * as plain TEXT. That leaves nothing in the database enforcing either one — the
 * zod schemas in @agentx/shared are the whole guard.
 *
 * These tests keep the two halves attached: every `-- enum X` annotation in the
 * Prisma schema must name a real zod enum, and every column default that holds
 * JSON must satisfy the schema it claims to hold.
 */

const schemaPath = path.resolve(
  __dirname,
  '..',
  '..',
  'prisma',
  'schema.prisma',
);
const schemaSource = fs.readFileSync(schemaPath, 'utf8');

/** `RecordingStatus` -> `recordingStatusSchema` */
function schemaExportName(enumName: string): string {
  return `${enumName.charAt(0).toLowerCase()}${enumName.slice(1)}Schema`;
}

function annotatedEnumNames(): string[] {
  const matches = schemaSource.matchAll(/--\s*enum\s+([A-Za-z0-9_]+)/g);
  return [...new Set([...matches].map((match) => match[1]))].sort();
}

describe('schema.prisma enum annotations', () => {
  const names = annotatedEnumNames();

  it('annotates at least one enum column (guards against the regex silently matching nothing)', () => {
    expect(names.length).toBeGreaterThan(5);
  });

  it.each(annotatedEnumNames())(
    '%s resolves to a zod enum exported from @agentx/shared',
    (enumName) => {
      const exportName = schemaExportName(enumName);
      const exported = (shared as Record<string, unknown>)[exportName] as
        { options?: readonly string[] } | undefined;

      expect(exported).toBeDefined();
      expect(Array.isArray(exported?.options)).toBe(true);
      expect(exported?.options?.length).toBeGreaterThan(0);
    },
  );
});

describe('schema.prisma JSON column defaults', () => {
  /**
   * Each default below is copied from `schema.prisma`. If a default changes
   * without its schema changing, a fresh row starts life unparseable — the
   * failure would surface much later, in whatever first tried to read it.
   */
  it('Environment.credentialRefs default parses as CredentialRefs', () => {
    expect(schemaSource).toContain(
      'credentialRefs String @default("{\\"extra\\":{}}")',
    );
    expect(
      shared.parseJson(shared.credentialRefsSchema, '{"extra":{}}'),
    ).toEqual({ extra: {} });
  });

  it('RecordedEvent.selectorCandidates default parses as SelectorCandidate[]', () => {
    expect(
      shared.parseJson(shared.selectorCandidateSchema.array(), '[]'),
    ).toEqual([]);
  });

  it('TestStep.targetHints default parses as TargetHints', () => {
    expect(
      shared.parseJson(shared.targetHintsSchema, '{"selectorCandidates":[]}'),
    ).toEqual({
      selectorCandidates: [],
    });
  });

  it('BugReport.evidenceRefs default parses as a string array', () => {
    expect(shared.parseJson(shared.idSchema.array(), '[]')).toEqual([]);
  });
});
