import { Module } from '@nestjs/common';
import { ResolverModule } from '../resolver/resolver.module';
import { VerifierModule } from '../verifier/verifier.module';
import { ExecutionsController } from './executions.controller';
import { ExecutionsService } from './executions.service';
import { RunnerService } from '../runner/runner.service';

@Module({
  imports: [ResolverModule, VerifierModule],
  controllers: [ExecutionsController],
  providers: [ExecutionsService, RunnerService],
  exports: [ExecutionsService],
})
export class ExecutionsModule {}
