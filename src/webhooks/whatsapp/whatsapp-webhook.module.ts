import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks.module';
import { WhatsAppSignatureService } from './whatsapp-signature.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

@Module({
  imports: [WebhooksModule],
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppSignatureService, WhatsAppWebhookService],
})
export class WhatsAppWebhookModule {}
