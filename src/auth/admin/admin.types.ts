import type { Request } from 'express';

export const TENANT_ADMIN_ROLE = 'tenant_admin';
export const PLATFORM_ADMIN_ROLE = 'platform_admin';

/** Principal resolved from a verified admin JWT. */
export interface AdminPrincipal {
  adminId: string;
  email: string;
  role: string;
  tenantId: string;
}

export interface RequestWithAdmin extends Request {
  admin?: AdminPrincipal;
}
