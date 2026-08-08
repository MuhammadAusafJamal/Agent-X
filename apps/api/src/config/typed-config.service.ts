import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/**
 * Typed access to validated config: `config.get('PORT')` returns a `number`,
 * not `string | undefined` plus a cast.
 *
 * Deliberately in its own file. `config.module.ts` calls `ConfigModule.forRoot()`
 * at module-evaluation time, so importing anything from that file runs env
 * validation as a side effect of the import — which is exactly what `main.ts`
 * needs to avoid in order to report a config error cleanly.
 */
export class TypedConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }
}
