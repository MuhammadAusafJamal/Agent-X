import { Injectable, PipeTransform } from '@nestjs/common';
import type { ApiIssue } from '@agentx/shared';
import { z } from 'zod';
import { ValidationError } from '../errors';

/**
 * Narrows a request body, query, or param through a zod schema from
 * `@agentx/shared` before a controller ever sees it.
 *
 * This is the boundary `CONTRIBUTING.md` means by "parse at the boundary, don't
 * cast". Downstream code receives the parsed type and can trust it, because
 * nothing that failed this pipe got through.
 *
 * Usage:
 * `@Body(new ZodValidationPipe(createProjectSchema)) body: CreateProjectInput`
 */
@Injectable()
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new ValidationError(toApiIssues(result.error));
    }

    return result.data;
  }
}

function toApiIssues(error: z.ZodError): ApiIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}
