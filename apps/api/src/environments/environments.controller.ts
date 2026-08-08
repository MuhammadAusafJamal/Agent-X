import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createEnvironmentSchema,
  listEnvironmentsQuerySchema,
  updateEnvironmentSchema,
  type CreateEnvironmentInput,
  type Environment,
  type EnvironmentCredentialStatus,
  type ListEnvironmentsQuery,
  type Paginated,
  type UpdateEnvironmentInput,
} from '@agentx/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { EnvironmentsService } from './environments.service';

@Controller('environments')
export class EnvironmentsController {
  constructor(private readonly environments: EnvironmentsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listEnvironmentsQuerySchema))
    query: ListEnvironmentsQuery,
  ): Promise<Paginated<Environment>> {
    return this.environments.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<Environment> {
    return this.environments.get(id);
  }

  /** Names and resolved/unresolved flags only — never a credential value. */
  @Get(':id/credentials')
  credentialStatus(
    @Param('id') id: string,
  ): Promise<EnvironmentCredentialStatus> {
    return this.environments.credentialStatus(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createEnvironmentSchema))
    body: CreateEnvironmentInput,
  ): Promise<Environment> {
    return this.environments.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateEnvironmentSchema))
    body: UpdateEnvironmentInput,
  ): Promise<Environment> {
    return this.environments.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.environments.remove(id);
  }
}
