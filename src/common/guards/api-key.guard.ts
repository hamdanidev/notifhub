import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import { ApiKeyService } from '../../auth/api-key/api-key.service';
import type { RequestWithApiKey } from '../../auth/api-key/api-key.types';
import { ALLOW_SUSPENDED_TENANT } from '../decorators/allow-suspended-tenant.decorator';

/**
 * Ingest authentication via the ApiKey table.
 *
 * The raw key never reaches business code: only `{ apiKeyId, tenantId, tenantStatus,
 * allowedOrigins }` is attached to the request. Admin and subscriber tokens are never accepted
 * here.
 *
 * Two tenant-level rules are enforced after the key check:
 * - a suspended tenant is rejected with `403 tenant_suspended`, unless the handler opts out with
 *   `@AllowSuspendedTenant()` (service-level endpoints such as `/metrics`);
 * - when the key has `allowedOrigins`, a browser `Origin` header must match one of them.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly logger: PinoLogger,
    private readonly reflector: Reflector,
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

    const origin = request.header('origin');

    if (
      origin !== undefined &&
      principal.allowedOrigins.length > 0 &&
      !principal.allowedOrigins.includes(origin)
    ) {
      this.logger.warn(
        {
          event: 'auth.api_key.rejected',
          reason: 'origin_not_allowed',
          tenant_id: principal.tenantId,
          api_key_id: principal.apiKeyId,
          origin,
        },
        'rejected request from an origin outside the key allowlist',
      );
      throw new ForbiddenException('origin_not_allowed');
    }

    const allowSuspendedTenant =
      this.reflector.getAllAndOverride<boolean>(ALLOW_SUSPENDED_TENANT, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;

    if (principal.tenantStatus === 'suspended' && !allowSuspendedTenant) {
      this.logger.warn(
        {
          event: 'auth.api_key.rejected',
          reason: 'tenant_suspended',
          tenant_id: principal.tenantId,
          api_key_id: principal.apiKeyId,
        },
        'rejected request for a suspended tenant',
      );
      throw new ForbiddenException('tenant_suspended');
    }

    request.apiKey = principal;

    return true;
  }
}
