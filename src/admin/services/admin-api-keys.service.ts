import { Injectable, NotFoundException } from '@nestjs/common';
import { ApiKeyService } from '../../auth/api-key/api-key.service';
import type {
  ApiKeySummaryDto,
  CreatedApiKeyResponseDto,
  CreateApiKeyDto,
  RevokedApiKeyResponseDto,
} from '../dto/api-key.dto';

@Injectable()
export class AdminApiKeysService {
  constructor(private readonly apiKeys: ApiKeyService) {}

  async list(tenantId: string): Promise<ApiKeySummaryDto[]> {
    const records = await this.apiKeys.listKeys(tenantId);

    return records.map((record) => ({
      id: record.id,
      name: record.name,
      tenantId: record.tenantId,
      active: record.active,
      lastUsedAt: record.lastUsedAt === null ? null : record.lastUsedAt.toISOString(),
      createdAt: record.createdAt.toISOString(),
    }));
  }

  async create(tenantId: string, dto: CreateApiKeyDto): Promise<CreatedApiKeyResponseDto> {
    const created = await this.apiKeys.createKey({
      name: dto.name.trim(),
      tenantId,
      allowedOrigins: dto.allowedOrigins ?? [],
      subscriberJwtSecret: dto.subscriberJwtSecret ?? null,
    });

    return {
      id: created.record.id,
      name: created.record.name,
      tenantId: created.record.tenantId,
      active: created.record.active,
      lastUsedAt: null,
      createdAt: created.record.createdAt.toISOString(),
      key: created.rawKey,
      keyPreview: this.apiKeys.preview(created.rawKey),
    };
  }

  async revoke(tenantId: string, apiKeyId: string): Promise<RevokedApiKeyResponseDto> {
    const revoked = await this.apiKeys.revokeKey(tenantId, apiKeyId);

    if (!revoked) {
      throw new NotFoundException('API key not found');
    }

    return { id: apiKeyId, active: false };
  }
}
