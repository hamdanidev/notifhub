import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import { SubscriberPreferencesController } from './subscriber-preferences.controller';
import { SubscriberPreferencesService } from './subscriber-preferences.service';

/**
 * End-user preference center. Subscriber JWT lane, rate limited per IP, tenant-scoped from the
 * token. No admin or API-key endpoints live here.
 */
@Module({
  imports: [AuthModule, ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }])],
  controllers: [SubscriberPreferencesController],
  providers: [SubscriberPreferencesService, ThrottlerGuard],
})
export class SubscriberPreferencesModule {}
