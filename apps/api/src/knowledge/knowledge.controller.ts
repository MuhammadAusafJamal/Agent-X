import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Query,
} from '@nestjs/common';
import {
  paginationQuerySchema,
  type KnowledgeItem,
  type Paginated,
  type PaginationQuery,
} from '@agentx/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { KnowledgeService } from './knowledge.service';

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  /** Scoped to one application — knowledge never crosses between them. */
  @Get(':applicationId')
  list(
    @Param('applicationId') applicationId: string,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ): Promise<Paginated<KnowledgeItem>> {
    return this.knowledge.list(applicationId, query);
  }

  /** A wrong learned fact must be removable without a database client. */
  @Delete('items/:id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.knowledge.remove(id);
  }
}
