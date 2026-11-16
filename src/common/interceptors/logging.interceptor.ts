import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { Observable, tap } from 'rxjs';

/** Health and metrics endpoints are excluded from access logs (scrapes and probes). */
const EXCLUDED_PATH_PREFIXES = ['/health', '/metrics'];

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(LoggingInterceptor.name);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const path = request.originalUrl ?? request.url ?? '';

    if (EXCLUDED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return next.handle();
    }

    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.log(request, http.getResponse<Response>().statusCode, startedAt, 'info');
        },
        error: (error: unknown) => {
          const statusCode =
            error instanceof HttpException ? error.getStatus() : 500;
          this.log(request, statusCode, startedAt, 'warn');
        },
      }),
    );
  }

  private log(
    request: Request,
    statusCode: number,
    startedAt: number,
    level: 'info' | 'warn',
  ): void {
    const payload = {
      event: 'http.request.completed',
      method: request.method,
      path: request.originalUrl ?? request.url,
      status_code: statusCode,
      duration_ms: Date.now() - startedAt,
    };

    if (level === 'warn') {
      this.logger.warn(payload, 'request completed');
      return;
    }

    this.logger.info(payload, 'request completed');
  }
}
