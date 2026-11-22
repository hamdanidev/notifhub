/** Tenant ids double as the `tenantId` column value: immutable, lowercase slug. */
export const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;
export const TENANT_NAME_MAX_LENGTH = 120;
export const TENANT_ADMIN_PASSWORD_MIN_LENGTH = 8;
export const TENANT_DEFAULT_LIST_LIMIT = 20;
export const TENANT_MAX_LIST_LIMIT = 100;
export const PLATFORM_AUDIT_DEFAULT_LIMIT = 50;
export const PLATFORM_AUDIT_MAX_LIMIT = 200;

/** Audit actions written by the platform lane. */
export const PLATFORM_AUDIT_ACTIONS = [
  'tenant.created',
  'tenant.renamed',
  'tenant.approval_mode.changed',
  'tenant.suspended',
  'tenant.resumed',
  'tenant.deleted',
  'tenant.admin.created',
  'tenant.admin.updated',
  'tenant.admin.deactivated',
  'tenant.admin.password_reset',
] as const;

export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];
