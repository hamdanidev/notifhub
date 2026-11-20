import { Channel } from '@prisma/client';
import { ProviderRegistry } from '../src/providers/provider-registry.service';

function provider(name: string, channel: Channel) {
  return { name, channel, send: jest.fn() };
}

function createRegistry(vendor: string | undefined) {
  const config = {
    get: jest.fn((key: string) => (key === 'WHATSAPP_PROVIDER' ? vendor : undefined)),
  };
  const inApp = provider('in-app', Channel.inapp);
  const email = provider('smtp', Channel.email);
  const meta = provider('whatsapp', Channel.whatsapp);
  const waha = provider('waha', Channel.whatsapp);
  const logger = { setContext: jest.fn(), info: jest.fn() };

  const registry = new ProviderRegistry(
    config as never,
    inApp as never,
    email as never,
    meta as never,
    waha as never,
    logger as never,
  );

  return { registry, logger };
}

describe('ProviderRegistry WhatsApp selection', () => {
  it('memakai WahaProvider saat WHATSAPP_PROVIDER=waha', () => {
    const { registry, logger } = createRegistry('waha');

    expect(registry.get(Channel.whatsapp)?.name).toBe('waha');
    expect(registry.get(Channel.inapp)?.name).toBe('in-app');
    expect(registry.get(Channel.email)?.name).toBe('smtp');
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'provider.whatsapp.selected', provider: 'waha' }),
      expect.any(String),
    );
  });

  it('default ke Meta saat env tidak diisi atau bernilai meta', () => {
    for (const vendor of [undefined, 'meta']) {
      const { registry } = createRegistry(vendor);

      expect(registry.get(Channel.whatsapp)?.name).toBe('whatsapp');
    }
  });
});
