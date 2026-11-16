import { Injectable } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { EmailProvider } from './email/email.provider';
import { InAppProvider } from './in-app/in-app.provider';
import type { NotificationProvider } from './provider.interface';
import { WhatsAppProvider } from './whatsapp/whatsapp.provider';

/** Maps a channel to the provider that delivers it (sms has no provider yet). */
@Injectable()
export class ProviderRegistry {
  private readonly providers = new Map<Channel, NotificationProvider>();

  constructor(
    inAppProvider: InAppProvider,
    emailProvider: EmailProvider,
    whatsAppProvider: WhatsAppProvider,
  ) {
    this.providers.set(inAppProvider.channel, inAppProvider);
    this.providers.set(emailProvider.channel, emailProvider);
    this.providers.set(whatsAppProvider.channel, whatsAppProvider);
  }

  get(channel: Channel): NotificationProvider | undefined {
    return this.providers.get(channel);
  }

  getOrThrow(channel: Channel): NotificationProvider {
    const provider = this.providers.get(channel);

    if (provider === undefined) {
      throw new Error(`no provider registered for channel ${channel}`);
    }

    return provider;
  }

  has(channel: Channel): boolean {
    return this.providers.has(channel);
  }
}
