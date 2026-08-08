import { Module } from '@nestjs/common';
import { ResolverModule } from '../resolver/resolver.module';
import { SpecsModule } from '../specs/specs.module';
import { DiagnoserService } from './diagnoser/diagnoser.service';
import { HealerService } from './healer/healer.service';
import { ExplorerService } from './explorer/explorer.service';
import { ExplorationsController } from './explorer/explorations.controller';

/**
 * The intelligence that acts on its own judgement.
 *
 * The diagnoser and healer are reached only after a step has already failed, so
 * a run where everything works never constructs a prompt here. The explorer is
 * the exception and the reason `bounds.ts` exists: it acts without a human
 * having scripted the moves.
 */
@Module({
  imports: [ResolverModule, SpecsModule],
  controllers: [ExplorationsController],
  providers: [DiagnoserService, HealerService, ExplorerService],
  exports: [DiagnoserService, HealerService, ExplorerService],
})
export class AgentModule {}
