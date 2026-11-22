import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminTokenService } from './admin-token.service';
import { ADMIN_ROLES_KEY } from './admin-roles.decorator';
import {
  TENANT_ADMIN_ROLE,
  isTenantAdminRole,
  type AdminTokenClaims,
  type RequestWithAdmin,
  type TenantAdminRole,
} from './admin.types';

const DEFAULT_ADMIN_ROLES: TenantAdminRole[] = [TENANT_ADMIN_ROLE];

/**
 * Guards tenant admin endpoints.
 *
 * Besides the JWT (role tenant_admin + tenant claim), the account and its tenant are checked in
 * the database on every request: a deactivated admin, an account moved to another tenant, or a
 * suspended tenant cannot keep using a token until it expires.
 */
@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(
    private readonly tokens: AdminTokenService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
    private readonly reflector: Reflector,
  ) {
    this.logger.setContext(AdminJwtGuard.name);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    if (!isTenantAdminRole(principal.role) || principal.tenantId === undefined) {
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

    const admin = await this.prisma.adminUser.findUnique({
      where: { id: principal.adminId },
      select: {
        id: true,
        email: true,
        role: true,
        tenantId: true,
        active: true,
        tokenVersion: true,
        tenant: { select: { status: true } },
      },
    });

    if (admin === null || !admin.active) {
      this.logger.warn(
        {
          event: 'auth.admin_token.rejected',
          reason: 'inactive_or_missing_account',
          admin_id: principal.adminId,
        },
        'rejected request for unavailable admin account',
      );
      throw new UnauthorizedException('Admin account is not available');
    }

    if (principal.tokenVersion !== admin.tokenVersion) {
      this.logger.warn(
        {
          event: 'auth.admin_token.rejected',
          reason: 'token_revoked',
          admin_id: admin.id,
          token_version: principal.tokenVersion,
          account_version: admin.tokenVersion,
        },
        'rejected request for a revoked admin session',
      );
      throw new UnauthorizedException('Admin session is no longer valid');
    }

    if (
      !isTenantAdminRole(admin.role) ||
      admin.tenantId === null ||
      admin.tenantId !== principal.tenantId
    ) {
      this.logger.warn(
        {
          event: 'auth.admin_token.rejected',
          reason: 'account_mismatch',
          admin_id: admin.id,
          role: admin.role,
          token_tenant: principal.tenantId,
          account_tenant: admin.tenantId,
        },
        'admin token no longer matches the account',
      );
      throw new ForbiddenException('Admin role is not permitted');
    }

    const allowedRoles =
      this.reflector.getAllAndOverride<TenantAdminRole[]>(ADMIN_ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_ADMIN_ROLES;

    if (!allowedRoles.includes(admin.role as TenantAdminRole)) {
      this.logger.warn(
        {
          event: 'auth.admin_token.rejected',
          reason: 'role_not_permitted',
          admin_id: admin.id,
          role: admin.role,
          method: request.method,
          path: request.originalUrl ?? request.url,
        },
        'admin role is not permitted for this route',
      );
      throw new ForbiddenException('role_not_permitted');
    }

    if (admin.tenant?.status !== 'active') {
      this.logger.warn(
        {
          event: 'auth.admin_token.rejected',
          reason: 'tenant_suspended',
          tenant_id: admin.tenantId,
          admin_id: admin.id,
        },
        'rejected request for a suspended tenant',
      );
      throw new ForbiddenException('tenant_suspended');
    }

    request.admin = {
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
      tenantId: admin.tenantId,
      tokenVersion: admin.tokenVersion,
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
