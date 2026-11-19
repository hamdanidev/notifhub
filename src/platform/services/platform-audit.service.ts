import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { RequestContext } from '../../common/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ListAuditQueryDto,
  PlatformAuditEventDto,
  PlatformAuditListResponseDto,
} from '../dto/tenant.dto';
import {
  PLATFORM_AUDIT_DEFAULT_LIMIT,
  PLATFORM_AUDIT_MAX_LIMIT,
  type PlatformAuditAction,
} from '../platform.constants';

export interface PlatformAuditActor {
  adminId: string;
  email: string;
}

export interface PlatformAuditContext {
  ip?: string;
  requestId?: string;
}

export interface RecordAuditInput {
  actor: PlatformAuditActor;
  action: PlatformAuditAction;
  targetType: 'tenant' | 'admin';
  targetId: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
  context?: PlatformAuditContext;
}

/** Request metadata attached to audit entries. */
export function auditContextFrom(request: Request): PlatformAuditContext {
  return {
    ip: request.ip ?? undefined,
    requestId: RequestContext.getRequestId(),
  };
}

/**
 * Append-only audit trail for platform-lane mutations.
 *
 * Writes are best-effort: a failed audit insert is logged (with the action and target) but never
 * fails the mutation that already happened. Entries never contain passwords, hashes, API keys, or
 * message contents.
 */
@Injectable()
export class PlatformAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PlatformAuditService.name);
  }

  async record(input: RecordAuditInput): Promise<void> {
    try {
      await this.prisma.platformAuditEvent.create({
        data: {
          actorAdminId: input.actor.adminId,
          actorEmail: input.actor.email,
          action: input.action,
          tenantId: input.tenantId ?? null,
          targetType: input.targetType,
          targetId: input.targetId,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
          ip: input.context?.ip ?? null,
          requestId: input.context?.requestId ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        {
          event: 'platform.audit.failed',
          action: input.action,
          target_type: input.targetType,
          target_id: input.targetId,
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to write platform audit event',
      );
    }
  }

  async list(query: ListAuditQueryDto): Promise<PlatformAuditListResponseDto> {
    const limit = Math.min(query.limit ?? PLATFORM_AUDIT_DEFAULT_LIMIT, PLATFORM_AUDIT_MAX_LIMIT);
    const offset = query.offset ?? 0;
    const where: Prisma.PlatformAuditEventWhereInput = {};

    if (query.tenantId !== undefined) where.tenantId = query.tenantId;
    if (query.action !== undefined) where.action = query.action;

    if (query.from !== undefined || query.to !== undefined) {
      where.occurredAt = {
        ...(query.from === undefined ? {} : { gte: new Date(query.from) }),
        ...(query.to === undefined ? {} : { lte: new Date(query.to) }),
      };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.platformAuditEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.platformAuditEvent.count({ where }),
    ]);

    return {
      items: rows.map(toAuditDto),
      total,
      limit,
      offset,
    };
  }
}

function toAuditDto(row: {
  id: bigint;
  actorAdminId: string;
  actorEmail: string;
  action: string;
  tenantId: string | null;
  targetType: string;
  targetId: string;
  metadata: Prisma.JsonValue | null;
  ip: string | null;
  requestId: string | null;
  occurredAt: Date;
}): PlatformAuditEventDto {
  return {
    id: row.id.toString(),
    actorAdminId: row.actorAdminId,
    actorEmail: row.actorEmail,
    action: row.action,
    tenantId: row.tenantId,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: row.metadata,
    ip: row.ip,
    requestId: row.requestId,
    occurredAt: row.occurredAt.toISOString(),
  };
}
