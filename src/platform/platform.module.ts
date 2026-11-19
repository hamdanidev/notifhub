import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import { PlatformAuditController } from './controllers/platform-audit.controller';
import { PlatformAuthController } from './controllers/platform-auth.controller';
import { PlatformTenantsController } from './controllers/platform-tenants.controller';
import { PlatformAuditService } from './services/platform-audit.service';
import { PlatformAuthService } from './services/platform-auth.service';
import { PlatformTenantAdminsService } from './services/platform-tenant-admins.service';
import { PlatformTenantsService } from './services/platform-tenants.service';

/**
 * Platform API (cross-tenant): auth (F2), tenant provisioning, tenant admins, audit, and the
 * enforcement that goes with it (F3).
 *
 * Throttler is scoped to this module: module default 120/min, mutations 60/min, login 5/min.
 * Tenant admin and ingest keep their own ThrottlerModule instances.
 */
@Module({
  imports: [
    AuthModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
  ],
  controllers: [
    PlatformAuthController,
    PlatformTenantsController,
    PlatformAuditController,
  ],
  providers: [
    PlatformAuthService,
    PlatformTenantsService,
    PlatformTenantAdminsService,
    PlatformAuditService,
    ThrottlerGuard,
  ],
})
export class PlatformModule {}
