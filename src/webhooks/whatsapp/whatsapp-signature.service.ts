import { createHmac, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/i;

/**
 * Webhook security for Meta WhatsApp Cloud API.
 *
 * - Event signature: X-Hub-Signature-256 = sha256=<HMAC of the raw body with the app secret>
 * - Subscription verification: hub.verify_token must match WHATSAPP_VERIFY_TOKEN
 */
@Injectable()
export class WhatsAppSignatureService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WhatsAppSignatureService.name);
  }

  verifyEventSignature(rawBody: Buffer | undefined, header: string | undefined): void {
    const secret = this.config.get<string>('WHATSAPP_APP_SECRET');

    if (secret === undefined || secret.length === 0) {
      this.logger.warn(
        { event: 'whatsapp.webhook.config_missing', reason: 'WHATSAPP_APP_SECRET' },
        'rejected WhatsApp webhook because the app secret is not configured',
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    if (header === undefined || rawBody === undefined) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const match = SIGNATURE_PATTERN.exec(header.trim());

    if (match === null) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const provided = Buffer.from(match[1] as string, 'hex');
    const expected = createHmac('sha256', secret).update(rawBody).digest();

    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      this.logger.warn(
        { event: 'whatsapp.webhook.signature_rejected' },
        'rejected WhatsApp webhook with invalid signature',
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }

  verifySubscriptionToken(token: string | undefined): void {
    const expected = this.config.get<string>('WHATSAPP_VERIFY_TOKEN');

    if (expected === undefined || expected.length === 0) {
      throw new ForbiddenException('WhatsApp webhook verification is not configured');
    }

    if (token === undefined) {
      throw new ForbiddenException('Invalid verify token');
    }

    const providedDigest = Buffer.from(token);
    const expectedDigest = Buffer.from(expected);

    if (
      providedDigest.length !== expectedDigest.length ||
      !timingSafeEqual(providedDigest, expectedDigest)
    ) {
      this.logger.warn(
        { event: 'whatsapp.webhook.verify_rejected' },
        'rejected WhatsApp webhook verification with invalid token',
      );
      throw new ForbiddenException('Invalid verify token');
    }
  }
}
