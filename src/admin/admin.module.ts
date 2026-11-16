import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import { TopicsModule } from '../topics/topics.module';
import { AdminApiKeysController } from './controllers/admin-api-keys.controller';
import { AdminAuthController } from './controllers/admin-auth.controller';
import { AdminNotificationsController } from './controllers/admin-notifications.controller';
import { AdminSubscribersController } from './controllers/admin-subscribers.controller';
import { AdminTemplatesController } from './controllers/admin-templates.controller';
import { AdminTopicsController } from './controllers/admin-topics.controller';
import { AdminApiKeysService } from './services/admin-api-keys.service';
import { AdminAuthService } from './services/admin-auth.service';
import { AdminNotificationsService } from './services/admin-notifications.service';
import { AdminSubscribersService } from './services/admin-subscribers.service';
import { AdminTemplatesService } from './services/admin-templates.service';
import { AdminTopicsService } from './services/admin-topics.service';

/**
 * Tenant admin API. Every controller uses AdminJwtGuard, and every query is scoped to the
 * tenantId from the admin token. Login is the only unauthenticated endpoint and is throttled.
 */
@Module({
  imports: [
    AuthModule,
    TopicsModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 5 }]),
  ],
  controllers: [
    AdminAuthController,
    AdminApiKeysController,
    AdminTemplatesController,
    AdminSubscribersController,
    AdminTopicsController,
    AdminNotificationsController,
  ],
  providers: [
    AdminAuthService,
    AdminApiKeysService,
    AdminTemplatesService,
    AdminSubscribersService,
    AdminTopicsService,
    AdminNotificationsService,
    ThrottlerGuard,
  ],
})
export class AdminModule {}
