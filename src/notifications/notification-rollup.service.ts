import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OverallStatus } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';

const ROLLUP_BATCH_SIZE = 200;

export interface RollupCycleResult {
  processed: number;
  updated: number;
}

export interface RecipientStatusCounts {
  pending: number;
  sent: number;
  read: number;
  failed: number;
  skipped: number;
}

/**
 * Scheduled rollup for Notification.overallStatus (PART 1 rule 19).
 *
 * A keyset sweep processes pending/partial notifications in batches, so a single cron tick
 * never scans the whole table. The rule table lives in computeOverallStatus and treats
 * skipped recipients as neutral.
 */
@Injectable()
export class NotificationRollupService {
  private lastSeenId: string | undefined;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(NotificationRollupService.name);
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'notification-rollup', timeZone: 'UTC' })
  async runCycle(): Promise<RollupCycleResult> {
    if (this.running) {
      return { processed: 0, updated: 0 };
    }

    this.running = true;
    let processed = 0;
    let updated = 0;

    try {
      for (;;) {
        const batch = await this.prisma.notification.findMany({
          where: {
            overallStatus: { in: [OverallStatus.pending, OverallStatus.partial] },
            ...(this.lastSeenId === undefined ? {} : { id: { gt: this.lastSeenId } }),
          },
          orderBy: { id: 'asc' },
          take: ROLLUP_BATCH_SIZE,
          select: { id: true },
        });

        if (batch.length === 0) {
          this.lastSeenId = undefined;
          break;
        }

        for (const row of batch) {
          processed += 1;
          this.lastSeenId = row.id;

          if (await this.recompute(row.id)) {
            updated += 1;
          }
        }

        if (batch.length < ROLLUP_BATCH_SIZE) {
          this.lastSeenId = undefined;
          break;
        }
      }

      if (processed > 0) {
        this.logger.info(
          { event: 'notification.rollup.cycle', processed, updated },
          'notification overallStatus rollup cycle finished',
        );
      }

      return { processed, updated };
    } finally {
      this.running = false;
    }
  }

  /** Recomputes overallStatus for one notification. Returns true when the row changed. */
  async recompute(notificationId: string): Promise<boolean> {
    const [groups, notification] = await Promise.all([
      this.prisma.notificationRecipient.groupBy({
        by: ['status'],
        where: { notificationId },
        _count: { _all: true },
      }),
      this.prisma.notification.findUnique({
        where: { id: notificationId },
        select: { overallStatus: true },
      }),
    ]);

    if (notification === null) {
      return false;
    }

    const counts: RecipientStatusCounts = {
      pending: 0,
      sent: 0,
      read: 0,
      failed: 0,
      skipped: 0,
    };

    for (const group of groups) {
      counts[group.status] = group._count._all;
    }

    const next = computeOverallStatus(counts);

    if (notification.overallStatus === next) {
      return false;
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { overallStatus: next },
    });

    this.logger.info(
      {
        event: 'notification.rollup.updated',
        notification_id: notificationId,
        previous_status: notification.overallStatus,
        overall_status: next,
        counts,
      },
      'notification overallStatus updated',
    );

    return true;
  }
}

/**
 * Rule table for overallStatus:
 * - pending only -> pending
 * - any pending with some result -> partial
 * - all terminal: success only -> sent; success + failed -> partial;
 *   failed only or all skipped -> failed
 */
export function computeOverallStatus(counts: RecipientStatusCounts): OverallStatus {
  const success = counts.sent + counts.read;
  const terminal = success + counts.failed + counts.skipped;

  if (counts.pending > 0) {
    return success > 0 || counts.failed > 0 ? OverallStatus.partial : OverallStatus.pending;
  }

  if (terminal === 0) {
    return OverallStatus.pending;
  }

  if (success > 0) {
    return counts.failed > 0 ? OverallStatus.partial : OverallStatus.sent;
  }

  return OverallStatus.failed;
}
