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
  createApplicationSchema,
  listApplicationsQuerySchema,
  updateApplicationSchema,
  type Application,
  type ApplicationWithEnvironments,
  type CreateApplicationInput,
  type ListApplicationsQuery,
  type Paginated,
  type UpdateApplicationInput,
} from '@agentx/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ApplicationsService } from './applications.service';

@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listApplicationsQuerySchema))
    query: ListApplicationsQuery,
  ): Promise<Paginated<Application>> {
    return this.applications.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ApplicationWithEnvironments> {
    return this.applications.get(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createApplicationSchema))
    body: CreateApplicationInput,
  ): Promise<Application> {
    return this.applications.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateApplicationSchema))
    body: UpdateApplicationInput,
  ): Promise<Application> {
    return this.applications.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.applications.remove(id);
  }
}
