import { EnvValidationError, envSchema, validateEnv } from './env.schema';

const minimalEnv = { ANTHROPIC_API_KEY: 'sk-test' };

describe('validateEnv', () => {
  it('names the missing key rather than failing later at the first LLM call', () => {
    let thrown: EnvValidationError | undefined;

    try {
      validateEnv({});
    } catch (error) {
      thrown = error as EnvValidationError;
    }

    expect(thrown).toBeInstanceOf(EnvValidationError);
    expect(thrown?.issues.join('\n')).toContain('ANTHROPIC_API_KEY');
    expect(thrown?.message).toContain('.env.example');
  });

  it('applies defaults for everything optional', () => {
    const env = validateEnv(minimalEnv);

    expect(env.PORT).toBe(3001);
    expect(env.WEB_ORIGIN).toBe('http://localhost:3000');
    expect(env.ANTHROPIC_MODEL).toBe('claude-sonnet-5');
    expect(env.NODE_ENV).toBe('development');
  });

  it('defaults the recorder to a headed browser', () => {
    // The recorder is a human sitting in front of a real browser window;
    // defaulting to headless would make it capture nothing useful.
    expect(validateEnv(minimalEnv).PLAYWRIGHT_HEADLESS).toBe(false);
  });

  it('coerces PORT from its string form and rejects nonsense', () => {
    expect(validateEnv({ ...minimalEnv, PORT: '4000' }).PORT).toBe(4000);
    expect(() => validateEnv({ ...minimalEnv, PORT: 'http' })).toThrow(
      EnvValidationError,
    );
    expect(() => validateEnv({ ...minimalEnv, PORT: '70000' })).toThrow(
      EnvValidationError,
    );
  });

  it('rejects a WEB_ORIGIN that is not a URL, since it goes straight into CORS', () => {
    expect(() =>
      validateEnv({ ...minimalEnv, WEB_ORIGIN: 'localhost:3000' }),
    ).toThrow(EnvValidationError);
  });

  describe('PLAYWRIGHT_HEADLESS', () => {
    it.each([
      ['true', true],
      ['1', true],
      ['false', false],
      ['0', false],
    ])('reads %p as %p', (raw, expected) => {
      expect(
        validateEnv({ ...minimalEnv, PLAYWRIGHT_HEADLESS: raw })
          .PLAYWRIGHT_HEADLESS,
      ).toBe(expected);
    });

    it.each(['no', 'off', 'yes', ''])(
      'rejects %p instead of silently reading it as true',
      (raw) => {
        expect(() =>
          validateEnv({ ...minimalEnv, PLAYWRIGHT_HEADLESS: raw }),
        ).toThrow(EnvValidationError);
      },
    );
  });

  it('collects every problem at once rather than one per restart', () => {
    let thrown: EnvValidationError | undefined;

    try {
      validateEnv({ PORT: 'nope', WEB_ORIGIN: 'not-a-url' });
    } catch (error) {
      thrown = error as EnvValidationError;
    }

    expect(thrown?.issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe('envSchema', () => {
  it('requires ANTHROPIC_API_KEY with no default', () => {
    expect(envSchema.safeParse({}).success).toBe(false);
    expect(envSchema.safeParse(minimalEnv).success).toBe(true);
  });
});
