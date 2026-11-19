import { SetMetadata } from '@nestjs/common';

export const ALLOW_SUSPENDED_TENANT = 'allowSuspendedTenant';

/**
 * Opts a route out of the `tenant_suspended` check in ApiKeyGuard. Only meant for service-level
 * endpoints that are not scoped to a tenant, such as `/metrics`.
 */
export const AllowSuspendedTenant = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_SUSPENDED_TENANT, true);
