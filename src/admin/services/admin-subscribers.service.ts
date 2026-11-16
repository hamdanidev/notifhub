import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Channel, Prisma, type NotificationPreference, type Subscriber } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import type { AdminListQueryDto } from '../dto/list-query.dto';
import type { PreferenceResponseDto, UpdatePreferenceDto } from '../dto/preference.dto';

export interface SubscriberView {
  id: string;
  tenantId: string;
  externalId: string;
  email: string | null;
  phone: string | null;
  locale: string | null;
  timezone: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriberListResult {
  items: SubscriberView[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class AdminSubscribersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminSubscribersService.name);
  }

  async list(tenantId: string, query: AdminListQueryDto): Promise<SubscriberListResult> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const where: Prisma.SubscriberWhereInput = {
      tenantId,
      ...(query.search === undefined
        ? {}
        : {
            OR: [
              { externalId: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.subscriber.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.subscriber.count({ where }),
    ]);

    return { items: rows.map(toSubscriberView), total, limit, offset };
  }

  async get(tenantId: string, externalIdRaw: string): Promise<SubscriberView> {
    const subscriber = await this.requireSubscriber(tenantId, externalIdRaw);

    return toSubscriberView(subscriber);
  }

  async listPreferences(
    tenantId: string,
    externalIdRaw: string,
  ): Promise<PreferenceResponseDto[]> {
    const subscriber = await this.requireSubscriber(tenantId, externalIdRaw);

    const preferences = await this.prisma.notificationPreference.findMany({
      where: { tenantId, recipientId: subscriber.externalId },
      orderBy: { channel: 'asc' },
    });

    return preferences.map(toPreferenceView);
  }

  async upsertPreference(
    tenantId: string,
    externalIdRaw: string,
    channel: Channel,
    dto: UpdatePreferenceDto,
  ): Promise<PreferenceResponseDto> {
    const subscriber = await this.requireSubscriber(tenantId, externalIdRaw);

    if (
      (dto.quietHoursStart === undefined) !== (dto.quietHoursEnd === undefined)
    ) {
      throw new BadRequestException(
        'quietHoursStart and quietHoursEnd must be provided together',
      );
    }

    const quietHoursStart = dto.quietHoursStart ?? null;
    const quietHoursEnd = dto.quietHoursEnd ?? null;
    const timezone = dto.timezone ?? 'Asia/Jakarta';

    const preference = await this.prisma.notificationPreference.upsert({
      where: {
        tenantId_recipientId_channel: {
          tenantId,
          recipientId: subscriber.externalId,
          channel,
        },
      },
      update: {
        enabled: dto.enabled,
        quietHoursStart,
        quietHoursEnd,
        timezone,
      },
      create: {
        tenantId,
        recipientId: subscriber.externalId,
        channel,
        enabled: dto.enabled,
        quietHoursStart,
        quietHoursEnd,
        timezone,
      },
    });

    this.logger.info(
      {
        event: 'admin.preference.upserted',
        tenant_id: tenantId,
        recipient_id: subscriber.externalId,
        channel,
        enabled: preference.enabled,
        quiet_hours_start: preference.quietHoursStart,
        quiet_hours_end: preference.quietHoursEnd,
        timezone: preference.timezone,
      },
      'notification preference upserted',
    );

    return toPreferenceView(preference);
  }

  private async requireSubscriber(tenantId: string, externalIdRaw: string): Promise<Subscriber> {
    const externalId = externalIdRaw.trim();
    const subscriber = await this.prisma.subscriber.findUnique({
      where: { tenantId_externalId: { tenantId, externalId } },
    });

    if (subscriber === null) {
      throw new NotFoundException('Subscriber not found');
    }

    return subscriber;
  }
}

function toSubscriberView(subscriber: Subscriber): SubscriberView {
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

function toPreferenceView(preference: NotificationPreference): PreferenceResponseDto {
  return {
    id: preference.id,
    recipientId: preference.recipientId,
    channel: preference.channel,
    enabled: preference.enabled,
    quietHoursStart: preference.quietHoursStart,
    quietHoursEnd: preference.quietHoursEnd,
    timezone: preference.timezone,
    updatedAt: preference.updatedAt.toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
