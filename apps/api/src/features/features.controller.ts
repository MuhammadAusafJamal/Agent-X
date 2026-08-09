import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  runFeatureSchema,
  type Feature,
  type FeatureRunResult,
  type RunFeatureInput,
} from '@agentx/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { FeaturesService } from './features.service';

@Controller('features')
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  @Get()
  list(@Query('applicationId') applicationId?: string): Promise<Feature[]> {
    return this.features.list(applicationId);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<Feature> {
    return this.features.get(id);
  }

  /** The generated suite for this feature. */
  @Get(':id/specs')
  specs(@Param('id') id: string) {
    return this.features.specs(id);
  }

  /**
   * Regression or smoke, against whichever environment is asked for.
   *
   * `ALL` runs the suite; `CRITICAL` runs the smoke subset. Cross-environment is
   * the same call with a different `environmentId` — there is no separate
   * concept because there does not need to be one.
   */
  @Post(':id/runs')
  run(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(runFeatureSchema)) body: RunFeatureInput,
  ): Promise<FeatureRunResult> {
    return this.features.run(id, body);
  }
}
