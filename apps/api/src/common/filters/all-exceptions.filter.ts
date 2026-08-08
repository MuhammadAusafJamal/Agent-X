import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  API_ERROR_CODES,
  ApiError,
  ApiErrorCode,
  JsonColumnError,
} from '@agentx/shared';
import { AppException } from '../errors';

/** Anything at or above this is ours to explain, not the caller's to fix. */
const SERVER_ERROR = 500;

/**
 * Turns every thrown thing into the one error shape the dashboard parses.
 *
 * Two rules here matter beyond tidiness:
 *
 * 1. An unrecognized error becomes a generic 500. Prisma messages quote the
 *    failing query, which can include row data — leaking that to a client is a
 *    disclosure bug, so the detail goes to the log and only the log.
 * 2. The response always matches `apiErrorSchema`, because the dashboard parses
 *    it. An error path that returns a malformed error is a particularly
 *    annoying thing to debug.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body = this.toApiError(exception, request.url);
    const route = `${request.method} ${request.url}`;

    if (body.statusCode >= SERVER_ERROR) {
      this.logger.error(
        `${route} -> ${body.statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${route} -> ${body.statusCode} ${body.code}`);
    }

    response.status(body.statusCode).json(body);
  }

  private toApiError(exception: unknown, path: string): ApiError {
    const timestamp = new Date().toISOString();

    if (exception instanceof AppException) {
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        issues: exception.issues,
        path,
        timestamp,
      };
    }

    // A JSON column that does not match its schema means the database holds
    // something this codebase cannot have written. That is a server fault,
    // never the caller's.
    if (exception instanceof JsonColumnError) {
      return {
        statusCode: SERVER_ERROR,
        code: API_ERROR_CODES.INTERNAL,
        message: 'A stored record could not be read',
        path,
        timestamp,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        statusCode: status,
        code: statusToCode(status),
        message: exception.message,
        path,
        timestamp,
      };
    }

    return {
      statusCode: SERVER_ERROR,
      code: API_ERROR_CODES.INTERNAL,
      message: 'Internal server error',
      path,
      timestamp,
    };
  }
}

function statusToCode(status: number): ApiErrorCode {
  switch (status) {
    case Number(HttpStatus.NOT_FOUND):
      return API_ERROR_CODES.NOT_FOUND;
    case Number(HttpStatus.CONFLICT):
      return API_ERROR_CODES.CONFLICT;
    case Number(HttpStatus.BAD_REQUEST):
      return API_ERROR_CODES.BAD_REQUEST;
    default:
      return status >= SERVER_ERROR
        ? API_ERROR_CODES.INTERNAL
        : API_ERROR_CODES.BAD_REQUEST;
  }
}
