import { Module } from '@nestjs/common';
import { ResolverModule } from '../resolver/resolver.module';
import { VerifierService } from './verifier.service';

@Module({
  imports: [ResolverModule],
  providers: [VerifierService],
  exports: [VerifierService],
})
export class VerifierModule {}
