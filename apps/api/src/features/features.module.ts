import { Module } from '@nestjs/common';
import { ExecutionsModule } from '../executions/executions.module';
import { FeaturesController } from './features.controller';
import { FeaturesService } from './features.service';

/**
 * Grouping, and fanning a suite out over the ordinary execution path.
 *
 * Nothing here runs anything itself — it selects specs and hands them to
 * `ExecutionsService`, which is what keeps a regression run identical to a
 * single run a human started by hand.
 */
@Module({
  imports: [ExecutionsModule],
  controllers: [FeaturesController],
  providers: [FeaturesService],
  exports: [FeaturesService],
})
export class FeaturesModule {}
