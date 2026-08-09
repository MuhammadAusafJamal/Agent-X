import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import {
  startFeatureCheckSchema,
  type FeatureCheck,
  type StartFeatureCheckInput,
} from '@agentx/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { FeatureCheckService } from './feature-check.service';

@Controller('feature-checks')
export class FeatureCheckController {
  constructor(private readonly checks: FeatureCheckService) {}

  @Get()
  list(
    @Query('applicationId') applicationId?: string,
  ): Promise<FeatureCheck[]> {
    return this.checks.list(applicationId);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<FeatureCheck> {
    return this.checks.get(id);
  }

  /**
   * Queues a check and returns immediately.
   *
   * Unlike `POST /explorations`, which is bounded by a wall clock the caller
   * chose and so can be synchronous, a check plans, walks the application once
   * per case, and then queues a run for each — work that outlives an HTTP
   * request and must survive a reload.
   */
  @Post()
  start(
    @Body(new ZodValidationPipe(startFeatureCheckSchema))
    body: StartFeatureCheckInput,
  ): Promise<FeatureCheck> {
    return this.checks.start(body);
  }

  /** Live progress. A finished check yields a stream that completes at once. */
  @Sse(':id/events')
  events(@Param('id') id: string): Observable<MessageEvent> {
    return this.checks
      .streamOrEmpty(id)
      .pipe(map((event): MessageEvent => ({ data: event })));
  }
}
