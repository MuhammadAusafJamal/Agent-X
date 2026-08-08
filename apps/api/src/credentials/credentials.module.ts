import { Global, Module } from '@nestjs/common';
import { CredentialsService } from './credentials.service';

/** Global — the runner, the recorder, and the catalog all resolve credentials. */
@Global()
@Module({
  providers: [CredentialsService],
  exports: [CredentialsService],
})
export class CredentialsModule {}
