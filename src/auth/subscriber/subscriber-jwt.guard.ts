import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriberTokenService } from './subscriber-token.service';
import type { RequestWithSubscriber } from './subscriber.types';

/**
 * Guards end-user in-app endpoints (PART 1 rule 14: never mixed with X-API-Key or admin JWT).
 *
 * The token is read exclusively from the Authorization header. A token supplied as a query
 * parameter is ignored, so `?token=` can never authenticate a request (PART 1 rule 40).
 *
 * After the token is verified, the tenant status is checked so a suspended tenant loses access
 * immediately (the guard already runs per request for token verification).
 */
@Injectable()
export class SubscriberJwtGuard implements CanActivate {
  constructor(
    private readonly tokens: SubscriberTokenService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SubscriberJwtGuard.name);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithSubscriber>();
    const token = extractBearerToken(request.headers.authorization);

    if (token === undefined) {
      this.logAndReject('missing_token', request);
    }

    try {
      request.subscriber = await this.tokens.verify(token as string);
    } catch {
      this.logAndReject('invalid_token', request);
    }

    const subscriber = request.subscriber as NonNullable<RequestWithSubscriber['subscriber']>;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: subscriber.tenantId },
      select: { status: true },
    });

    if (tenant === null || tenant.status !== 'active') {
      this.logger.warn(
        {
          event: 'auth.subscriber_token.rejected',
          reason: 'tenant_suspended',
          tenant_id: subscriber.tenantId,
          method: request.method,
          path: request.originalUrl ?? request.url,
        },
        'rejected request for a suspended tenant',
      );
      throw new ForbiddenException('tenant_suspended');
    }

    return true;
  }

  private logAndReject(
    reason: 'missing_token' | 'invalid_token',
    request: RequestWithSubscriber,
  ): never {
    this.logger.warn(
      {
        event: 'auth.subscriber_token.rejected',
        reason,
        method: request.method,
        path: request.originalUrl ?? request.url,
        ip: request.ip ?? 'unknown',
      },
      reason === 'missing_token'
        ? 'rejected request without subscriber token'
        : 'rejected request with invalid subscriber token',
    );
    throw new UnauthorizedException('Invalid or missing subscriber token');
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
