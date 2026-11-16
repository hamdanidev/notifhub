import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MetricsModule } from '../metrics/metrics.module';
import { TemplatesModule } from '../templates/templates.module';
import { InAppController } from './in-app.controller';
import { InAppEventBus } from './in-app-event-bus.service';
import { InAppService } from './in-app.service';
import { InAppStreamController } from './in-app-stream.controller';
import { SseConnectionRegistry } from './sse-connection-registry.service';

@Module({
  imports: [AuthModule, MetricsModule, TemplatesModule],
  controllers: [InAppStreamController, InAppController],
  providers: [InAppService, InAppEventBus, SseConnectionRegistry],
  exports: [InAppEventBus],
})
export class InAppModule {}
