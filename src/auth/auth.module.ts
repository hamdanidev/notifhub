import { Module } from '@nestjs/common';
import { AdminBootstrapService } from './admin/admin-bootstrap.service';
import { AdminJwtGuard } from './admin/admin-jwt.guard';
import { AdminTokenService } from './admin/admin-token.service';
import { ApiKeyService } from './api-key/api-key.service';
import { SubscriberJwtGuard } from './subscriber/subscriber-jwt.guard';
import { SubscriberSecretResolver } from './subscriber/subscriber-secret-resolver';
import { SubscriberTokenService } from './subscriber/subscriber-token.service';

/**
 * Authentication providers for all three lanes:
 * - ingest: ApiKeyService + ApiKeyGuard (guard lives in common, service here)
 * - admin: AdminTokenService + AdminJwtGuard + bootstrap
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
    AdminBootstrapService,
  ],
  exports: [
    ApiKeyService,
    SubscriberSecretResolver,
    SubscriberTokenService,
    SubscriberJwtGuard,
    AdminTokenService,
    AdminJwtGuard,
  ],
})
export class AuthModule {}
