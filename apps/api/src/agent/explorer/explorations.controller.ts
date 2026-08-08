import { Body, Controller, Post } from '@nestjs/common';
import {
  startExplorationSchema,
  type ExplorationResult,
  type StartExplorationInput,
} from '@agentx/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ExplorerService } from './explorer.service';

@Controller('explorations')
export class ExplorationsController {
  constructor(private readonly explorer: ExplorerService) {}

  /**
   * Runs an exploration and returns what it found.
   *
   * Synchronous, unlike an execution, because it is bounded by a wall clock the
   * caller chose — the request cannot outlive `maxDurationSeconds`. A run has no
   * such ceiling, which is why that one is queued and streamed instead.
   */
  @Post()
  explore(
    @Body(new ZodValidationPipe(startExplorationSchema))
    body: StartExplorationInput,
  ): Promise<ExplorationResult> {
    return this.explorer.explore(body);
  }
}
