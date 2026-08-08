import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  listBugsQuerySchema,
  updateBugSchema,
  type BugReportWithContext,
  type ListBugsQuery,
  type Paginated,
  type UpdateBugInput,
} from '@agentx/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BugsService } from './bugs.service';

@Controller('bugs')
export class BugsController {
  constructor(private readonly bugs: BugsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listBugsQuerySchema)) query: ListBugsQuery,
  ): Promise<Paginated<BugReportWithContext>> {
    return this.bugs.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<BugReportWithContext> {
    return this.bugs.get(id);
  }

  /** Acknowledge or dismiss. Reports are never deleted — a dismissal is a decision. */
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBugSchema)) input: UpdateBugInput,
  ): Promise<BugReportWithContext> {
    return this.bugs.update(id, input);
  }
}
