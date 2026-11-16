import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from '../request-context';

export type RequestWithId = Request & { id?: string; requestId?: string };

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Reads X-Request-ID (or generates a UUID) and runs the rest of the request inside
 * AsyncLocalStorage so that logs and job payloads can resolve the same requestId.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, _res: Response, next: NextFunction): void {
    const requestId = this.resolveRequestId(req);
    req.requestId = requestId;
    RequestContext.run(requestId, () => next());
  }

  private resolveRequestId(req: RequestWithId): string {
    // pino-http may have assigned req.id before this middleware runs.
    if (typeof req.id === 'string' && req.id.length > 0) {
      return req.id;
    }

    const header = req.headers[REQUEST_ID_HEADER];
    const raw = Array.isArray(header) ? header[0] : header;
    const candidate = typeof raw === 'string' ? raw.trim() : '';

    if (candidate.length > 0 && candidate.length <= 128) {
      return candidate;
    }

    return randomUUID();
  }
}
