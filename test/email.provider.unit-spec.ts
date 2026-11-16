import { Channel } from '@prisma/client';
import { EmailProvider } from '../src/providers/email/email.provider';
import type { ProviderSendInput } from '../src/providers/provider.interface';

const input: ProviderSendInput = {
  notificationId: 'n1',
  recipientId: 'r1',
  tenantId: 'default',
  priority: 3,
  templateKey: 'order.shipped',
  subject: 'Subjek',
  body: '<p>Isi rahasia</p>',
  text: 'Isi rahasia',
  data: {},
  to: 'qa@example.com',
};

function createProvider(mode: string) {
  const mailer = {
    sendMail: jest.fn().mockResolvedValue({ messageId: 'provider-1' }),
  };
  const config = {
    getOrThrow: jest.fn((key: string) => (key === 'NOTIFHUB_MODE' ? mode : '')),
    get: jest.fn(() => undefined),
  };
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const provider = new EmailProvider(
    mailer as never,
    config as never,
    logger as never,
  );

  return { provider, mailer, logger };
}

describe('EmailProvider plain text', () => {
  it('mengirim text bersama html dalam mode production', async () => {
    const { provider, mailer } = createProvider('production');

    await provider.send(input);

    expect(mailer.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ html: '<p>Isi rahasia</p>', text: 'Isi rahasia' }),
    );
  });

  it('tidak mengirim text saat null (kompatibilitas HTML-only)', async () => {
    const { provider, mailer } = createProvider('production');

    await provider.send({ ...input, text: null });

    const call = mailer.sendMail.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).not.toHaveProperty('text');
    expect(call).toHaveProperty('html', '<p>Isi rahasia</p>');
  });

  it('tetap log-only di development dan tidak mencatat isi teks', async () => {
    const { provider, mailer, logger } = createProvider('development');

    const result = await provider.send(input);

    expect(mailer.sendMail).not.toHaveBeenCalled();
    expect(result.providerMessageId).toBe('dev-log-only');
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'email.log_only', text_chars: 11 }),
      expect.any(String),
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('Isi rahasia');
  });

  it('mengirim ke catch-all di staging dan mempertahankan text', async () => {
    const mailer = {
      sendMail: jest.fn().mockResolvedValue({ messageId: 'provider-2' }),
    };
    const config = {
      getOrThrow: jest.fn((key: string) =>
        key === 'NOTIFHUB_MODE' ? 'staging' : 'catch-all@example.com',
      ),
      get: jest.fn(() => undefined),
    };
    const logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const provider = new EmailProvider(
      mailer as never,
      config as never,
      logger as never,
    );

    await provider.send(input);

    expect(mailer.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'catch-all@example.com', text: 'Isi rahasia' }),
    );
  });
});
