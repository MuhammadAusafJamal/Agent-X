import { Module } from '@nestjs/common';
import { AgentModule } from '../agent.module';
import { SpecsModule } from '../../specs/specs.module';
import { ExecutionsModule } from '../../executions/executions.module';
import { FeatureCheckController } from './feature-check.controller';
import { FeatureCheckService } from './feature-check.service';

/**
 * Criteria-driven testing, assembled from parts that already exist.
 *
 * Separate from `AgentModule` because it consumes both the explorer and the
 * execution path, and the runner behind that path already consumes the agent's
 * diagnoser — putting this in `AgentModule` would close that loop into a
 * circular import. A module for the thing that depends on both is the honest
 * shape.
 */
@Module({
  imports: [AgentModule, SpecsModule, ExecutionsModule],
  controllers: [FeatureCheckController],
  providers: [FeatureCheckService],
  exports: [FeatureCheckService],
})
export class FeatureCheckModule {}
