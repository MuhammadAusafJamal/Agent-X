import type { CredentialRefs } from '@agentx/shared';
import {
  CredentialsService,
  MissingCredentialError,
} from './credentials.service';

describe('CredentialsService', () => {
  const service = new CredentialsService();

  const refs: CredentialRefs = {
    usernameEnv: 'TEST_USER',
    passwordEnv: 'TEST_PASSWORD',
    extra: { totp: 'TEST_TOTP' },
  };

  beforeEach(() => {
    delete process.env['TEST_USER'];
    delete process.env['TEST_PASSWORD'];
    delete process.env['TEST_TOTP'];
  });

  describe('status', () => {
    it('reports names and resolution, never values', () => {
      process.env['TEST_USER'] = 'demo@example.com';

      const status = service.status(refs);

      expect(status).toEqual([
        { key: 'usernameEnv', envVar: 'TEST_USER', resolved: true },
        { key: 'passwordEnv', envVar: 'TEST_PASSWORD', resolved: false },
        { key: 'extra.totp', envVar: 'TEST_TOTP', resolved: false },
      ]);
      // The whole point: this response is rendered in a browser.
      expect(JSON.stringify(status)).not.toContain('demo@example.com');
    });

    it('treats an empty variable as unset', () => {
      process.env['TEST_USER'] = '';

      expect(service.status(refs)[0]?.resolved).toBe(false);
    });

    it('returns nothing for an environment that references no credentials', () => {
      expect(service.status({ extra: {} })).toEqual([]);
    });
  });

  describe('resolve', () => {
    it('names every missing variable at once', () => {
      process.env['TEST_USER'] = 'demo@example.com';

      let thrown: MissingCredentialError | undefined;

      try {
        service.resolve(refs);
      } catch (error) {
        thrown = error as MissingCredentialError;
      }

      expect(thrown).toBeInstanceOf(MissingCredentialError);
      expect(thrown?.message).toContain('TEST_PASSWORD');
      expect(thrown?.message).toContain('TEST_TOTP');
      expect(thrown?.message).not.toContain('TEST_USER');
    });

    it('resolves values and returns a redactor primed with them', () => {
      process.env['TEST_USER'] = 'demo@example.com';
      process.env['TEST_PASSWORD'] = 'hunter2xyz';
      process.env['TEST_TOTP'] = 'totpsecret';

      const resolved = service.resolve(refs);

      expect(resolved.username).toBe('demo@example.com');
      expect(resolved.password).toBe('hunter2xyz');
      expect(resolved.extra).toEqual({ totp: 'totpsecret' });

      // Anything written to evidence or a prompt goes through this first.
      expect(
        resolved.redactor.redact('login as demo@example.com / hunter2xyz'),
      ).toBe('login as *** / ***');
      expect(resolved.redactor.redact('otp totpsecret')).toBe('otp ***');
    });

    it('succeeds with an empty redactor when nothing is referenced', () => {
      expect(service.resolve({ extra: {} }).redactor.isEmpty).toBe(true);
    });
  });
});
