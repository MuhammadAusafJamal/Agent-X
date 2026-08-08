import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import {
  adjudicateStepSchema,
  listExecutionsQuerySchema,
  startExecutionSchema,
  type AdjudicateStepInput,
  type Execution,
  type ExecutionDetail,
  type ListExecutionsQuery,
  type Paginated,
  type StartExecutionInput,
} from '@agentx/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ExecutionsService } from './executions.service';

@Controller('executions')
export class ExecutionsController {
  constructor(private readonly executions: ExecutionsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listExecutionsQuerySchema))
    query: ListExecutionsQuery,
  ): Promise<Paginated<Execution>> {
    return this.executions.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ExecutionDetail> {
    return this.executions.get(id);
  }

  /** Queues a run and returns immediately; watch the stream for progress. */
  @Post()
  start(
    @Body(new ZodValidationPipe(startExecutionSchema))
    body: StartExecutionInput,
  ): Promise<Execution> {
    return this.executions.start(body);
  }

  /**
   * Live step events. A finished run yields a stream that completes at once and
   * the dashboard falls back to the stored timeline.
   */
  @Sse(':id/events')
  events(@Param('id') id: string): Observable<MessageEvent> {
    return this.executions
      .streamOrEmpty(id)
      .pipe(map((event): MessageEvent => ({ data: event })));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string): Promise<Execution> {
    return this.executions.cancel(id);
  }

  /** A human settles a step the verifier returned UNCERTAIN for. */
  @Patch(':id/steps/:stepId')
  adjudicate(
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body(new ZodValidationPipe(adjudicateStepSchema))
    body: AdjudicateStepInput,
  ): Promise<ExecutionDetail> {
    return this.executions.adjudicate(id, stepId, body);
  }
}
