import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Subscriber } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import type { SubscriberResponseDto } from './dto/subscriber-response.dto';
import type { UpsertSubscriberDto } from './dto/upsert-subscriber.dto';

const DEFAULT_TIMEZONE = 'Asia/Jakarta';
const MAX_EXTERNAL_ID_LENGTH = 128;

/**
 * Subscriber data is push-synced by the consumer (PART 1 rule 39): PUT replaces the stored
 * snapshot. NotifHub never calls back to the consumer to resolve or refresh recipients.
 */
@Injectable()
export class SubscribersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SubscribersService.name);
  }

  async upsert(
    tenantId: string,
    externalIdRaw: string,
    dto: UpsertSubscriberDto,
  ): Promise<SubscriberResponseDto> {
    const externalId = this.normalizeExternalId(externalIdRaw);

    const snapshot = {
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      locale: dto.locale ?? null,
      timezone: dto.timezone ?? DEFAULT_TIMEZONE,
      metadata:
        dto.metadata === undefined ? Prisma.DbNull : (dto.metadata as Prisma.InputJsonValue),
    };

    const subscriber = await this.prisma.subscriber.upsert({
      where: { tenantId_externalId: { tenantId, externalId } },
      update: snapshot,
      create: { tenantId, externalId, ...snapshot },
    });

    this.logger.info(
      {
        event: 'subscriber.upserted',
        tenant_id: tenantId,
        recipient_id: externalId,
        subscriber_id: subscriber.id,
        has_email: subscriber.email !== null,
        timezone: subscriber.timezone,
      },
      'subscriber snapshot stored',
    );

    return toResponse(subscriber);
  }

  async get(tenantId: string, externalIdRaw: string): Promise<SubscriberResponseDto> {
    const externalId = this.normalizeExternalId(externalIdRaw);

    const subscriber = await this.prisma.subscriber.findUnique({
      where: { tenantId_externalId: { tenantId, externalId } },
    });

    if (subscriber === null) {
      throw new NotFoundException('Subscriber not found');
    }

    return toResponse(subscriber);
  }

  private normalizeExternalId(externalIdRaw: string): string {
    const externalId = externalIdRaw.trim();

    if (externalId.length === 0 || externalId.length > MAX_EXTERNAL_ID_LENGTH) {
      throw new BadRequestException(
        `externalId must be between 1 and ${MAX_EXTERNAL_ID_LENGTH} characters`,
      );
    }

    return externalId;
  }
}

function toResponse(subscriber: Subscriber): SubscriberResponseDto {
  return {
    id: subscriber.id,
    tenantId: subscriber.tenantId,
    externalId: subscriber.externalId,
    email: subscriber.email,
    phone: subscriber.phone,
    locale: subscriber.locale,
    timezone: subscriber.timezone,
    metadata: isRecord(subscriber.metadata) ? subscriber.metadata : null,
    createdAt: subscriber.createdAt.toISOString(),
    updatedAt: subscriber.updatedAt.toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
