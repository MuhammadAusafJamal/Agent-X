import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  listSpecsQuerySchema,
  saveVersionSchema,
  type ListSpecsQuery,
  type Paginated,
  type SaveVersionInput,
  type TestSpec,
  type TestSpecWithCurrentVersion,
  type TestVersion,
  type TestVersionWithSteps,
} from '@agentx/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SpecsService } from './specs.service';

@Controller('specs')
export class SpecsController {
  constructor(private readonly specs: SpecsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listSpecsQuerySchema)) query: ListSpecsQuery,
  ): Promise<Paginated<TestSpec>> {
    return this.specs.list(query);
  }

  /**
   * Declared before `:id`. Nest matches routes in declaration order, so with
   * `:id` first this would resolve as a spec whose id is "versions".
   */
  @Get('versions/:versionId')
  getVersion(
    @Param('versionId') versionId: string,
  ): Promise<TestVersionWithSteps> {
    return this.specs.getVersion(versionId);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<TestSpecWithCurrentVersion> {
    return this.specs.get(id);
  }

  @Get(':id/versions')
  listVersions(@Param('id') id: string): Promise<TestVersion[]> {
    return this.specs.listVersions(id);
  }

  /** Saving is always a new version; nothing edits a version in place. */
  @Post(':id/versions')
  createVersion(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(saveVersionSchema)) body: SaveVersionInput,
  ): Promise<TestVersionWithSteps> {
    return this.specs.createVersion(id, body);
  }
}
