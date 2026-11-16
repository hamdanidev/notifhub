import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';

const RETENTION_BATCH_SIZE = 1000;
const MILLISECONDS_PER_DAY = 86_400_000;

export interface RetentionResult {
  archived: number;
}

export interface IdempotencyCleanupResult {
  released: number;
}

/**
 * Nightly data lifecycle jobs (PART 1 rules 26 and 27), scheduled in UTC.
 *
 * - retention: soft delete notifications older than RETENTION_DAYS (never hard delete).
 * - idempotency: free expired idempotency keys by rotating them to `expired:<uuid>`, which
 *   preserves the audit row while letting the consumer reuse the original key.
 */
@Injectable()
export class CleanupService {
  private retentionRunning = false;
  private idempotencyRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CleanupService.name);
  }

  @Cron('0 2 * * *', { name: 'retention-cleanup', timeZone: 'UTC' })
  async runRetention(): Promise<RetentionResult> {
    if (this.retentionRunning) {
      return { archived: 0 };
    }

    this.retentionRunning = true;

    try {
      const retentionDays = this.config.getOrThrow<number>('RETENTION_DAYS');
      const cutoff = new Date(Date.now() - retentionDays * MILLISECONDS_PER_DAY);
      const archivedAt = new Date();
      let archived = 0;

      for (;;) {
        const rows = await this.prisma.notification.findMany({
          where: { createdAt: { lt: cutoff }, deletedAt: null },
          select: { id: true },
          take: RETENTION_BATCH_SIZE,
        });

        if (rows.length === 0) {
          break;
        }

        const result = await this.prisma.notification.updateMany({
          where: { id: { in: rows.map((row) => row.id) } },
          data: { deletedAt: archivedAt },
        });

        archived += result.count;

        if (rows.length < RETENTION_BATCH_SIZE) {
          break;
        }
      }

      this.logger.info(
        {
          event: 'notification.retention.archived',
          retention_days: retentionDays,
          cutoff: cutoff.toISOString(),
          archived,
        },
        'retention job soft deleted expired notifications',
      );

      return { archived };
    } finally {
      this.retentionRunning = false;
    }
  }

  @Cron('30 2 * * *', { name: 'idempotency-cleanup', timeZone: 'UTC' })
  async runIdempotencyCleanup(): Promise<IdempotencyCleanupResult> {
    if (this.idempotencyRunning) {
      return { released: 0 };
    }

    this.idempotencyRunning = true;

    try {
      const now = new Date();
      const released = await this.prisma.$executeRaw`
        UPDATE "Notification"
        SET "idempotencyKey" = 'expired:' || "id"::text
        WHERE "idempotencyExpiresAt" < ${now}
          AND "idempotencyKey" NOT LIKE 'expired:%'
      `;

      this.logger.info(
        {
          event: 'notification.idempotency.expired_keys_released',
          released,
        },
        'idempotency cleanup rotated expired keys',
      );

      return { released };
    } finally {
      this.idempotencyRunning = false;
    }
  }
}
