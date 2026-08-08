import { Redactor } from './redactor';

describe('Redactor', () => {
  it('replaces a secret wherever it appears', () => {
    const redactor = new Redactor(['hunter2']);

    expect(redactor.redact('password=hunter2&next=/')).toBe(
      'password=***&next=/',
    );
    expect(redactor.redact('hunter2 hunter2')).toBe('*** ***');
  });

  it('leaves text alone when there is nothing to redact', () => {
    expect(new Redactor([]).redact('nothing secret here')).toBe(
      'nothing secret here',
    );
  });

  it('ignores very short values', () => {
    // Redacting a two-character "secret" would scrub unrelated substrings out
    // of every DOM snapshot and make the evidence useless.
    const redactor = new Redactor(['ab', 'abcd']);

    expect(redactor.redact('ab abcd')).toBe('ab ***');
  });

  it('redacts the longest secret first when one contains another', () => {
    const redactor = new Redactor(['secretvalue', 'secretvalue-extended']);

    expect(redactor.redact('secretvalue-extended')).toBe('***');
  });

  it('walks nested structures, including keys', () => {
    const redactor = new Redactor(['hunter2']);

    expect(
      redactor.redactDeep({
        request: { body: 'password=hunter2', headers: ['auth: hunter2'] },
        hunter2: 'used as a key',
        count: 3,
        missing: null,
      }),
    ).toEqual({
      request: { body: 'password=***', headers: ['auth: ***'] },
      '***': 'used as a key',
      count: 3,
      missing: null,
    });
  });

  it('passes structures through untouched when it holds no secrets', () => {
    const value = { a: [1, 'two'], b: null };

    expect(new Redactor([undefined, null, '']).redactDeep(value)).toBe(value);
  });
});
