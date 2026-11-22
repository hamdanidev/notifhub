import type { Request } from 'express';

export const TENANT_ADMIN_ROLE = 'tenant_admin';
export const TENANT_APPROVER_ROLE = 'tenant_approver';
export const PLATFORM_ADMIN_ROLE = 'platform_admin';

/** Roles allowed on the tenant lane. Default guard requirement is tenant_admin only. */
export const TENANT_ROLES = [TENANT_ADMIN_ROLE, TENANT_APPROVER_ROLE] as const;
export type TenantAdminRole = (typeof TENANT_ROLES)[number];

export function isTenantAdminRole(role: string): role is TenantAdminRole {
  return (TENANT_ROLES as readonly string[]).includes(role);
}

/** Claims resolved from a verified admin JWT; `tenantId` is absent for platform admins. */
export interface AdminTokenClaims {
  adminId: string;
  email: string;
  role: string;
  tenantId?: string;
  /** Bumped when the password changes/resets; mismatch invalidates the token. */
  tokenVersion: number;
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
