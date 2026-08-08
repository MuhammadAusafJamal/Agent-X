import { Module } from '@nestjs/common';
import { ResolverModule } from '../resolver/resolver.module';
import { DiagnoserService } from './diagnoser/diagnoser.service';
import { HealerService } from './healer/healer.service';

/**
 * The intelligence that reacts to a verdict.
 *
 * Both services are reached only after a step has already failed, which is why
 * neither is wired into the resolver or the verifier: a run where everything
 * works never constructs a prompt here.
 */
@Module({
  imports: [ResolverModule],
  providers: [DiagnoserService, HealerService],
  exports: [DiagnoserService, HealerService],
})
export class AgentModule {}
