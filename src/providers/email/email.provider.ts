import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';
import { Channel } from '@prisma/client';
import type { SentMessageInfo } from 'nodemailer';
import { PinoLogger } from 'nestjs-pino';
import type {
  NotificationProvider,
  ProviderSendInput,
  ProviderSendResult,
} from '../provider.interface';

type RuntimeMode = 'development' | 'staging' | 'production';

const DEFAULT_FROM = 'noreply@notifhub.local';
const LOG_ONLY_MESSAGE_ID = 'dev-log-only';

/**
 * SMTP email provider (PART 1 rule 22).
 *
 * - development: log-only, never opens an SMTP connection.
 * - staging: every message is redirected to CATCH_ALL_RECIPIENT.
 * - production: sends to the resolved recipient address.
 */
@Injectable()
export class EmailProvider implements NotificationProvider {
  readonly name = 'smtp';
  readonly channel = Channel.email;

  constructor(
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EmailProvider.name);
  }

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    const mode = this.config.getOrThrow<RuntimeMode>('NOTIFHUB_MODE');
    const to = mode === 'staging' ? this.catchAllRecipient() : input.to;

    if (mode === 'development') {
      this.logger.info(
        {
          event: 'email.log_only',
          notification_id: input.notificationId,
          recipient_id: input.recipientId,
          to,
          subject: input.subject,
          text_chars: input.text?.length ?? 0,
          mode,
        },
        'email provider is log-only in development, no SMTP connection opened',
      );

      return { providerMessageId: LOG_ONLY_MESSAGE_ID };
    }

    const info: SentMessageInfo = await this.mailer.sendMail({
      to,
      from: this.config.get<string>('SMTP_FROM') ?? DEFAULT_FROM,
      subject: input.subject ?? '',
      html: input.body,
      ...(typeof input.text === 'string' && input.text.length > 0
        ? { text: input.text }
        : {}),
    });

    const providerMessageId = extractMessageId(info);

    this.logger.info(
      {
        event: 'email.sent',
        notification_id: input.notificationId,
        recipient_id: input.recipientId,
        to,
        mode,
        provider_message_id: providerMessageId,
      },
      'email handed to the SMTP transport',
    );

    return { providerMessageId };
  }

  private catchAllRecipient(): string {
    const catchAll = this.config.getOrThrow<string>('CATCH_ALL_RECIPIENT');

    return catchAll;
  }
}

function extractMessageId(info: SentMessageInfo): string | null {
  if (typeof info !== 'object' || info === null) {
    return null;
  }

  const messageId = (info as { messageId?: unknown }).messageId;

  return typeof messageId === 'string' && messageId.length > 0 ? messageId : null;
}
