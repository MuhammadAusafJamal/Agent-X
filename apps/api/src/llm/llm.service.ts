import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { formatIssues } from '@agentx/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TypedConfigService } from '../config/typed-config.service';
import { AppException } from '../common/errors';
import { HttpStatus } from '@nestjs/common';
import type { Redactor } from '../credentials/redactor';

export interface StructuredCallOptions<T extends z.ZodType> {
  /** Stable id from the prompt registry, recorded on every call. */
  promptId: string;
  promptVersion: number;
  system: string;
  user: string;
  schema: T;
  toolName: string;
  toolDescription: string;
  maxTokens?: number;
  executionId?: string | null;
  recordingId?: string | null;
  /** Strips resolved credential values before anything is sent. */
  redactor?: Redactor;
}

export class LlmError extends AppException {
  constructor(message: string) {
    super(HttpStatus.BAD_GATEWAY, 'INTERNAL', message);
  }
}

/**
 * The single path to the model.
 *
 * Every call is structured: a zod schema goes in, a validated value comes out.
 * The JSON Schema the model is given is generated from that same zod schema, so
 * the contract the model is asked to satisfy and the contract we enforce cannot
 * drift apart.
 *
 * One retry on a schema violation, with the validation error fed back — then a
 * hard error. Never a partial parse: a half-understood plan is worse than an
 * obvious failure.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    config: TypedConfigService,
  ) {
    this.client = new Anthropic({ apiKey: config.get('ANTHROPIC_API_KEY') });
    this.model = config.get('ANTHROPIC_MODEL');
  }

  async structured<T extends z.ZodType>(
    options: StructuredCallOptions<T>,
  ): Promise<z.infer<T>> {
    // `io: 'input'` matters: without it, fields with defaults are described as
    // required, and the model is asked for things it should be able to omit.
    const inputSchema = z.toJSONSchema(options.schema, { io: 'input' });

    const redact = (text: string): string =>
      options.redactor?.redact(text) ?? text;

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: redact(options.user) },
    ];

    let lastIssues = '';

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const startedAt = Date.now();
      let response: Anthropic.Message;

      try {
        response = await this.client.messages.create({
          model: this.model,
          max_tokens: options.maxTokens ?? 8000,
          system: redact(options.system),
          messages,
          tools: [
            {
              name: options.toolName,
              description: options.toolDescription,
              input_schema: inputSchema as Anthropic.Tool.InputSchema,
            },
          ],
          tool_choice: { type: 'tool', name: options.toolName },
        });
      } catch (error) {
        await this.record(options, {
          latencyMs: Date.now() - startedAt,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });

        throw new LlmError(
          `The model call failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const latencyMs = Date.now() - startedAt;
      const block = response.content.find((part) => part.type === 'tool_use');

      if (block === undefined || block.type !== 'tool_use') {
        await this.record(options, {
          latencyMs,
          ok: false,
          error: 'the model returned no tool call',
          usage: response.usage,
        });
        throw new LlmError('The model did not return a structured result');
      }

      const parsed = options.schema.safeParse(block.input);

      await this.record(options, {
        latencyMs,
        ok: parsed.success,
        error: parsed.success ? null : formatIssues(parsed.error),
        usage: response.usage,
      });

      if (parsed.success) {
        return parsed.data;
      }

      lastIssues = formatIssues(parsed.error);
      this.logger.warn(
        `${options.promptId} v${options.promptVersion}: attempt ${attempt} failed validation — ${lastIssues}`,
      );

      // Hand the model its own output and the exact complaint, once.
      messages.push(
        { role: 'assistant', content: [block] },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: block.id,
              is_error: true,
              content: `That result did not validate: ${lastIssues}. Call ${options.toolName} again with a corrected result.`,
            },
          ],
        },
      );
    }

    throw new LlmError(
      `The model could not produce a valid ${options.toolName} result after a retry: ${lastIssues}`,
    );
  }

  /** Audit row: which prompt version produced which decision, and what it cost. */
  private async record<T extends z.ZodType>(
    options: StructuredCallOptions<T>,
    result: {
      latencyMs: number;
      ok: boolean;
      error?: string | null;
      usage?: { input_tokens: number; output_tokens: number };
    },
  ): Promise<void> {
    try {
      await this.prisma.llmCall.create({
        data: {
          executionId: options.executionId ?? null,
          recordingId: options.recordingId ?? null,
          promptId: options.promptId,
          promptVersion: options.promptVersion,
          model: this.model,
          inputTokens: result.usage?.input_tokens ?? 0,
          outputTokens: result.usage?.output_tokens ?? 0,
          latencyMs: result.latencyMs,
          // Cost is left null rather than guessed from a hardcoded price table
          // that would silently go stale.
          costUsd: null,
          ok: result.ok,
          error: result.error ?? null,
        },
      });
    } catch (error) {
      this.logger.error('Failed to record an LLM call', error as Error);
    }
  }
}
