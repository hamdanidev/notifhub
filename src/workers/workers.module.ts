import { Module } from '@nestjs/common';
import { InAppModule } from '../in-app/in-app.module';
import { MetricsModule } from '../metrics/metrics.module';
import { PreferencesModule } from '../preferences/preferences.module';
import { ProvidersModule } from '../providers/providers.module';
import { QueuesModule } from '../queues/queues.module';
import { TemplatesModule } from '../templates/templates.module';
import {
  DeliveryAttemptsService,
  DeliveryContextService,
  PreferenceEnforcementService,
} from './delivery-worker.support';
import { EmailProcessor } from './email.processor';
import { InAppProcessor } from './in-app.processor';
import { WhatsAppProcessor } from './whatsapp.processor';

@Module({
  imports: [
    QueuesModule,
    InAppModule,
    TemplatesModule,
    PreferencesModule,
    MetricsModule,
    ProvidersModule,
  ],
  providers: [
    InAppProcessor,
    EmailProcessor,
    WhatsAppProcessor,
    DeliveryContextService,
    DeliveryAttemptsService,
    PreferenceEnforcementService,
  ],
})
export class WorkersModule {}
