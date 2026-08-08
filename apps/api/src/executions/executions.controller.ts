import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import type { Response } from 'express';
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
  type Report,
  type StartExecutionInput,
} from '@agentx/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ReportsService } from '../reports/reports.service';
import { ExecutionsService } from './executions.service';

@Controller('executions')
export class ExecutionsController {
  constructor(
    private readonly executions: ExecutionsService,
    private readonly reports: ReportsService,
  ) {}

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

  /** The run written down. Generated on first request if the run predates it. */
  @Get(':id/report')
  report(@Param('id') id: string): Promise<Report> {
    return this.reports.get(id);
  }

  /**
   * The same report as a file.
   *
   * Served as an attachment so "export the report" is a link rather than a
   * copy-paste out of a browser.
   */
  @Get(':id/report/markdown')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async markdown(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const report = await this.reports.get(id);

    response.setHeader(
      'Content-Disposition',
      `attachment; filename="agentx-run-${id}.md"`,
    );

    return report.markdown;
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
