import { Channel } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { InAppEventBus } from '../../in-app/in-app-event-bus.service';
import type {
  NotificationProvider,
  ProviderSendInput,
  ProviderSendResult,
} from '../provider.interface';

/** In-app "provider": publishes the rendered notification to the Redis event bus. */
@Injectable()
export class InAppProvider implements NotificationProvider {
  readonly name = 'inapp';
  readonly channel = Channel.inapp;

  constructor(private readonly eventBus: InAppEventBus) {}

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    const streamId = await this.eventBus.publish(input.tenantId, input.recipientId, {
      notificationId: input.notificationId,
      templateKey: input.templateKey,
      subject: input.subject,
      body: input.body,
      bodyHtml: input.bodyHtml ?? null,
      format: input.format === 'markdown' ? 'markdown' : 'text',
      data: input.data,
      priority: input.priority,
      createdAt: new Date().toISOString(),
    });

    return { providerMessageId: streamId };
  }
}
