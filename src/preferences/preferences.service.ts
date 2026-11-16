import { Injectable } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import {
  FALLBACK_TIMEZONE,
  formatLocalTime,
  isWithinQuietHours,
  isValidTimeZone,
  localMinutes,
  minutesUntilQuietEnd,
  parseQuietHours,
} from './quiet-hours';

export type PreferenceReason = 'preference_disabled' | 'quiet_hours';

export type PreferenceDecision =
  | { action: 'deliver' }
  | { action: 'skip'; reason: 'preference_disabled' }
  | {
      action: 'defer';
      reason: 'quiet_hours';
      delayMs: number;
      timezone: string;
      localTime: string;
    };

const CRITICAL_PRIORITY = 1;
const MAX_DEFER_MINUTES = 12 * 60;

/**
 * Evaluates NotificationPreference for one tenant/recipient/channel (PART 1 rule 15).
 *
 * Preferences are tenant-scoped because `recipientId` is the consumer's externalId, which is
 * only unique inside a tenant.
 *
 * - Missing row means "enabled, no quiet hours".
 * - `enabled=false` -> skip (`preference_disabled`).
 * - quiet hours are ignored for critical priority and otherwise defer the job.
 */
@Injectable()
export class PreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PreferencesService.name);
  }

  async evaluate(params: {
    tenantId: string;
    recipientId: string;
    channel: Channel;
    priority: number;
    subscriberTimezone?: string | null;
    now?: Date;
  }): Promise<PreferenceDecision> {
    const { tenantId, recipientId, channel, priority, subscriberTimezone, now = new Date() } =
      params;

    const preference = await this.prisma.notificationPreference.findUnique({
      where: {
        tenantId_recipientId_channel: { tenantId, recipientId, channel },
      },
    });

    if (preference !== null && !preference.enabled) {
      return { action: 'skip', reason: 'preference_disabled' };
    }

    const timezone = this.resolveTimezone(preference?.timezone ?? null, subscriberTimezone ?? null);
    const window = parseQuietHours(
      preference?.quietHoursStart ?? null,
      preference?.quietHoursEnd ?? null,
    );

    if (window === null || priority === CRITICAL_PRIORITY) {
      return { action: 'deliver' };
    }

    const minutes = localMinutes(now, timezone);

    if (!isWithinQuietHours(window, minutes)) {
      return { action: 'deliver' };
    }

    const delayMinutes = Math.min(minutesUntilQuietEnd(window, minutes) + 1, MAX_DEFER_MINUTES);
    const localTime = formatLocalTime(now, timezone);

    this.logger.info(
      {
        event: 'preference.quiet_hours',
        tenant_id: tenantId,
        recipient_id: recipientId,
        channel,
        timezone,
        local_time: localTime,
        quiet_hours_start: preference?.quietHoursStart ?? null,
        quiet_hours_end: preference?.quietHoursEnd ?? null,
        delay_minutes: delayMinutes,
      },
      'recipient is inside quiet hours, delivery will be deferred',
    );

    return {
      action: 'defer',
      reason: 'quiet_hours',
      delayMs: delayMinutes * 60_000,
      timezone,
      localTime,
    };
  }

  private resolveTimezone(
    preferenceTimezone: string | null,
    subscriberTimezone: string | null,
  ): string {
    for (const candidate of [preferenceTimezone, subscriberTimezone, FALLBACK_TIMEZONE]) {
      if (typeof candidate === 'string' && candidate.length > 0 && isValidTimeZone(candidate)) {
        return candidate;
      }
    }

    return FALLBACK_TIMEZONE;
  }
}
