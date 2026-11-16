import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

const SIGNATURE_HEADER = 'x-notifhub-signature';
const TIMESTAMP_TOLERANCE_SECONDS = 300;

interface ParsedSignatureHeader {
  timestamp: number;
  signatures: string[];
}

/**
 * Verifies provider webhook signatures.
 *
 * Header format: `t=<unix seconds>,v1=<hex hmac sha256>`.
 * The signed payload is `<timestamp>.<raw body>` and the comparison is constant time.
 * A 5 minute timestamp tolerance limits replay attacks.
 */
@Injectable()
export class WebhookSignatureService {
  private readonly secret: string;

  constructor(
    config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WebhookSignatureService.name);
    this.secret = config.getOrThrow<string>('WEBHOOK_SIGNING_SECRET');
  }

  verify(rawBody: Buffer | undefined, header: string | undefined, ip: string, path: string): void {
    if (header === undefined || header.trim().length === 0) {
      this.reject('missing_signature', ip, path);
    }

    const parsed = parseSignatureHeader(header as string);

    if (parsed === null) {
      this.reject('malformed_signature', ip, path);
    }

    const parsedValue = parsed as ParsedSignatureHeader;
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (Math.abs(nowSeconds - parsedValue.timestamp) > TIMESTAMP_TOLERANCE_SECONDS) {
      this.reject('timestamp_out_of_tolerance', ip, path);
    }

    if (rawBody === undefined || rawBody.length === 0) {
      this.reject('missing_body', ip, path);
    }

    const expected = createHmac('sha256', this.secret)
      .update(`${parsedValue.timestamp}.`)
      .update(rawBody as Buffer)
      .digest();

    const matched = parsedValue.signatures.some((signature) => {
      let provided: Buffer;

      try {
        provided = Buffer.from(signature, 'hex');
      } catch {
        return false;
      }

      return provided.length === expected.length && timingSafeEqual(provided, expected);
    });

    if (!matched) {
      this.reject('invalid_signature', ip, path);
    }
  }

  private reject(reason: string, ip: string, path: string): never {
    this.logger.warn(
      { event: 'webhook.signature_rejected', reason, ip, path },
      'rejected webhook with invalid signature',
    );
    throw new UnauthorizedException('Invalid webhook signature');
  }
}

function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  let timestamp: number | undefined;
  const signatures: string[] = [];

  for (const part of header.split(',')) {
    const separator = part.indexOf('=');

    if (separator === -1) {
      continue;
    }

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key === 't') {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) {
        timestamp = parsed;
      }
    } else if (key === 'v1' && /^[0-9a-f]+$/i.test(value) && value.length % 2 === 0) {
      signatures.push(value);
    }
  }

  if (timestamp === undefined || signatures.length === 0) {
    return null;
  }

  return { timestamp, signatures };
}
