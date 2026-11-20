import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

const HMAC_HEX_PATTERN = /^[0-9a-f]{128}$/i;
const EXPECTED_ALGORITHM = 'sha512';

/**
 * Webhook security for WAHA.
 *
 * WAHA signs the raw request body with HMAC-SHA512 and sends the digest in `X-Webhook-Hmac`
 * together with `X-Webhook-Hmac-Algorithm: sha512`. This is deliberately separate from the Meta
 * Cloud API signature (`X-Hub-Signature-256`, SHA-256 app secret).
 */
@Injectable()
export class WahaSignatureService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WahaSignatureService.name);
  }

  verify(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    algorithm: string | undefined,
  ): void {
    const secret = this.config.get<string>('WAHA_WEBHOOK_HMAC_KEY');

    if (secret === undefined || secret.length === 0) {
      this.logger.warn(
        { event: 'waha.webhook.config_missing', reason: 'WAHA_WEBHOOK_HMAC_KEY' },
        'rejected WAHA webhook because the HMAC key is not configured',
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    if (algorithm === undefined || algorithm.toLowerCase() !== EXPECTED_ALGORITHM) {
      this.logger.warn(
        { event: 'waha.webhook.signature_rejected', reason: 'algorithm' },
        'rejected WAHA webhook with an unsupported signature algorithm',
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    if (signature === undefined || rawBody === undefined) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    if (!HMAC_HEX_PATTERN.test(signature.trim())) {
      this.logger.warn(
        { event: 'waha.webhook.signature_rejected', reason: 'format' },
        'rejected WAHA webhook with a malformed signature',
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const provided = Buffer.from(signature.trim(), 'hex');
    const expected = createHmac('sha512', secret).update(rawBody).digest();

    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      this.logger.warn(
        { event: 'waha.webhook.signature_rejected', reason: 'mismatch' },
        'rejected WAHA webhook with invalid signature',
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}
