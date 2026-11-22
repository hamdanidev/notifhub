import { SetMetadata } from '@nestjs/common';
import type { TenantAdminRole } from './admin.types';

/**
 * Roles allowed to access a tenant-lane route.
 *
 * `AdminJwtGuard` defaults to `tenant_admin` when no decorator is present, so the approver role
 * must be opted in explicitly per route. Approve/reject routes use `@AdminRoles('tenant_approver')`.
 */
export const ADMIN_ROLES_KEY = 'notifhub.admin_roles';

export const AdminRoles = (...roles: TenantAdminRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ADMIN_ROLES_KEY, roles);
