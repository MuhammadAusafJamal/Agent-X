import { Injectable } from '@nestjs/common';
import type {
  ListRecordingsQuery,
  Paginated,
  Recording,
  RecordingWithEvents,
} from '@agentx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundError } from '../common/errors';
import { toRecordedEvent, toRecording } from './recorder.mapper';

/**
 * Reads and edits stored recordings.
 *
 * Deliberately separate from `RecorderService`, which owns live browsers: a
 * finished recording is just rows, and nothing here should be able to touch a
 * browser process.
 */
@Injectable()
export class RecordingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListRecordingsQuery): Promise<Paginated<Recording>> {
    const where =
      query.applicationId === undefined
        ? {}
        : { applicationId: query.applicationId };

    const [rows, total] = await Promise.all([
      this.prisma.recording.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: query.limit,
        skip: query.offset,
        include: { _count: { select: { events: true } } },
      }),
      this.prisma.recording.count({ where }),
    ]);

    return {
      items: rows.map(toRecording),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async get(id: string): Promise<RecordingWithEvents> {
    const row = await this.prisma.recording.findUnique({
      where: { id },
      include: {
        events: { orderBy: { index: 'asc' } },
        _count: { select: { events: true } },
      },
    });

    if (row === null) {
      throw new NotFoundError('Recording', id);
    }

    return {
      ...toRecording(row),
      events: row.events.map(toRecordedEvent),
    };
  }

  /**
   * Drops a captured event the noise filters missed.
   *
   * Indexes are left with a gap rather than renumbered: the index is the
   * event's identity in the compiled log, and renumbering would silently
   * invalidate anything already referring to it.
   */
  async deleteEvent(recordingId: string, eventId: string): Promise<void> {
    const event = await this.prisma.recordedEvent.findUnique({
      where: { id: eventId },
      select: { id: true, recordingId: true },
    });

    if (event === null || event.recordingId !== recordingId) {
      throw new NotFoundError('Recorded event', eventId);
    }

    await this.prisma.recordedEvent.delete({ where: { id: eventId } });
  }
}
