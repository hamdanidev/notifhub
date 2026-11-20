import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { WahaSignatureService } from '../src/webhooks/waha/waha-signature.service';

const secret = 'test-waha-webhook-hmac-key-32-chars-min';
const rawBody = Buffer.from(
  JSON.stringify({ event: 'message.ack', session: 'default', payload: { id: 'x' } }),
);

function createService(configuredSecret: string | null = secret) {
  const value = configuredSecret === null ? undefined : configuredSecret;
  const config = {
    get: jest.fn((key: string) =>
      key === 'WAHA_WEBHOOK_HMAC_KEY' ? value : undefined,
    ),
  };
  const logger = {
    setContext: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  };

  return {
    service: new WahaSignatureService(config as never, logger as never),
    logger,
  };
}

function sign(body: Buffer, key = secret): string {
  return createHmac('sha512', key).update(body).digest('hex');
}

describe('WahaSignatureService', () => {
  it('menerima HMAC-SHA512 yang valid', () => {
    const { service } = createService();

    expect(() => service.verify(rawBody, sign(rawBody), 'sha512')).not.toThrow();
    expect(() => service.verify(rawBody, sign(rawBody), 'SHA512')).not.toThrow();
  });

  it('menolak signature yang salah', () => {
    const { service, logger } = createService();

    expect(() => service.verify(rawBody, sign(Buffer.from('other')), 'sha512')).toThrow(
      UnauthorizedException,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'waha.webhook.signature_rejected' }),
      expect.any(String),
    );
  });

  it('menolak algoritma selain sha512', () => {
    const { service } = createService();

    expect(() => service.verify(rawBody, sign(rawBody), 'sha256')).toThrow(UnauthorizedException);
    expect(() => service.verify(rawBody, sign(rawBody), undefined)).toThrow(UnauthorizedException);
  });

  it('menolak signature yang formatnya bukan 128 hex', () => {
    const { service } = createService();

    expect(() => service.verify(rawBody, 'abc', 'sha512')).toThrow(UnauthorizedException);
  });

  it('menolak body atau header yang hilang', () => {
    const { service } = createService();

    expect(() => service.verify(undefined, sign(rawBody), 'sha512')).toThrow(
      UnauthorizedException,
    );
    expect(() => service.verify(rawBody, undefined, 'sha512')).toThrow(UnauthorizedException);
  });

  it('fail closed saat secret belum dikonfigurasi', () => {
    const { service, logger } = createService(null);

    expect(() => service.verify(rawBody, sign(rawBody), 'sha512')).toThrow(UnauthorizedException);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'waha.webhook.config_missing' }),
      expect.any(String),
    );
  });
});
