import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import { PlatformAuthController } from './controllers/platform-auth.controller';
import { PlatformAuthService } from './services/platform-auth.service';

/**
 * Platform API (cross-tenant). F2 only adds the auth surface; tenant provisioning, suspend,
 * audit, and allowedOrigins enforcement follow in F3.
 *
 * Throttler is scoped to this module (login 5/min); tenant admin and ingest keep their own
 * ThrottlerModule instances.
 */
@Module({
  imports: [
    AuthModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 5 }]),
  ],
  controllers: [PlatformAuthController],
  providers: [PlatformAuthService, ThrottlerGuard],
})
export class PlatformModule {}
