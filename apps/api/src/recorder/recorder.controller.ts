import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import {
  listRecordingsQuerySchema,
  startRecordingSchema,
  type ListRecordingsQuery,
  type Paginated,
  type Recording,
  type RecordingWithEvents,
  type StartRecordingInput,
} from '@agentx/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RecorderService } from './recorder.service';
import { RecordingsService } from './recordings.service';

@Controller('recordings')
export class RecorderController {
  constructor(
    private readonly recorder: RecorderService,
    private readonly recordings: RecordingsService,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listRecordingsQuerySchema))
    query: ListRecordingsQuery,
  ): Promise<Paginated<Recording>> {
    return this.recordings.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<RecordingWithEvents> {
    return this.recordings.get(id);
  }

  /** Opens a headed browser and starts capturing. */
  @Post()
  async start(
    @Body(new ZodValidationPipe(startRecordingSchema))
    body: StartRecordingInput,
  ): Promise<Recording> {
    const id = await this.recorder.start({
      applicationId: body.applicationId,
      environmentId: body.environmentId,
      startUrl: body.startUrl,
    });

    return this.recordings.get(id);
  }

  /**
   * Live events.
   *
   * A recording that has already stopped yields a stream that completes
   * immediately; the dashboard falls back to the stored timeline, so a page
   * loaded after the fact still shows everything.
   */
  @Sse(':id/events')
  events(@Param('id') id: string): Observable<MessageEvent> {
    return this.recorder
      .streamOrEmpty(id)
      .pipe(map((event): MessageEvent => ({ data: event })));
  }

  @Post(':id/stop')
  @HttpCode(200)
  async stop(@Param('id') id: string): Promise<Recording> {
    await this.recorder.stop(id);
    return this.recordings.get(id);
  }

  @Delete(':id/events/:eventId')
  @HttpCode(204)
  deleteEvent(
    @Param('id') id: string,
    @Param('eventId') eventId: string,
  ): Promise<void> {
    return this.recordings.deleteEvent(id, eventId);
  }
}
