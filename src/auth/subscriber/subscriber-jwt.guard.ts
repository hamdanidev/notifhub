import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { SubscriberTokenService } from './subscriber-token.service';
import type { RequestWithSubscriber } from './subscriber.types';

/**
 * Guards end-user in-app endpoints (PART 1 rule 14: never mixed with X-API-Key or admin JWT).
 *
 * The token is read exclusively from the Authorization header. A token supplied as a query
 * parameter is ignored, so `?token=` can never authenticate a request (PART 1 rule 40).
 */
@Injectable()
export class SubscriberJwtGuard implements CanActivate {
  constructor(
    private readonly tokens: SubscriberTokenService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SubscriberJwtGuard.name);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithSubscriber>();
    const token = extractBearerToken(request.headers.authorization);

    if (token === undefined) {
      this.logger.warn(
        {
          event: 'auth.subscriber_token.rejected',
          reason: 'missing_token',
          method: request.method,
          path: request.originalUrl ?? request.url,
          ip: request.ip ?? 'unknown',
        },
        'rejected request without subscriber token',
      );
      throw new UnauthorizedException('Invalid or missing subscriber token');
    }

    try {
      request.subscriber = await this.tokens.verify(token);
      return true;
    } catch {
      this.logger.warn(
        {
          event: 'auth.subscriber_token.rejected',
          reason: 'invalid_token',
          method: request.method,
          path: request.originalUrl ?? request.url,
          ip: request.ip ?? 'unknown',
        },
        'rejected request with invalid subscriber token',
      );
      throw new UnauthorizedException('Invalid or missing subscriber token');
    }
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }

  const [scheme, value] = header.split(' ');

  if (scheme === undefined || value === undefined || scheme.toLowerCase() !== 'bearer') {
    return undefined;
  }

  const token = value.trim();

  return token.length > 0 ? token : undefined;
}
