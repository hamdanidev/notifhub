import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AdminTokenService } from './admin-token.service';
import { TENANT_ADMIN_ROLE, type AdminPrincipal, type RequestWithAdmin } from './admin.types';

/**
 * Guards tenant admin endpoints. Requires a valid admin JWT with role tenant_admin;
 * platform_admin is reserved for cross-tenant operations and is rejected today.
 */
@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(
    private readonly tokens: AdminTokenService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminJwtGuard.name);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAdmin>();
    const token = extractBearerToken(request.headers.authorization);

    if (token === undefined) {
      this.logger.warn(
        {
          event: 'auth.admin_token.rejected',
          reason: 'missing_token',
          method: request.method,
          path: request.originalUrl ?? request.url,
          ip: request.ip ?? 'unknown',
        },
        'rejected request without admin token',
      );
      throw new UnauthorizedException('Invalid or missing admin token');
    }

    let principal: AdminPrincipal;

    try {
      principal = this.tokens.verify(token);
    } catch {
      this.logger.warn(
        {
          event: 'auth.admin_token.rejected',
          reason: 'invalid_token',
          method: request.method,
          path: request.originalUrl ?? request.url,
          ip: request.ip ?? 'unknown',
        },
        'rejected request with invalid admin token',
      );
      throw new UnauthorizedException('Invalid or missing admin token');
    }

    if (principal.role !== TENANT_ADMIN_ROLE) {
      this.logger.warn(
        {
          event: 'auth.admin_token.rejected',
          reason: 'unsupported_role',
          role: principal.role,
          admin_id: principal.adminId,
        },
        'admin token role is not permitted yet',
      );
      throw new ForbiddenException('Admin role is not permitted');
    }

    request.admin = principal;

    return true;
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
