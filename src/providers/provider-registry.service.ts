import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { EmailProvider } from './email/email.provider';
import { InAppProvider } from './in-app/in-app.provider';
import type { NotificationProvider } from './provider.interface';
import { WahaProvider } from './waha/waha.provider';
import { WhatsAppProvider } from './whatsapp/whatsapp.provider';

/** Maps a channel to the provider that delivers it (sms has no provider yet). */
@Injectable()
export class ProviderRegistry {
  private readonly providers = new Map<Channel, NotificationProvider>();

  constructor(
    config: ConfigService,
    inAppProvider: InAppProvider,
    emailProvider: EmailProvider,
    whatsAppProvider: WhatsAppProvider,
    wahaProvider: WahaProvider,
    logger: PinoLogger,
  ) {
    const vendor = config.get<string>('WHATSAPP_PROVIDER') ?? 'meta';
    const selectedWhatsAppProvider = vendor === 'waha' ? wahaProvider : whatsAppProvider;

    this.providers.set(inAppProvider.channel, inAppProvider);
    this.providers.set(emailProvider.channel, emailProvider);
    this.providers.set(selectedWhatsAppProvider.channel, selectedWhatsAppProvider);

    logger.setContext(ProviderRegistry.name);
    logger.info(
      {
        event: 'provider.whatsapp.selected',
        provider: selectedWhatsAppProvider.name,
        channel: Channel.whatsapp,
      },
      'whatsapp provider selected',
    );
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
