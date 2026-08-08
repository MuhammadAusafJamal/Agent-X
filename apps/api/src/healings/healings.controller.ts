import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  listHealingsQuerySchema,
  reviewHealingSchema,
  reviewHealingsSchema,
  type HealingRecordWithContext,
  type ListHealingsQuery,
  type Paginated,
  type ReviewHealingInput,
  type ReviewHealingsInput,
} from '@agentx/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { HealingsService } from './healings.service';

@Controller('healings')
export class HealingsController {
  constructor(private readonly healings: HealingsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listHealingsQuerySchema))
    query: ListHealingsQuery,
  ): Promise<Paginated<HealingRecordWithContext>> {
    return this.healings.list(query);
  }

  /**
   * Several heals from one run, into one new version.
   *
   * Declared before `:id/review` so the literal path is not swallowed by the
   * parameterized one.
   */
  @Post('review')
  reviewMany(
    @Body(new ZodValidationPipe(reviewHealingsSchema))
    input: ReviewHealingsInput,
  ): Promise<{ appliedToVersionId: string | null; reviewed: number }> {
    return this.healings.review(input);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<HealingRecordWithContext> {
    return this.healings.get(id);
  }

  @Post(':id/review')
  review(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewHealingSchema))
    input: ReviewHealingInput,
  ): Promise<{ appliedToVersionId: string | null; reviewed: number }> {
    return this.healings.review({
      healingIds: [id],
      decision: input.decision,
      note: input.note,
    });
  }
}
