import { Module } from '@nestjs/common';
import { NotificationRollupService } from './notification-rollup.service';

@Module({
  providers: [NotificationRollupService],
  exports: [NotificationRollupService],
})
export class NotificationsModule {}
