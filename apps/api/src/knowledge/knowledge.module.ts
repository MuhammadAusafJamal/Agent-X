import { Global, Module } from '@nestjs/common';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { ConsolidationService } from './consolidation.service';

/**
 * Global — the runner reads it at rung 1, the healer reads it for context, and
 * from Phase 7 the consolidation pass is the only thing that writes to it.
 */
@Global()
@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService, ConsolidationService],
  exports: [KnowledgeService, ConsolidationService],
})
export class KnowledgeModule {}
