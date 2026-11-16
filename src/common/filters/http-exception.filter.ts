import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { RequestContext } from '../request-context';
import type { RequestWithId } from '../middleware/request-id.middleware';

interface NormalizedError {
  statusCode: number;
  message: string | string[];
  error: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Same body-parser error class surfaced by express.json({ limit }) when a request
 * exceeds INGEST_MAX_PAYLOAD_BYTES.
 */
function isPayloadTooLarge(exception: unknown): boolean {
  if (!isRecord(exception)) {
    return false;
  }

  const type = exception.type;
  const name = exception.name;
  const statusCode = exception.statusCode ?? exception.status;

  return type === 'entity.too.large' || name === 'PayloadTooLargeError' || statusCode === 413;
}

/**
 * Every error response has the same shape:
 * { statusCode, message, error, timestamp, path, requestId }.
 * Stack traces are logged, never returned in production.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(HttpExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<RequestWithId>();

    const normalized = this.normalize(exception);
    const requestId = RequestContext.getRequestId() ?? request.requestId ?? null;
    const path = request.originalUrl ?? request.url ?? '';

    if (normalized.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        {
          event: 'http.request.failed',
          status_code: normalized.statusCode,
          method: request.method,
          path,
          requestId,
          err: this.toLoggableError(exception),
        },
        'request failed with an unexpected error',
      );
    } else {
      this.logger.warn(
        {
          event: 'http.request.rejected',
          status_code: normalized.statusCode,
          method: request.method,
          path,
          requestId,
        },
        'request rejected',
      );
    }

    response.status(normalized.statusCode).json({
      statusCode: normalized.statusCode,
      message: normalized.message,
      error: normalized.error,
      timestamp: new Date().toISOString(),
      path,
      requestId,
    });
  }

  private normalize(exception: unknown): NormalizedError {
    if (isPayloadTooLarge(exception)) {
      return {
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        message: `Payload too large. The maximum accepted body size is ${this.config.getOrThrow<number>(
          'INGEST_MAX_PAYLOAD_BYTES',
        )} bytes.`,
        error: 'Payload Too Large',
      };
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return { statusCode, message: payload, error: this.reasonPhrase(statusCode) };
      }

      if (isRecord(payload)) {
        const rawMessage = payload.message;
        const message =
          typeof rawMessage === 'string' || Array.isArray(rawMessage)
            ? (rawMessage as string | string[])
            : exception.message;
        const error = typeof payload.error === 'string' ? payload.error : this.reasonPhrase(statusCode);

        return { statusCode, message, error };
      }

      return { statusCode, message: exception.message, error: this.reasonPhrase(statusCode) };
    }

    // Errors raised by express middleware (e.g. a malformed JSON body) carry a numeric
    // status but are not HttpExceptions. Their 4xx messages are safe to return.
    if (isRecord(exception)) {
      const candidate = exception.statusCode ?? exception.status;

      if (typeof candidate === 'number' && candidate >= 400 && candidate < 500) {
        const message =
          typeof exception.message === 'string' && exception.message.length > 0
            ? exception.message
            : this.reasonPhrase(candidate);

        return { statusCode: candidate, message, error: this.reasonPhrase(candidate) };
      }
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    };
  }

  private reasonPhrase(statusCode: number): string {
    return HttpStatus[statusCode] ?? 'Error';
  }

  private toLoggableError(exception: unknown): { name: string; message: string; stack?: string } {
    if (exception instanceof Error) {
      return {
        name: exception.name,
        message: exception.message,
        stack: exception.stack,
      };
    }

    return { name: 'UnknownError', message: String(exception) };
  }
}
