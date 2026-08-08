import { Global, Module } from '@nestjs/common';
import {
  ConfigModule as NestConfigModule,
  ConfigService,
} from '@nestjs/config';
import { Env, validateEnv } from './env.schema';
import { TypedConfigService } from './typed-config.service';

/**
 * Global config.
 *
 * `forRoot({ validate })` runs at module-evaluation time, so importing this file
 * validates the environment as a side effect. `main.ts` therefore validates
 * explicitly first and only then loads the module graph — see the comment there.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: ['.env'],
    }),
  ],
  providers: [
    {
      provide: TypedConfigService,
      useFactory: (config: ConfigService<Env, true>) =>
        new TypedConfigService(config),
      inject: [ConfigService],
    },
  ],
  exports: [TypedConfigService],
})
export class AppConfigModule {}

export { TypedConfigService };
