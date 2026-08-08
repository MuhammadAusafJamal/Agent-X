import { HttpException, HttpStatus } from '@nestjs/common';
import { API_ERROR_CODES, ApiErrorCode, ApiIssue } from '@agentx/shared';

/**
 * Errors that carry a machine-readable code, so the dashboard can branch on
 * `code` instead of pattern-matching a message string.
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ApiErrorCode,
    message: string,
    readonly issues?: ApiIssue[],
  ) {
    super(message, status);
  }
}

export class NotFoundError extends AppException {
  constructor(resource: string, id: string) {
    super(
      HttpStatus.NOT_FOUND,
      API_ERROR_CODES.NOT_FOUND,
      `${resource} '${id}' was not found`,
    );
  }
}

export class ConflictError extends AppException {
  constructor(message: string) {
    super(HttpStatus.CONFLICT, API_ERROR_CODES.CONFLICT, message);
  }
}

export class BadRequestError extends AppException {
  constructor(message: string) {
    super(HttpStatus.BAD_REQUEST, API_ERROR_CODES.BAD_REQUEST, message);
  }
}

/** Raised by `ZodValidationPipe`. Carries field-level issues for the dashboard to render inline. */
export class ValidationError extends AppException {
  constructor(issues: ApiIssue[]) {
    super(
      HttpStatus.BAD_REQUEST,
      API_ERROR_CODES.VALIDATION_FAILED,
      'Request body failed validation',
      issues,
    );
  }
}
