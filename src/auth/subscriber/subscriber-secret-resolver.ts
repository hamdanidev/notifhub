import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';

export type SubscriberSecretSource = 'tenant_key' | 'env_fallback';

export interface ResolvedSubscriberSecrets {
  /** Candidate HMAC secrets; the first one that verifies wins. Never logged. */
  secrets: string[];
  source: SubscriberSecretSource;
}

/**
 * Resolves the subscriber JWT signing secrets for one tenant.
 *
 * Containers are shared by many consumers, so a single global secret would let any consumer
 * mint a token for another tenant. Every API key can carry its own `subscriberJwtSecret`; a
 * tenant with at least one active key secret is verified exclusively against those secrets.
 *
 * `SUBSCRIBER_JWT_SECRET` is only a fallback for tenants that never configured a key secret
 * (and for existing development deployments, where the bootstrap key stores that same value).
 * There is deliberately no downgrade: the env secret is never accepted for a tenant that has
 * its own secret configured.
 */
@Injectable()
export class SubscriberSecretResolver {
  private readonly fallbackSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SubscriberSecretResolver.name);
    this.fallbackSecret = config.getOrThrow<string>('SUBSCRIBER_JWT_SECRET');
  }

  async resolve(tenantId: string): Promise<ResolvedSubscriberSecrets> {
    const keys = await this.prisma.apiKey.findMany({
      where: { tenantId, active: true, subscriberJwtSecret: { not: null } },
      select: { subscriberJwtSecret: true },
    });

    const secrets = [
      ...new Set(
        keys
          .map((key) => key.subscriberJwtSecret)
          .filter((secret): secret is string => typeof secret === 'string' && secret.length > 0),
      ),
    ];

    if (secrets.length === 0) {
      return { secrets: [this.fallbackSecret], source: 'env_fallback' };
    }

    return { secrets, source: 'tenant_key' };
  }
}
