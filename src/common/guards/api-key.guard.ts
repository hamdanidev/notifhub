import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ApiKeyService } from '../../auth/api-key/api-key.service';
import type { RequestWithApiKey } from '../../auth/api-key/api-key.types';

/**
 * Ingest authentication via the ApiKey table (Phase 5).
 *
 * The raw key never reaches business code: only `{ apiKeyId, tenantId }` is attached to the
 * request. Admin (ADMIN_JWT_SECRET) and subscriber (SUBSCRIBER_JWT_SECRET) tokens are never
 * accepted here.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ApiKeyGuard.name);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithApiKey>();
    const provided = request.header('x-api-key') ?? '';
    const principal = await this.apiKeys.authenticate(provided);

    if (principal === null) {
      this.logger.warn(
        {
          event: 'auth.api_key.rejected',
          ip: request.ip ?? 'unknown',
          method: request.method,
          path: request.originalUrl ?? request.url,
          reason: provided.length === 0 ? 'missing_key' : 'invalid_key',
        },
        'rejected request with invalid api key',
      );
      throw new UnauthorizedException('Invalid or missing API key');
    }

    request.apiKey = principal;

    return true;
  }
}
