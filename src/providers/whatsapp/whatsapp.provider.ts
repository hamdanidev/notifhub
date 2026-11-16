import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import {
  ProviderConfigurationError,
  type NotificationProvider,
  type ProviderSendInput,
  type ProviderSendResult,
} from '../provider.interface';
import {
  looksLikePhoneNumber,
  normalizeWhatsAppNumber,
  WhatsAppApiError,
  type WhatsAppSendResponse,
  type WhatsAppTextMessageRequest,
} from './whatsapp.types';

type RuntimeMode = 'development' | 'staging' | 'production';

const DEFAULT_API_BASE_URL = 'https://graph.facebook.com';
const DEFAULT_API_VERSION = 'v21.0';
const REQUEST_TIMEOUT_MS = 9000;

/**
 * Meta WhatsApp Cloud API provider.
 *
 * Phase 7 sends plain text messages (`type: "text"`), which is valid inside the
 * 24-hour customer service window. Business-initiated messages outside that window
 * require Meta-approved templates; that mapping is deferred to a later phase.
 */
@Injectable()
export class WhatsAppProvider implements NotificationProvider {
  readonly name = 'whatsapp';
  readonly channel = Channel.whatsapp;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WhatsAppProvider.name);
  }

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    const mode = this.config.getOrThrow<RuntimeMode>('NOTIFHUB_MODE');
    const to = this.resolveRecipient(input.to, mode);

    if (mode === 'development') {
      this.logger.info(
        {
          event: 'whatsapp.log_only',
          notification_id: input.notificationId,
          recipient_id: input.recipientId,
          to,
          mode,
        },
        'whatsapp provider is log-only in development, no API call made',
      );

      return { providerMessageId: 'dev-log-only' };
    }

    const accessToken = this.requireConfig('WHATSAPP_ACCESS_TOKEN');
    const phoneNumberId = this.requireConfig('WHATSAPP_PHONE_NUMBER_ID');
    const baseUrl = (
      this.config.get<string>('WHATSAPP_API_BASE_URL') ?? DEFAULT_API_BASE_URL
    ).replace(/\/+$/, '');
    const apiVersion = this.config.get<string>('WHATSAPP_API_VERSION') ?? DEFAULT_API_VERSION;

    const body: WhatsAppTextMessageRequest = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: input.body },
    };

    let response: Response;

    try {
      response = await fetch(`${baseUrl}/${apiVersion}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new WhatsAppApiError(
        error instanceof Error ? error.message : 'whatsapp request failed',
        0,
        'network_error',
      );
    }

    const payload = await parseJson(response);

    if (!response.ok) {
      throw new WhatsAppApiError(
        payload?.error?.message ?? `whatsapp API responded with status ${response.status}`,
        response.status,
        payload?.error?.code === undefined ? undefined : String(payload.error.code),
      );
    }

    const providerMessageId = payload?.messages?.[0]?.id ?? null;

    if (providerMessageId === null) {
      throw new WhatsAppApiError('whatsapp response did not include a message id', 502);
    }

    this.logger.info(
      {
        event: 'whatsapp.sent',
        notification_id: input.notificationId,
        recipient_id: input.recipientId,
        to,
        mode,
        provider_message_id: providerMessageId,
      },
      'whatsapp message handed to the Cloud API',
    );

    return { providerMessageId };
  }

  private resolveRecipient(to: string, mode: RuntimeMode): string {
    const normalized = normalizeWhatsAppNumber(to);

    if (normalized === null) {
      throw new ProviderConfigurationError('whatsapp recipient is not a valid E.164 number');
    }

    if (mode !== 'staging') {
      return normalized;
    }

    const catchAll =
      this.config.get<string>('WHATSAPP_CATCH_ALL_RECIPIENT') ??
      (looksLikePhoneNumber(this.config.get<string>('CATCH_ALL_RECIPIENT'))
        ? this.config.get<string>('CATCH_ALL_RECIPIENT')
        : undefined);

    if (catchAll === undefined) {
      throw new ProviderConfigurationError(
        'WHATSAPP_CATCH_ALL_RECIPIENT is required when NOTIFHUB_MODE=staging',
      );
    }

    const normalizedCatchAll = normalizeWhatsAppNumber(catchAll);

    if (normalizedCatchAll === null) {
      throw new ProviderConfigurationError(
        'WHATSAPP_CATCH_ALL_RECIPIENT is not a valid E.164 number',
      );
    }

    return normalizedCatchAll;
  }

  private requireConfig(name: string): string {
    const value = this.config.get<string>(name);

    if (value === undefined || value.length === 0) {
      throw new ProviderConfigurationError(`${name} is not configured`);
    }

    return value;
  }
}

async function parseJson(response: Response): Promise<WhatsAppSendResponse | null> {
  try {
    return (await response.json()) as WhatsAppSendResponse;
  } catch {
    return null;
  }
}
