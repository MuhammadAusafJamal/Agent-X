import { Injectable } from '@nestjs/common';
import type { CredentialRefs, CredentialStatus } from '@agentx/shared';
import { AppException } from '../common/errors';
import { HttpStatus } from '@nestjs/common';
import { Redactor } from './redactor';

/** Secret values, resolved at execution time and never persisted. */
export interface ResolvedCredentials {
  username?: string;
  password?: string;
  extra: Record<string, string>;
  /** Pre-loaded with every resolved value, ready to scrub evidence and logs. */
  redactor: Redactor;
}

/**
 * Raised when a run needs a credential the environment does not provide.
 *
 * Names the variable and fails before the browser opens: a run that gets as far
 * as a login form and then types `undefined` wastes a headed browser session and
 * reports a confusing failure against the application under test.
 */
export class MissingCredentialError extends AppException {
  constructor(envVars: string[]) {
    super(
      HttpStatus.BAD_REQUEST,
      'BAD_REQUEST',
      `Environment variable${envVars.length > 1 ? 's' : ''} ${envVars.join(', ')} ${
        envVars.length > 1 ? 'are' : 'is'
      } not set, but this environment's credentials reference ${
        envVars.length > 1 ? 'them' : 'it'
      }. Set ${envVars.length > 1 ? 'them' : 'it'} in the process environment.`,
    );
  }
}

/**
 * Turns credential *references* into values, at the moment they are needed.
 *
 * `Environment.credentialRefs` stores environment variable names. The values
 * live only in the process environment, so they never reach SQLite, the evidence
 * directory, a report, or a prompt.
 */
@Injectable()
export class CredentialsService {
  /** What the UI may see: names and whether they currently resolve. Never values. */
  status(refs: CredentialRefs): CredentialStatus[] {
    return this.entries(refs).map(({ key, envVar }) => ({
      key,
      envVar,
      resolved: isSet(process.env[envVar]),
    }));
  }

  /** Resolves every reference, or throws naming all the missing variables at once. */
  resolve(refs: CredentialRefs): ResolvedCredentials {
    const entries = this.entries(refs);
    const missing = entries
      .filter(({ envVar }) => !isSet(process.env[envVar]))
      .map(({ envVar }) => envVar);

    if (missing.length > 0) {
      throw new MissingCredentialError(missing);
    }

    const extra = Object.fromEntries(
      entries
        .filter(({ key }) => key.startsWith('extra.'))
        .map(({ key, envVar }) => [
          key.slice('extra.'.length),
          process.env[envVar] as string,
        ]),
    );

    const username =
      refs.usernameEnv === undefined
        ? undefined
        : process.env[refs.usernameEnv];
    const password =
      refs.passwordEnv === undefined
        ? undefined
        : process.env[refs.passwordEnv];

    return {
      username,
      password,
      extra,
      redactor: new Redactor([username, password, ...Object.values(extra)]),
    };
  }

  /**
   * A redactor over whatever this environment's references currently resolve
   * to, without demanding that all of them do.
   *
   * `resolve` is the right call when a run is about to *use* the credentials —
   * it should fail loudly and early on a missing one. This is for the callers
   * that only need to scrub: they have no business failing because a variable
   * they were never going to type is unset, but they still must not leak the
   * ones that are. Building `new Redactor([])` instead is the trap — it has no
   * secrets to match, so `redact` returns its input unchanged and every writer
   * downstream looks like it is redacting when it is not.
   */
  redactorFor(refs: CredentialRefs): Redactor {
    return new Redactor(
      this.entries(refs).map(({ envVar }) => process.env[envVar]),
    );
  }

  private entries(refs: CredentialRefs): { key: string; envVar: string }[] {
    const entries: { key: string; envVar: string }[] = [];

    if (refs.usernameEnv !== undefined) {
      entries.push({ key: 'usernameEnv', envVar: refs.usernameEnv });
    }

    if (refs.passwordEnv !== undefined) {
      entries.push({ key: 'passwordEnv', envVar: refs.passwordEnv });
    }

    for (const [name, envVar] of Object.entries(refs.extra)) {
      entries.push({ key: `extra.${name}`, envVar });
    }

    return entries;
  }
}

function isSet(value: string | undefined): boolean {
  return value !== undefined && value.length > 0;
}
