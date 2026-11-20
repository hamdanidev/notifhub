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
} from '../whatsapp/whatsapp.types';
import {
  extractWahaErrorMessage,
  extractWahaMessageId,
  toWahaChatId,
  WahaApiError,
  type WahaSendTextRequest,
  type WahaSendTextResponse,
} from './waha.types';

type RuntimeMode = 'development' | 'staging' | 'production';

const REQUEST_TIMEOUT_MS = 9000;
const NON_RETRYABLE_STATUSES = new Set([401, 403, 404, 422]);

/**
 * WAHA (WhatsApp HTTP API, self-hosted) provider for the existing `whatsapp` channel.
 *
 * WAHA is an unofficial WhatsApp Web/multi-device gateway: the operator runs the container,
 * authenticates a session with a QR code, and NotifHub only calls `POST /api/sendText` with an
 * API key. Status callbacks arrive through a dedicated HMAC-SHA512 webhook (see
 * `src/webhooks/waha/`). The provider is selected at boot through `WHATSAPP_PROVIDER=waha`;
 * Meta Cloud API remains the default.
 */
@Injectable()
export class WahaProvider implements NotificationProvider {
  readonly name = 'waha';
  readonly channel = Channel.whatsapp;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WahaProvider.name);
  }

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    const mode = this.config.getOrThrow<RuntimeMode>('NOTIFHUB_MODE');
    const to = this.resolveRecipient(input.to, mode);

    if (mode === 'development') {
      this.logger.info(
        {
          event: 'waha.log_only',
          notification_id: input.notificationId,
          recipient_id: input.recipientId,
          to,
          mode,
        },
        'waha provider is log-only in development, no API call made',
      );

      return { providerMessageId: 'dev-log-only' };
    }

    const baseUrl = this.requireConfig('WAHA_BASE_URL').replace(/\/+$/, '');
    const apiKey = this.requireConfig('WAHA_API_KEY');
    const session = this.config.get<string>('WAHA_SESSION') ?? 'default';

    const body: WahaSendTextRequest = {
      session,
      chatId: toWahaChatId(to),
      text: input.body,
      linkPreview: false,
    };

    let response: Response;

    try {
      response = await fetch(`${baseUrl}/api/sendText`, {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new WahaApiError(
        error instanceof Error ? `waha request failed: ${error.message}` : 'waha request failed',
        0,
      );
    }

    const payload = await parseJson(response);

    if (!response.ok) {
      const detail = extractWahaErrorMessage(payload);
      const message = `waha API responded with status ${response.status}${detail === null ? '' : `: ${detail}`}`;

      if (NON_RETRYABLE_STATUSES.has(response.status)) {
        throw new ProviderConfigurationError(message);
      }

      throw new WahaApiError(message, response.status);
    }

    const providerMessageId = extractWahaMessageId(payload);

    if (providerMessageId === null) {
      throw new WahaApiError('waha response did not include a message id', 502);
    }

    this.logger.info(
      {
        event: 'waha.sent',
        notification_id: input.notificationId,
        recipient_id: input.recipientId,
        to,
        mode,
        session,
        provider_message_id: providerMessageId,
      },
      'whatsapp message handed to WAHA',
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

async function parseJson(response: Response): Promise<WahaSendTextResponse | null> {
  try {
    return (await response.json()) as WahaSendTextResponse;
  } catch {
    return null;
  }
}
