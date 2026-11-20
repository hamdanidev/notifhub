import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks.module';
import { WahaSignatureService } from './waha-signature.service';
import { WahaWebhookController } from './waha-webhook.controller';
import { WahaWebhookService } from './waha-webhook.service';

@Module({
  imports: [WebhooksModule],
  controllers: [WahaWebhookController],
  providers: [WahaSignatureService, WahaWebhookService],
})
export class WahaWebhookModule {}
