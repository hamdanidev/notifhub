import { createHash, randomBytes } from 'node:crypto';
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiKey } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import type { ApiKeyPrincipal } from './api-key.types';

const KEY_PREFIX = 'nhk_';
const LAST_USED_THROTTLE_MS = 60_000;

export interface ApiKeySummary {
  id: string;
  name: string;
  tenantId: string;
  active: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface CreatedApiKey {
  record: ApiKeySummary;
  rawKey: string;
}

/**
 * API key storage and verification (PART 1 rule 14: ingest auth is separate from admin and
 * subscriber JWTs).
 *
 * Only the SHA-256 hash of a key is stored; the raw key is returned exactly once when created.
 * When the table is empty the legacy SERVICE_API_KEY is imported as a "bootstrap" key so
 * existing deployments keep working.
 */
@Injectable()
export class ApiKeyService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ApiKeyService.name);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureBootstrapKey();
    await this.warnOnBootstrapSubscriberSecretDrift();
  }

  hash(rawKey: string): string {
    return createHash('sha256').update(rawKey, 'utf8').digest('hex');
  }

  preview(rawKey: string): string {
    if (rawKey.length <= 11) {
      return `${rawKey.slice(0, 4)}...`;
    }

    return `${rawKey.slice(0, 7)}...${rawKey.slice(-4)}`;
  }

  async authenticate(rawKey: string): Promise<ApiKeyPrincipal | null> {
    if (rawKey.length === 0) {
      return null;
    }

    const record = await this.prisma.apiKey.findUnique({
      where: { keyHash: this.hash(rawKey) },
      select: { id: true, tenantId: true, active: true, lastUsedAt: true },
    });

    if (record === null || !record.active) {
      return null;
    }

    void this.touchLastUsed(record.id, record.lastUsedAt);

    return { apiKeyId: record.id, tenantId: record.tenantId };
  }

  async createKey(params: {
    name: string;
    tenantId: string;
    allowedOrigins: string[];
    subscriberJwtSecret?: string | null;
  }): Promise<CreatedApiKey> {
    const rawKey = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;

    const record = await this.prisma.apiKey.create({
      data: {
        name: params.name,
        keyHash: this.hash(rawKey),
        tenantId: params.tenantId,
        allowedOrigins: params.allowedOrigins,
        subscriberJwtSecret: params.subscriberJwtSecret ?? null,
      },
      select: {
        id: true,
        name: true,
        tenantId: true,
        active: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    this.logger.info(
      {
        event: 'api_key.created',
        api_key_id: record.id,
        tenant_id: record.tenantId,
      },
      'API key created',
    );

    return { record, rawKey };
  }

  async listKeys(tenantId: string): Promise<ApiKeySummary[]> {
    return this.prisma.apiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        tenantId: true,
        active: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
  }

  async revokeKey(tenantId: string, apiKeyId: string): Promise<boolean> {
    const result = await this.prisma.apiKey.updateMany({
      where: { id: apiKeyId, tenantId },
      data: { active: false },
    });

    if (result.count > 0) {
      this.logger.info(
        { event: 'api_key.revoked', api_key_id: apiKeyId, tenant_id: tenantId },
        'API key revoked',
      );
    }

    return result.count > 0;
  }

  private async ensureBootstrapKey(): Promise<void> {
    const existing = await this.prisma.apiKey.count();

    if (existing > 0) {
      return;
    }

    const rawKey = this.config.getOrThrow<string>('SERVICE_API_KEY');
    const tenantId = this.config.getOrThrow<string>('DEFAULT_TENANT_ID');
    const subscriberJwtSecret = this.config.getOrThrow<string>('SUBSCRIBER_JWT_SECRET');

    try {
      await this.prisma.apiKey.create({
        data: {
          name: 'bootstrap',
          keyHash: this.hash(rawKey),
          tenantId,
          allowedOrigins: [],
          subscriberJwtSecret,
          active: true,
        },
        select: { id: true },
      });

      this.logger.info(
        { event: 'api_key.bootstrap.created', tenant_id: tenantId },
        'bootstrap API key created from SERVICE_API_KEY',
      );
    } catch (error) {
      // A concurrent instance may have created it first; the unique hash makes that harmless.
      this.logger.warn(
        {
          event: 'api_key.bootstrap.skipped',
          err: error instanceof Error ? error.message : String(error),
        },
        'bootstrap API key was not created',
      );
    }
  }

  /**
   * Subscriber tokens are verified against the tenant's API key secret, so a bootstrap
   * key that stored an older SUBSCRIBER_JWT_SECRET silently rejects tokens signed with the current
   * env secret. Nothing is changed automatically; the mismatch is logged so operators can re-sync
   * the key or sign with its secret.
   */
  private async warnOnBootstrapSubscriberSecretDrift(): Promise<void> {
    const bootstrap = await this.prisma.apiKey.findFirst({
      where: { name: 'bootstrap' },
      select: { tenantId: true, subscriberJwtSecret: true },
    });

    if (bootstrap === null || bootstrap.subscriberJwtSecret === null) {
      return;
    }

    if (bootstrap.subscriberJwtSecret === this.config.getOrThrow<string>('SUBSCRIBER_JWT_SECRET')) {
      return;
    }

    this.logger.warn(
      {
        event: 'api_key.bootstrap.subscriber_secret_mismatch',
        tenant_id: bootstrap.tenantId,
      },
      'bootstrap API key stores a subscriber JWT secret that differs from SUBSCRIBER_JWT_SECRET; ' +
        'tokens signed with the env secret will be rejected for this tenant (sign with the key ' +
        'secret or re-sync the key)',
    );
  }

  private async touchLastUsed(apiKeyId: string, lastUsedAt: Date | null): Promise<void> {
    if (lastUsedAt !== null && Date.now() - lastUsedAt.getTime() < LAST_USED_THROTTLE_MS) {
      return;
    }

    try {
      await this.prisma.apiKey.update({
        where: { id: apiKeyId },
        data: { lastUsedAt: new Date() },
      });
    } catch (error) {
      this.logger.warn(
        {
          event: 'api_key.last_used_update_failed',
          api_key_id: apiKeyId,
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to update API key lastUsedAt',
      );
    }
  }
}

export type ApiKeyRecord = ApiKey;
