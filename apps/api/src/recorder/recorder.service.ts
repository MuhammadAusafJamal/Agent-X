import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EMPTY, Subject, type Observable } from 'rxjs';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import {
  capturedEventSchema,
  stringifyJson,
  selectorCandidateSchema,
  bboxSchema,
  type CapturedEvent,
  type RecordingSseEvent,
} from '@agentx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TypedConfigService } from '../config/typed-config.service';
import { EvidenceService } from '../evidence/evidence.service';
import { NotFoundError, ConflictError } from '../common/errors';
import { toRecordedEvent } from './recorder.mapper';
import { captureBundle } from './capture-bundle';

interface Session {
  recordingId: string;
  browser: Browser;
  context: BrowserContext;
  events$: Subject<RecordingSseEvent>;
  /** Serializes enrichment so screenshots cannot interleave and reorder events. */
  queue: Promise<void>;
  nextIndex: number;
  stopping: boolean;
}

/**
 * Drives a headed Chromium and turns what the human does in it into
 * `RecordedEvent` rows.
 *
 * The browser belongs to the API, not to the browser tab that started the
 * recording — the dashboard can be reloaded or closed mid-session and the
 * recording carries on.
 */
@Injectable()
export class RecorderService implements OnModuleDestroy {
  private readonly logger = new Logger(RecorderService.name);
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TypedConfigService,
    private readonly evidence: EvidenceService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    // Never leave a headed Chromium behind when the API goes down.
    await Promise.all(
      [...this.sessions.keys()].map((id) =>
        this.stop(id).catch(() => undefined),
      ),
    );
  }

  /**
   * The live event stream, or an already-complete one when the recording has
   * finished. The dashboard then falls back to the stored timeline, so opening
   * a recording after the fact still shows everything.
   */
  streamOrEmpty(recordingId: string): Observable<RecordingSseEvent> {
    return this.sessions.get(recordingId)?.events$ ?? EMPTY;
  }

  isLive(recordingId: string): boolean {
    return this.sessions.has(recordingId);
  }

  async start(input: {
    applicationId: string;
    environmentId?: string | null;
    startUrl: string;
  }): Promise<string> {
    const application = await this.prisma.application.findUnique({
      where: { id: input.applicationId },
      select: { id: true },
    });

    if (application === null) {
      throw new NotFoundError('Application', input.applicationId);
    }

    const recording = await this.prisma.recording.create({
      data: {
        applicationId: input.applicationId,
        environmentId: input.environmentId ?? null,
        startUrl: input.startUrl,
        status: 'RECORDING',
      },
    });

    try {
      await this.launch(recording.id, input.startUrl);
    } catch (error) {
      await this.prisma.recording.update({
        where: { id: recording.id },
        data: {
          status: 'FAILED',
          stoppedAt: new Date(),
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }

    return recording.id;
  }

  private async launch(recordingId: string, startUrl: string): Promise<void> {
    const browser = await chromium.launch({
      headless: this.config.get('PLAYWRIGHT_HEADLESS'),
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });

    const session: Session = {
      recordingId,
      browser,
      context,
      events$: new Subject<RecordingSseEvent>(),
      queue: Promise.resolve(),
      nextIndex: 0,
      stopping: false,
    };

    this.sessions.set(recordingId, session);

    // The binding and the init script are registered on the context, so they
    // apply to every page and every navigation, including popups.
    await context.exposeBinding('__agentx_emit', (source, payload: unknown) => {
      this.enqueue(session, () =>
        this.handleCapturedEvent(session, payload, source.page),
      );
    });

    await context.addInitScript(captureBundle);

    const page = await context.newPage();

    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame() || session.stopping) return;

      this.enqueue(session, () =>
        this.handleCapturedEvent(
          session,
          {
            type: 'NAVIGATE',
            url: frame.url(),
            timestamp: Date.now(),
            selectorCandidates: [],
            isSecret: false,
          },
          page,
        ),
      );
    });

    // The human closing the window is a legitimate way to end a recording.
    context.on('close', () => {
      if (!session.stopping) {
        void this.stop(recordingId).catch((error: unknown) => {
          this.logger.error(
            `Failed to finalize recording ${recordingId} after the browser closed`,
            error as Error,
          );
        });
      }
    });

    await page.goto(startUrl, { waitUntil: 'domcontentloaded' });

    session.events$.next({
      type: 'recording.started',
      recordingId,
      startUrl,
    });
  }

  private enqueue(session: Session, task: () => Promise<void>): void {
    session.queue = session.queue
      .then(task)
      .catch((error: unknown) =>
        this.logger.error(
          `Recording ${session.recordingId}: failed to record an event`,
          error as Error,
        ),
      );
  }

  /**
   * Enriches one captured action with a snapshot of what the page looked like,
   * persists it, and pushes it to any live listener.
   */
  private async handleCapturedEvent(
    session: Session,
    raw: unknown,
    page: Page,
  ): Promise<void> {
    if (session.stopping) return;

    // The capture script runs inside the page under test, so its output is
    // parsed, not trusted.
    const parsed = capturedEventSchema.safeParse(raw);

    if (!parsed.success) {
      this.logger.warn(
        `Recording ${session.recordingId}: discarded a malformed captured event`,
      );
      return;
    }

    const event: CapturedEvent = parsed.data;
    const index = session.nextIndex++;
    const dir = this.evidence.recordingDir(session.recordingId);

    const { screenshotRef, a11yRef } = await this.captureContext(
      page,
      dir,
      index,
    );

    const row = await this.prisma.recordedEvent.create({
      data: {
        recordingId: session.recordingId,
        index,
        type: event.type,
        url: event.url,
        timestamp: new Date(event.timestamp),
        // A password's value never reaches the database; the flag that it was
        // one does, so the compiler can emit a credential reference.
        value: event.isSecret ? null : (event.value ?? null),
        isSecret: event.isSecret,
        targetRole: event.targetRole ?? null,
        targetName: event.targetName ?? null,
        targetText: event.targetText ?? null,
        targetTestId: event.targetTestId ?? null,
        landmark: event.landmark ?? null,
        bbox:
          event.bbox === undefined
            ? null
            : stringifyJson(bboxSchema, event.bbox, 'RecordedEvent.bbox'),
        selectorCandidates: stringifyJson(
          selectorCandidateSchema.array(),
          event.selectorCandidates,
          'RecordedEvent.selectorCandidates',
        ),
        screenshotRef,
        a11yRef,
      },
    });

    if (screenshotRef !== null) {
      await this.prisma.artifact.create({
        data: {
          recordingId: session.recordingId,
          kind: 'SCREENSHOT',
          relPath: screenshotRef,
          bytes: await this.evidence.size(screenshotRef),
        },
      });
    }

    session.events$.next({
      type: 'recording.event',
      event: toRecordedEvent(row),
    });
  }

  /**
   * A screenshot and an ARIA snapshot for the moment of the action.
   *
   * Best-effort by design: a page that navigated out from under us should cost
   * the event its screenshot, not lose the event.
   */
  private async captureContext(
    page: Page,
    dir: string,
    index: number,
  ): Promise<{ screenshotRef: string | null; a11yRef: string | null }> {
    let screenshotRef: string | null = null;
    let a11yRef: string | null = null;

    // A NAVIGATE fires while the navigation is still in flight, so without this
    // the first event of every recording captures a blank page — or times out
    // and captures nothing at all.
    await page
      .waitForLoadState('domcontentloaded', { timeout: 5000 })
      .catch(() => undefined);

    try {
      const shot = await page.screenshot({
        type: 'jpeg',
        quality: 60,
        timeout: 10_000,
      });
      screenshotRef = await this.evidence.write(
        `${dir}/event-${index}.jpg`,
        shot,
      );
    } catch {
      this.logger.debug(`No screenshot for event ${index}`);
    }

    try {
      // The ARIA snapshot is already pruned to the accessibility tree, which is
      // both smaller and better signal for the compiler than raw DOM.
      const snapshot = await page
        .locator('body')
        .ariaSnapshot({ timeout: 10_000 });
      a11yRef = await this.evidence.write(
        `${dir}/event-${index}.yaml`,
        snapshot,
      );
    } catch {
      this.logger.debug(`No ARIA snapshot for event ${index}`);
    }

    return { screenshotRef, a11yRef };
  }

  /** Idempotent: stopping an already-stopped recording is not an error. */
  async stop(recordingId: string): Promise<void> {
    const session = this.sessions.get(recordingId);

    if (session === undefined) {
      const recording = await this.prisma.recording.findUnique({
        where: { id: recordingId },
        select: { id: true },
      });

      if (recording === null) {
        throw new NotFoundError('Recording', recordingId);
      }

      return;
    }

    session.stopping = true;
    this.sessions.delete(recordingId);

    // Let queued enrichment finish so the last click is not lost.
    await session.queue.catch(() => undefined);

    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);

    const eventCount = await this.prisma.recordedEvent.count({
      where: { recordingId },
    });

    await this.prisma.recording.update({
      where: { id: recordingId },
      data: { status: 'STOPPED', stoppedAt: new Date() },
    });

    session.events$.next({
      type: 'recording.stopped',
      recordingId,
      eventCount,
    });
    session.events$.complete();

    this.logger.log(
      `Recording ${recordingId} stopped with ${eventCount} events`,
    );
  }

  /** Guards operations that only make sense on a recording that has finished. */
  assertNotLive(recordingId: string): void {
    if (this.sessions.has(recordingId)) {
      throw new ConflictError(
        `Recording ${recordingId} is still running — stop it first`,
      );
    }
  }
}
