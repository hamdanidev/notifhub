import { Module } from '@nestjs/common';
import { AdminBootstrapService } from './admin/admin-bootstrap.service';
import { AdminJwtGuard } from './admin/admin-jwt.guard';
import { AdminTokenService } from './admin/admin-token.service';
import { PlatformAdminGuard } from './admin/platform-admin.guard';
import { ApiKeyService } from './api-key/api-key.service';
import { SubscriberJwtGuard } from './subscriber/subscriber-jwt.guard';
import { SubscriberSecretResolver } from './subscriber/subscriber-secret-resolver';
import { SubscriberTokenService } from './subscriber/subscriber-token.service';

/**
 * Authentication providers for all lanes:
 * - ingest: ApiKeyService + ApiKeyGuard (guard lives in common, service here)
 * - admin: AdminTokenService + AdminJwtGuard + bootstrap
 * - platform: AdminTokenService + PlatformAdminGuard (cross-tenant, no tenant claim)
 * - end-user in-app: SubscriberTokenService + SubscriberJwtGuard
 *
 * The secrets are never shared between lanes.
 */
@Module({
  providers: [
    ApiKeyService,
    SubscriberSecretResolver,
    SubscriberTokenService,
    SubscriberJwtGuard,
    AdminTokenService,
    AdminJwtGuard,
    PlatformAdminGuard,
    AdminBootstrapService,
  ],
  exports: [
    ApiKeyService,
    SubscriberSecretResolver,
    SubscriberTokenService,
    SubscriberJwtGuard,
    AdminTokenService,
    AdminJwtGuard,
    PlatformAdminGuard,
  ],
})
export class AuthModule {}
