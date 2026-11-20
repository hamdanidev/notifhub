import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { RequestContext } from '../../common/request-context';
import type { RequestWithId } from '../../common/middleware/request-id.middleware';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ADMIN_AUDIT_DEFAULT_LIMIT,
  ADMIN_AUDIT_MAX_LIMIT,
  type AdminAuditEventDto,
  type AdminAuditListResponseDto,
  type AdminAuditQueryDto,
} from '../dto/admin-audit.dto';

export interface AdminAuditActor {
  adminId: string;
  email: string;
}

export interface AdminAuditContext {
  ip?: string;
  requestId?: string;
}

export interface RecordAdminAuditInput {
  tenantId: string;
  actor: AdminAuditActor;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  context?: AdminAuditContext;
}

export function adminAuditContextFrom(request: RequestWithId | Request): AdminAuditContext {
  return {
    ip: request.ip ?? undefined,
    requestId:
      (request as RequestWithId).requestId ?? RequestContext.getRequestId() ?? undefined,
  };
}

/**
 * Append-only audit trail for tenant-admin mutations.
 *
 * Writes are best-effort: an insert failure is logged but never fails the mutation that already
 * happened. Callers must never pass passwords, hashes, API keys, tokens, or message contents.
 */
@Injectable()
export class AdminAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminAuditService.name);
  }

  async record(input: RecordAdminAuditInput): Promise<void> {
    try {
      await this.prisma.adminAuditEvent.create({
        data: {
          tenantId: input.tenantId,
          actorAdminId: input.actor.adminId,
          actorEmail: input.actor.email,
          action: input.action,
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
          event: 'admin.audit.failed',
          action: input.action,
          target_type: input.targetType,
          target_id: input.targetId,
          err: error instanceof Error ? error.message : String(error),
        },
        'failed to write admin audit event',
      );
    }
  }

  async list(
    tenantId: string,
    query: AdminAuditQueryDto,
  ): Promise<AdminAuditListResponseDto> {
    const limit = Math.min(query.limit ?? ADMIN_AUDIT_DEFAULT_LIMIT, ADMIN_AUDIT_MAX_LIMIT);
    const offset = query.offset ?? 0;
    const where: Prisma.AdminAuditEventWhereInput = { tenantId };

    if (query.action !== undefined) where.action = query.action;

    if (query.from !== undefined || query.to !== undefined) {
      where.occurredAt = {
        ...(query.from === undefined ? {} : { gte: new Date(query.from) }),
        ...(query.to === undefined ? {} : { lte: new Date(query.to) }),
      };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.adminAuditEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.adminAuditEvent.count({ where }),
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
  targetType: string;
  targetId: string;
  metadata: Prisma.JsonValue | null;
  ip: string | null;
  requestId: string | null;
  occurredAt: Date;
}): AdminAuditEventDto {
  return {
    id: row.id.toString(),
    actorAdminId: row.actorAdminId,
    actorEmail: row.actorEmail,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    metadata: row.metadata,
    ip: row.ip,
    requestId: row.requestId,
    occurredAt: row.occurredAt.toISOString(),
  };
}
