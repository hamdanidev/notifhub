import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AdminTokenService } from './admin-token.service';
import {
  TENANT_ADMIN_ROLE,
  type AdminTokenClaims,
  type RequestWithAdmin,
} from './admin.types';

/**
 * Guards tenant admin endpoints. Requires a valid admin JWT with role tenant_admin and a tenant
 * claim; platform admins (no tenant) use the platform lane instead.
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

    let principal: AdminTokenClaims;

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

    if (principal.role !== TENANT_ADMIN_ROLE || principal.tenantId === undefined) {
      this.logger.warn(
        {
          event: 'auth.admin_token.rejected',
          reason: principal.tenantId === undefined ? 'missing_tenant' : 'unsupported_role',
          role: principal.role,
          admin_id: principal.adminId,
        },
        'admin token is not valid for the tenant lane',
      );
      throw new ForbiddenException('Admin role is not permitted');
    }

    request.admin = {
      adminId: principal.adminId,
      email: principal.email,
      role: principal.role,
      tenantId: principal.tenantId,
    };

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
