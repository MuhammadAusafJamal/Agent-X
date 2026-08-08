import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import {
  compiledSpecSchema,
  type CompiledStep,
  type DraftTestStep,
  type RecordedEvent,
  type StepData,
  type TargetHints,
  type TestSpecWithCurrentVersion,
} from '@agentx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { EvidenceService } from '../evidence/evidence.service';
import { RecorderService } from '../recorder/recorder.service';
import { RecordingsService } from '../recorder/recordings.service';
import { SpecsService } from '../specs/specs.service';
import { BadRequestError, NotFoundError } from '../common/errors';
import { COMPILE_RECORDING_PROMPT } from '../llm/prompts/compile-recording.prompt';
import { buildEventLog, formatSnapshots, selectSnapshots } from './event-log';

/**
 * Turns a recording into an intent specification.
 *
 * This is the step that makes the premise visible: a click log becomes
 * something a non-engineer can read. The model writes the prose and infers the
 * expectations; it never chooses how an element is found. Each compiled step
 * points back at the recorded event it came from, and the real captured
 * targeting data is attached here.
 */
@Injectable()
export class CompilerService {
  private readonly logger = new Logger(CompilerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly evidence: EvidenceService,
    private readonly recorder: RecorderService,
    private readonly recordings: RecordingsService,
    private readonly specs: SpecsService,
  ) {}

  async compile(recordingId: string): Promise<TestSpecWithCurrentVersion> {
    // Compiling a moving target would produce a spec for a session that is
    // still changing underneath it.
    this.recorder.assertNotLive(recordingId);

    const recording = await this.recordings.get(recordingId);

    if (recording.events.length === 0) {
      throw new BadRequestError(
        'This recording captured no events, so there is nothing to compile.',
      );
    }

    const application = await this.prisma.application.findUnique({
      where: { id: recording.applicationId },
    });

    if (application === null) {
      throw new NotFoundError('Application', recording.applicationId);
    }

    const compiled = await this.llm.structured({
      promptId: COMPILE_RECORDING_PROMPT.id,
      promptVersion: COMPILE_RECORDING_PROMPT.version,
      toolName: COMPILE_RECORDING_PROMPT.toolName,
      toolDescription: COMPILE_RECORDING_PROMPT.toolDescription,
      system: COMPILE_RECORDING_PROMPT.system,
      user: COMPILE_RECORDING_PROMPT.user({
        applicationName: application.name,
        applicationDescription: application.description,
        baseUrl: application.baseUrl,
        eventLog: buildEventLog(recording.events),
        snapshots: formatSnapshots(await this.loadSnapshots(recording.events)),
      }),
      schema: compiledSpecSchema,
      recordingId,
    });

    const byIndex = new Map(
      recording.events.map((event) => [event.index, event]),
    );

    const steps: DraftTestStep[] = compiled.steps.map((step) =>
      this.toDraftStep(step, byIndex),
    );

    const spec = await this.prisma.testSpec.create({
      data: {
        applicationId: recording.applicationId,
        name: compiled.name,
        description: compiled.description,
        source: 'RECORDED',
      },
    });

    await this.specs.createVersion(
      spec.id,
      { steps, note: 'compiled from recording' },
      { source: 'RECORDED', recordingId },
    );

    this.logger.log(
      `Compiled recording ${recordingId} into spec ${spec.id} with ${steps.length} steps`,
    );

    return this.specs.get(spec.id);
  }

  /**
   * Attaches the recorded targeting data to a compiled step.
   *
   * The hints come from what was actually captured, never from the model. A
   * step the model inferred rather than observed gets empty hints and has to be
   * resolved from its description alone — which is honest, and exactly what the
   * resolver ladder is for.
   */
  private toDraftStep(
    step: CompiledStep,
    byIndex: Map<number, RecordedEvent>,
  ): DraftTestStep {
    const source =
      step.sourceEventIndex === null
        ? undefined
        : byIndex.get(step.sourceEventIndex);

    return {
      intent: step.intent,
      action: step.action,
      targetDescription: step.targetDescription,
      targetHints: hintsFrom(source),
      data: toStepData(step),
      expectation: step.expectation,
      optional: step.optional,
    };
  }

  private async loadSnapshots(
    events: RecordedEvent[],
  ): Promise<{ url: string; content: string }[]> {
    const selected = selectSnapshots(events);
    const loaded: { url: string; content: string }[] = [];

    for (const { url, ref } of selected) {
      try {
        const content = await fs.readFile(this.evidence.resolve(ref), 'utf8');
        loaded.push({ url, content });
      } catch {
        // A missing snapshot costs context, not the compilation.
        this.logger.debug(`Snapshot ${ref} could not be read`);
      }
    }

    return loaded;
  }
}

function hintsFrom(event: RecordedEvent | undefined): TargetHints {
  if (event === undefined) {
    return { selectorCandidates: [] };
  }

  return {
    role: event.targetRole ?? undefined,
    name: event.targetName ?? undefined,
    testId: event.targetTestId ?? undefined,
    text: event.targetText ?? undefined,
    landmark: event.landmark ?? undefined,
    bbox: event.bbox ?? undefined,
    selectorCandidates: event.selectorCandidates,
  };
}

function toStepData(step: CompiledStep): StepData | null {
  switch (step.data.kind) {
    case 'NONE':
      return null;
    case 'LITERAL':
      return { kind: 'LITERAL', value: step.data.value };
    case 'ENV_REF':
      return { kind: 'ENV_REF', envVar: step.data.envVar };
  }
}
