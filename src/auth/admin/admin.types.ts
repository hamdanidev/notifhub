import type { Request } from 'express';

export const TENANT_ADMIN_ROLE = 'tenant_admin';
export const PLATFORM_ADMIN_ROLE = 'platform_admin';

/** Claims resolved from a verified admin JWT; `tenantId` is absent for platform admins. */
export interface AdminTokenClaims {
  adminId: string;
  email: string;
  role: string;
  tenantId?: string;
}

/** Tenant-lane principal: every tenant admin has a tenant. */
export interface AdminPrincipal extends AdminTokenClaims {
  tenantId: string;
}

/** Platform-lane principal: cross-tenant operations, no tenant claim. */
export interface PlatformAdminPrincipal {
  adminId: string;
  email: string;
  role: string;
}

export interface RequestWithAdmin extends Request {
  admin?: AdminPrincipal;
}

export interface RequestWithPlatformAdmin extends Request {
  platformAdmin?: PlatformAdminPrincipal;
}
