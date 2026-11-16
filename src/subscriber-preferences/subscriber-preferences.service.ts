import { BadRequestException, Injectable } from '@nestjs/common';
import { Channel, type NotificationPreference } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import type { SubscriberPrincipal } from '../auth/subscriber/subscriber.types';
import { FALLBACK_TIMEZONE } from '../preferences/quiet-hours';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ChannelPreferenceResponseDto,
  SubscriberPreferencesResponseDto,
  UpdateSubscriberPreferenceDto,
} from './dto/subscriber-preference.dto';

/** Fixed channel order so clients always render the same list. */
export const SUBSCRIBER_CHANNELS: readonly Channel[] = [
  Channel.inapp,
  Channel.email,
  Channel.whatsapp,
];

const MISSING_QUIET_HOURS_PAIR_MESSAGE =
  'quietHoursStart and quietHoursEnd must be provided together';

/**
 * End-user preference center. Every query is scoped by both `tenantId` and `recipientId` taken
 * from the verified subscriber token; neither is accepted from input.
 *
 * A subscriber does not need a `Subscriber` row: preferences are keyed by `externalId`, and when
 * the profile was never push-synced the tenant defaults are returned instead of a 404.
 */
@Injectable()
export class SubscriberPreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SubscriberPreferencesService.name);
  }

  async get(principal: SubscriberPrincipal): Promise<SubscriberPreferencesResponseDto> {
    const [preferences, subscriber] = await Promise.all([
      this.prisma.notificationPreference.findMany({
        where: { tenantId: principal.tenantId, recipientId: principal.recipientId },
      }),
      this.findSubscriber(principal),
    ]);

    const timezone = subscriber?.timezone ?? FALLBACK_TIMEZONE;
    const byChannel = new Map<Channel, NotificationPreference>(
      preferences.map((preference) => [preference.channel, preference]),
    );

    const channels: ChannelPreferenceResponseDto[] = SUBSCRIBER_CHANNELS.map((channel) => {
      const stored = byChannel.get(channel);

      return stored === undefined ? defaultChannelPreference(channel, timezone) : toChannelView(stored);
    });

    this.logger.info(
      {
        event: 'subscriber.preferences.read',
        tenant_id: principal.tenantId,
        recipient_id: principal.recipientId,
        channel_count: channels.length,
      },
      'end-user read the notification preferences',
    );

    return {
      recipientId: principal.recipientId,
      locale: subscriber?.locale ?? null,
      timezone,
      channels,
    };
  }

  async upsert(
    principal: SubscriberPrincipal,
    channel: Channel,
    dto: UpdateSubscriberPreferenceDto,
  ): Promise<ChannelPreferenceResponseDto> {
    if (!SUBSCRIBER_CHANNELS.includes(channel)) {
      // `sms` exists in the enum but has no provider/worker, so it is not offered to end users.
      throw new BadRequestException(
        `channel must be one of: ${SUBSCRIBER_CHANNELS.join(', ')}`,
      );
    }

    // `null` and `undefined` both mean "not provided"; only an explicit HH:mm pair is accepted.
    const hasStart = dto.quietHoursStart !== undefined && dto.quietHoursStart !== null;
    const hasEnd = dto.quietHoursEnd !== undefined && dto.quietHoursEnd !== null;

    if (hasStart !== hasEnd) {
      throw new BadRequestException(MISSING_QUIET_HOURS_PAIR_MESSAGE);
    }

    const timezone = dto.timezone ?? (await this.inheritTimezone(principal));
    const quietHoursStart = hasStart ? (dto.quietHoursStart as string) : null;
    const quietHoursEnd = hasEnd ? (dto.quietHoursEnd as string) : null;

    const preference = await this.prisma.notificationPreference.upsert({
      where: {
        tenantId_recipientId_channel: {
          tenantId: principal.tenantId,
          recipientId: principal.recipientId,
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
        tenantId: principal.tenantId,
        recipientId: principal.recipientId,
        channel,
        enabled: dto.enabled,
        quietHoursStart,
        quietHoursEnd,
        timezone,
      },
    });

    this.logger.info(
      {
        event: 'subscriber.preference.updated',
        tenant_id: principal.tenantId,
        recipient_id: principal.recipientId,
        channel,
        enabled: preference.enabled,
        quiet_hours_start: preference.quietHoursStart,
        quiet_hours_end: preference.quietHoursEnd,
        timezone: preference.timezone,
      },
      'end-user updated a notification preference',
    );

    return toChannelView(preference);
  }

  private findSubscriber(
    principal: SubscriberPrincipal,
  ): Promise<{ locale: string | null; timezone: string } | null> {
    return this.prisma.subscriber.findUnique({
      where: {
        tenantId_externalId: {
          tenantId: principal.tenantId,
          externalId: principal.recipientId,
        },
      },
      select: { locale: true, timezone: true },
    });
  }

  private async inheritTimezone(principal: SubscriberPrincipal): Promise<string> {
    const subscriber = await this.findSubscriber(principal);

    return subscriber?.timezone ?? FALLBACK_TIMEZONE;
  }
}

function defaultChannelPreference(
  channel: Channel,
  timezone: string,
): ChannelPreferenceResponseDto {
  return {
    channel,
    enabled: true,
    quietHoursStart: null,
    quietHoursEnd: null,
    timezone,
    isDefault: true,
    updatedAt: null,
  };
}

function toChannelView(preference: NotificationPreference): ChannelPreferenceResponseDto {
  return {
    channel: preference.channel,
    enabled: preference.enabled,
    quietHoursStart: preference.quietHoursStart,
    quietHoursEnd: preference.quietHoursEnd,
    timezone: preference.timezone,
    isDefault: false,
    updatedAt: preference.updatedAt.toISOString(),
  };
}
