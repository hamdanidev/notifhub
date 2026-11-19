import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminTokenService } from './admin-token.service';
import {
  PLATFORM_ADMIN_ROLE,
  type AdminTokenClaims,
  type RequestWithPlatformAdmin,
} from './admin.types';

/**
 * Guards the platform lane (`/api/v1/platform/*`).
 *
 * A token must be a valid admin JWT with role platform_admin, and the account must still be
 * active in the database: a deactivated or demoted platform admin cannot keep using a live
 * token until it expires. Platform admins never carry a tenant claim, so a tenant admin token
 * is rejected here.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly tokens: AdminTokenService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PlatformAdminGuard.name);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPlatformAdmin>();
    const token = extractBearerToken(request.headers.authorization);

    if (token === undefined) {
      this.logger.warn(
        {
          event: 'auth.platform_token.rejected',
          reason: 'missing_token',
          method: request.method,
          path: request.originalUrl ?? request.url,
          ip: request.ip ?? 'unknown',
        },
        'rejected request without admin token',
      );
      throw new UnauthorizedException('Invalid or missing admin token');
    }

    let claims: AdminTokenClaims;

    try {
      claims = this.tokens.verify(token);
    } catch {
      this.logger.warn(
        {
          event: 'auth.platform_token.rejected',
          reason: 'invalid_token',
          method: request.method,
          path: request.originalUrl ?? request.url,
          ip: request.ip ?? 'unknown',
        },
        'rejected request with invalid admin token',
      );
      throw new UnauthorizedException('Invalid or missing admin token');
    }

    if (claims.role !== PLATFORM_ADMIN_ROLE) {
      this.logger.warn(
        {
          event: 'auth.platform_token.rejected',
          reason: 'unsupported_role',
          role: claims.role,
          admin_id: claims.adminId,
        },
        'admin token is not valid for the platform lane',
      );
      throw new ForbiddenException('Admin role is not permitted');
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { id: claims.adminId },
      select: { id: true, email: true, role: true, tenantId: true, active: true },
    });

    if (admin === null || !admin.active) {
      this.logger.warn(
        {
          event: 'auth.platform_token.rejected',
          reason: 'inactive_or_missing_account',
          admin_id: claims.adminId,
        },
        'rejected request for unavailable platform admin',
      );
      throw new UnauthorizedException('Admin account is not available');
    }

    if (admin.role !== PLATFORM_ADMIN_ROLE || admin.tenantId !== null) {
      this.logger.warn(
        {
          event: 'auth.platform_token.rejected',
          reason: 'account_not_platform_admin',
          admin_id: admin.id,
          role: admin.role,
        },
        'admin account is no longer a platform admin',
      );
      throw new ForbiddenException('Admin role is not permitted');
    }

    request.platformAdmin = {
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
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
