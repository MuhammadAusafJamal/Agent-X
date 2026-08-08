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
  createProjectSchema,
  paginationQuerySchema,
  updateProjectSchema,
  type CreateProjectInput,
  type Paginated,
  type PaginationQuery,
  type Project,
  type ProjectWithApplications,
  type UpdateProjectInput,
} from '@agentx/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ): Promise<Paginated<Project>> {
    return this.projects.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ProjectWithApplications> {
    return this.projects.get(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createProjectSchema)) body: CreateProjectInput,
  ): Promise<Project> {
    return this.projects.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) body: UpdateProjectInput,
  ): Promise<Project> {
    return this.projects.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.projects.remove(id);
  }
}
