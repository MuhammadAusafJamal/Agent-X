import { z } from 'zod';
import { JsonColumnError, parseJson, parseJsonNullable, stringifyJson } from './json';
import { expectationSchema, targetHintsSchema } from './shapes';

describe('parseJson', () => {
  const schema = z.object({ a: z.number(), b: z.string() });

  it('returns the parsed value when the column is valid', () => {
    expect(parseJson(schema, '{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' });
  });

  it('names the column when the text is not JSON at all', () => {
    // The whole point of the helper: a bare SyntaxError from deep inside a run
    // tells you nothing about which row is bad.
    expect(() => parseJson(schema, 'not json', 'TestStep.targetHints#abc')).toThrow(
      /TestStep\.targetHints#abc: column does not contain valid JSON/,
    );
  });

  it('names the offending field when the JSON is valid but the shape is wrong', () => {
    expect(() => parseJson(schema, '{"a":"one","b":"x"}', 'TestStep.targetHints#abc')).toThrow(
      /TestStep\.targetHints#abc.*a:/s,
    );
  });

  it('throws JsonColumnError, not a raw SyntaxError or ZodError', () => {
    expect(() => parseJson(schema, '{')).toThrow(JsonColumnError);
    expect(() => parseJson(schema, '{"a":1}')).toThrow(JsonColumnError);
  });

  it('truncates a huge malformed column instead of dumping it into the message', () => {
    const huge = 'x'.repeat(5000);
    const error = captureError(() => parseJson(schema, huge));

    expect(error.message.length).toBeLessThan(200);
    expect(error.message).toContain('…');
  });

  it('applies schema defaults on the way out', () => {
    const hints = parseJson(targetHintsSchema, '{"role":"button"}');
    expect(hints.selectorCandidates).toEqual([]);
  });
});

describe('parseJsonNullable', () => {
  const schema = z.object({ a: z.number() });

  it.each([null, undefined, ''])('returns null for %p rather than throwing', (raw) => {
    expect(parseJsonNullable(schema, raw)).toBeNull();
  });

  it('still parses a present value', () => {
    expect(parseJsonNullable(schema, '{"a":1}')).toEqual({ a: 1 });
  });
});

describe('stringifyJson', () => {
  it('serializes a valid value', () => {
    expect(JSON.parse(stringifyJson(z.object({ a: z.number() }), { a: 1 }))).toEqual({ a: 1 });
  });

  it('refuses to store a value that does not match its schema', () => {
    // Validating on the way in means a malformed column can only ever originate
    // outside this codebase.
    expect(() => stringifyJson(expectationSchema, { kind: 'NOT_A_KIND' }, 'TestStep.expectation')).toThrow(
      /TestStep\.expectation: refusing to store/,
    );
  });

  it('round-trips a discriminated union', () => {
    const value = { kind: 'URL' as const, match: 'prefix' as const, value: '/dashboard' };
    expect(parseJson(expectationSchema, stringifyJson(expectationSchema, value))).toEqual(value);
  });
});

function captureError(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }

  throw new Error('expected the function to throw, but it did not');
}
