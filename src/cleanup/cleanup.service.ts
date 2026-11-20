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

export interface TemplateTelemetryCleanupResult {
  auditDeleted: number;
  testSendDeleted: number;
}

export interface AdminAuditCleanupResult {
  deleted: number;
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
  private telemetryRunning = false;
  private adminAuditRunning = false;

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

  /**
   * Template telemetry retention. Test sends are operational metadata and are deleted after the
   * configured window; audit events default to a longer window because they are compliance
   * evidence. `0` disables a window. This job never reads row contents into logs.
   */
  @Cron('0 3 * * *', { name: 'template-telemetry-cleanup', timeZone: 'UTC' })
  async runTemplateTelemetryCleanup(): Promise<TemplateTelemetryCleanupResult> {
    if (this.telemetryRunning) {
      return { auditDeleted: 0, testSendDeleted: 0 };
    }

    this.telemetryRunning = true;

    try {
      const testSendDays = this.config.getOrThrow<number>(
        'TEMPLATE_TEST_SEND_RETENTION_DAYS',
      );
      const auditDays = this.config.getOrThrow<number>('TEMPLATE_AUDIT_RETENTION_DAYS');
      const now = Date.now();
      const testSendDeleted =
        testSendDays === 0
          ? 0
          : await this.deleteTemplateTestSendsBefore(
              new Date(now - testSendDays * MILLISECONDS_PER_DAY),
            );
      const auditDeleted =
        auditDays === 0
          ? 0
          : await this.deleteTemplateAuditEventsBefore(
              new Date(now - auditDays * MILLISECONDS_PER_DAY),
            );

      this.logger.info(
        {
          event: 'template.telemetry.cleanup',
          test_send_retention_days: testSendDays,
          audit_retention_days: auditDays,
          test_send_deleted: testSendDeleted,
          audit_deleted: auditDeleted,
        },
        'template telemetry retention job completed',
      );

      return { auditDeleted, testSendDeleted };
    } finally {
      this.telemetryRunning = false;
    }
  }

  /**
   * Admin audit retention. `AdminAuditEvent` is compliance evidence, so the default window is
   * longer than template telemetry and `0` disables deletion entirely. Batches keep transactions
   * short on large tables; logs contain counts and the cutoff only, never event metadata.
   */
  @Cron('45 3 * * *', { name: 'admin-audit-cleanup', timeZone: 'UTC' })
  async runAdminAuditCleanup(): Promise<AdminAuditCleanupResult> {
    if (this.adminAuditRunning) {
      return { deleted: 0 };
    }

    this.adminAuditRunning = true;

    try {
      const retentionDays = this.config.getOrThrow<number>('ADMIN_AUDIT_RETENTION_DAYS');
      const cutoff =
        retentionDays === 0
          ? null
          : new Date(Date.now() - retentionDays * MILLISECONDS_PER_DAY);
      const deleted =
        cutoff === null ? 0 : await this.deleteAdminAuditEventsBefore(cutoff);

      this.logger.info(
        {
          event: 'admin.audit.cleanup',
          retention_days: retentionDays,
          cutoff: cutoff === null ? null : cutoff.toISOString(),
          deleted,
        },
        'admin audit retention job completed',
      );

      return { deleted };
    } finally {
      this.adminAuditRunning = false;
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

  private async deleteTemplateTestSendsBefore(cutoff: Date): Promise<number> {
    let deleted = 0;

    for (;;) {
      const rows = await this.prisma.templateTestSend.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        take: RETENTION_BATCH_SIZE,
      });

      if (rows.length === 0) {
        break;
      }

      const result = await this.prisma.templateTestSend.deleteMany({
        where: { id: { in: rows.map((row) => row.id) } },
      });

      deleted += result.count;

      if (rows.length < RETENTION_BATCH_SIZE) {
        break;
      }
    }

    return deleted;
  }

  private async deleteTemplateAuditEventsBefore(cutoff: Date): Promise<number> {
    let deleted = 0;

    for (;;) {
      const rows = await this.prisma.templateAuditEvent.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        take: RETENTION_BATCH_SIZE,
      });

      if (rows.length === 0) {
        break;
      }

      const result = await this.prisma.templateAuditEvent.deleteMany({
        where: { id: { in: rows.map((row) => row.id) } },
      });

      deleted += result.count;

      if (rows.length < RETENTION_BATCH_SIZE) {
        break;
      }
    }

    return deleted;
  }

  private async deleteAdminAuditEventsBefore(cutoff: Date): Promise<number> {
    let deleted = 0;

    for (;;) {
      const rows = await this.prisma.adminAuditEvent.findMany({
        where: { occurredAt: { lt: cutoff } },
        select: { id: true },
        take: RETENTION_BATCH_SIZE,
      });

      if (rows.length === 0) {
        break;
      }

      const result = await this.prisma.adminAuditEvent.deleteMany({
        where: { id: { in: rows.map((row) => row.id) } },
      });

      deleted += result.count;

      if (rows.length < RETENTION_BATCH_SIZE) {
        break;
      }
    }

    return deleted;
  }
}
