import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  TemplateApprovalStatus,
  TemplateAuditAction,
  TemplateStatus,
} from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import type { AdminPrincipal } from '../../auth/admin/admin.types';
import {
  decidePublishApproval,
  normalizeSelfApprovalReason,
  type ApprovalMode,
  type PublishApprovalState,
  type PublishApprovalStatus,
} from '../../templates/template.approval';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ApprovalNoteDto,
  ApprovalQueueQueryDto,
  RejectApprovalDto,
  SubmitReviewDto,
} from '../dto/template-approval.dto';
import { AdminAuditService } from './admin-audit.service';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface TemplateApprovalView {
  id: string;
  templateId: string;
  templateVersion: number;
  revision: number;
  status: TemplateApprovalStatus;
  requestedBy: { adminId: string; email: string };
  requestedNote: string | null;
  reviewedBy: { adminId: string; email: string } | null;
  reviewNote: string | null;
  selfApproved: boolean;
  selfApprovalReason: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  stale: boolean;
}

export interface ApprovalQueueItem extends TemplateApprovalView {
  templateKey: string;
  channel: string;
  locale: string;
  templateSubject: string | null;
  templateStatus: TemplateStatus;
  templateActive: boolean;
}

export interface TemplateApprovalListResult {
  items: TemplateApprovalView[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApprovalQueueResult {
  items: ApprovalQueueItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface PublishApproval {
  approvalId: string | null;
  selfApproval: boolean;
  reason: string | null;
}

interface ApprovalRow {
  id: string;
  templateId: string;
  templateVersion: number;
  revision: number;
  status: TemplateApprovalStatus;
  requestedByAdminId: string;
  requestedByEmail: string;
  requestedNote: string | null;
  reviewedByAdminId: string | null;
  reviewedByEmail: string | null;
  reviewNote: string | null;
  selfApproved: boolean;
  selfApprovalReason: string | null;
  requestedAt: Date;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface PublishableTemplate {
  id: string;
  revision: number;
  version: number;
  status: TemplateStatus;
}

@Injectable()
export class AdminTemplateApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminTemplateApprovalsService.name);
  }

  async submit(
    tenantId: string,
    admin: AdminPrincipal,
    templateId: string,
    dto: SubmitReviewDto,
  ): Promise<TemplateApprovalView> {
    const template = await this.prisma.notificationTemplate.findFirst({
      where: { id: templateId, tenantId },
      select: { id: true, revision: true, version: true, status: true },
    });

    if (template === null) {
      throw new NotFoundException('Template not found');
    }

    if (template.status !== TemplateStatus.draft) {
      throw conflict('only drafts can be reviewed', {
        code: 'only_drafts_can_be_reviewed',
      });
    }

    if (template.revision !== dto.expectedRevision) {
      throw conflict(
        `template revision changed (expected ${dto.expectedRevision}, current ${template.revision})`,
        { code: 'template_conflict' },
      );
    }

    const approvers = await this.countApprovers(tenantId);

    if (approvers === 0) {
      throw conflict(
        'Tenant belum punya approver aktif; tambahkan akun approver sebelum mengajukan review.',
        { code: 'approver_unavailable' },
      );
    }

    const existing = await this.prisma.templateApproval.findUnique({
      where: { templateId_revision: { templateId, revision: template.revision } },
    });

    if (existing !== null && existing.status !== TemplateApprovalStatus.rejected) {
      throw conflict('Approval untuk revisi ini sudah ada.', {
        code: 'approval_exists',
        status: existing.status,
      });
    }

    const row =
      existing === null
        ? await this.prisma.templateApproval.create({
            data: {
              tenantId,
              templateId,
              templateVersion: template.version,
              revision: template.revision,
              status: TemplateApprovalStatus.pending,
              requestedByAdminId: admin.adminId,
              requestedByEmail: admin.email,
              requestedNote: dto.note ?? null,
            },
          })
        : await this.prisma.templateApproval.update({
            where: { id: existing.id },
            data: {
              status: TemplateApprovalStatus.pending,
              requestedByAdminId: admin.adminId,
              requestedByEmail: admin.email,
              requestedNote: dto.note ?? null,
              reviewedByAdminId: null,
              reviewedByEmail: null,
              reviewNote: null,
              selfApproved: false,
              selfApprovalReason: null,
              requestedAt: new Date(),
              reviewedAt: null,
            },
          });

    await this.prisma.templateAuditEvent.create({
      data: {
        tenantId,
        templateId,
        templateVersion: template.version,
        action:
          existing === null
            ? TemplateAuditAction.submitted_for_review
            : TemplateAuditAction.approval_reopened,
        actorAdminId: admin.adminId,
        actorEmail: admin.email,
        note: dto.note ?? null,
        metadata: { revision: template.revision, approvalId: row.id },
      },
    });

    await this.audit.record({
      tenantId,
      actor: { adminId: admin.adminId, email: admin.email },
      action:
        existing === null ? 'template.submitted_for_review' : 'template.approval_reopened',
      targetType: 'template',
      targetId: templateId,
      metadata: { revision: template.revision, approvalId: row.id },
    });

    this.logger.info(
      {
        event: 'template.approval.submitted',
        tenant_id: tenantId,
        template_id: templateId,
        approval_id: row.id,
        revision: template.revision,
      },
      'template submitted for review',
    );

    return toView(row, template.revision);
  }

  async listForTemplate(
    tenantId: string,
    templateId: string,
    query: ApprovalQueueQueryDto,
  ): Promise<TemplateApprovalListResult> {
    const template = await this.prisma.notificationTemplate.findFirst({
      where: { id: templateId, tenantId },
      select: { id: true, revision: true },
    });

    if (template === null) {
      throw new NotFoundException('Template not found');
    }

    const limit = clampLimit(query.limit);
    const offset = query.offset ?? 0;
    const where: Prisma.TemplateApprovalWhereInput = {
      tenantId,
      templateId,
      ...(query.status === undefined ? {} : { status: query.status }),
    };

    const [total, rows] = await Promise.all([
      this.prisma.templateApproval.count({ where }),
      this.prisma.templateApproval.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip: offset,
        take: limit,
      }),
    ]);

    return {
      items: rows.map((row) => toView(row, template.revision)),
      total,
      limit,
      offset,
    };
  }

  async queue(tenantId: string, query: ApprovalQueueQueryDto): Promise<ApprovalQueueResult> {
    const limit = clampLimit(query.limit);
    const offset = query.offset ?? 0;
    const where: Prisma.TemplateApprovalWhereInput = {
      tenantId,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.templateId === undefined ? {} : { templateId: query.templateId }),
    };

    const [total, rows] = await Promise.all([
      this.prisma.templateApproval.count({ where }),
      this.prisma.templateApproval.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          template: {
            select: {
              key: true,
              channel: true,
              locale: true,
              subject: true,
              revision: true,
              status: true,
              active: true,
            },
          },
        },
      }),
    ]);

    return {
      items: rows.map((row) => ({
        ...toView(row, row.template.revision),
        templateKey: row.template.key,
        channel: row.template.channel,
        locale: row.template.locale,
        templateSubject: row.template.subject,
        templateStatus: row.template.status,
        templateActive: row.template.active,
      })),
      total,
      limit,
      offset,
    };
  }

  async approve(
    tenantId: string,
    admin: AdminPrincipal,
    approvalId: string,
    dto: ApprovalNoteDto,
  ): Promise<TemplateApprovalView> {
    const approval = await this.loadPending(tenantId, approvalId);

    if (approval.requestedByAdminId === admin.adminId) {
      throw conflict('Pengaju tidak boleh menyetujui approval-nya sendiri.', {
        code: 'approval_self_forbidden',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.templateApproval.update({
        where: { id: approval.id },
        data: {
          status: TemplateApprovalStatus.approved,
          reviewedByAdminId: admin.adminId,
          reviewedByEmail: admin.email,
          reviewNote: dto.note ?? null,
          reviewedAt: new Date(),
        },
      });

      await tx.templateAuditEvent.create({
        data: {
          tenantId,
          templateId: approval.templateId,
          templateVersion: approval.templateVersion,
          action: TemplateAuditAction.approved,
          actorAdminId: admin.adminId,
          actorEmail: admin.email,
          note: dto.note ?? null,
          metadata: { revision: approval.revision, approvalId: approval.id },
        },
      });

      return row;
    });

    await this.audit.record({
      tenantId,
      actor: { adminId: admin.adminId, email: admin.email },
      action: 'template.approved',
      targetType: 'template',
      targetId: approval.templateId,
      metadata: { revision: approval.revision, approvalId: approval.id },
    });

    this.logger.info(
      {
        event: 'template.approval.approved',
        tenant_id: tenantId,
        template_id: approval.templateId,
        approval_id: approval.id,
        revision: approval.revision,
      },
      'template approval approved',
    );

    return toView(updated, approval.templateRevision);
  }

  async reject(
    tenantId: string,
    admin: AdminPrincipal,
    approvalId: string,
    dto: RejectApprovalDto,
  ): Promise<TemplateApprovalView> {
    const approval = await this.loadPending(tenantId, approvalId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.templateApproval.update({
        where: { id: approval.id },
        data: {
          status: TemplateApprovalStatus.rejected,
          reviewedByAdminId: admin.adminId,
          reviewedByEmail: admin.email,
          reviewNote: dto.note,
          reviewedAt: new Date(),
        },
      });

      await tx.templateAuditEvent.create({
        data: {
          tenantId,
          templateId: approval.templateId,
          templateVersion: approval.templateVersion,
          action: TemplateAuditAction.rejected,
          actorAdminId: admin.adminId,
          actorEmail: admin.email,
          note: dto.note,
          metadata: { revision: approval.revision, approvalId: approval.id },
        },
      });

      return row;
    });

    await this.audit.record({
      tenantId,
      actor: { adminId: admin.adminId, email: admin.email },
      action: 'template.rejected',
      targetType: 'template',
      targetId: approval.templateId,
      metadata: { revision: approval.revision, approvalId: approval.id },
    });

    this.logger.info(
      {
        event: 'template.approval.rejected',
        tenant_id: tenantId,
        template_id: approval.templateId,
        approval_id: approval.id,
        revision: approval.revision,
      },
      'template approval rejected',
    );

    return toView(updated, approval.templateRevision);
  }

  /**
   * Read-only gate used before content validation. Returns what the publish transaction must
   * record; throws `409`/`400` with a `details.code` when publishing is not allowed.
   */
  async assertPublishable(
    tenantId: string,
    template: PublishableTemplate,
    admin: AdminPrincipal,
    selfApprovalReason?: string,
  ): Promise<PublishApproval> {
    const mode = await this.tenantMode(tenantId);
    const approvalForRevision = await this.prisma.templateApproval.findUnique({
      where: { templateId_revision: { templateId: template.id, revision: template.revision } },
    });
    // A newer revision after an approved review must surface as `approval_stale`, not as "no
    // approval yet": the publisher edited content that a reviewer already approved.
    const approval =
      approvalForRevision ??
      (await this.prisma.templateApproval.findFirst({
        where: {
          tenantId,
          templateId: template.id,
          status: TemplateApprovalStatus.approved,
        },
        orderBy: { revision: 'desc' },
      }));
    const hasApprover = (await this.countApprovers(tenantId)) > 0;
    const approvalStatus = approval?.status ?? 'none';

    if (mode === 'two_person' && normalizeSelfApprovalReason(selfApprovalReason) !== null) {
      throw badRequest(
        'self_approval_not_allowed',
        'Mode approval tenant mewajibkan persetujuan akun kedua.',
      );
    }

    const decision = decidePublishApproval({
      mode,
      hasApprover,
      approvalStatus: approvalStatus as PublishApprovalStatus,
      approvalRevision: approval?.revision,
      templateRevision: template.revision,
      requesterAdminId: approval?.requestedByAdminId ?? admin.adminId,
      reviewerAdminId: approval?.reviewedByAdminId ?? null,
      selfApprovalReason: selfApprovalReason ?? null,
    } satisfies PublishApprovalState);

    if (decision.allowed) {
      return {
        approvalId: decision.selfApproval ? null : (approval?.id ?? null),
        selfApproval: decision.selfApproval,
        reason: decision.reason,
      };
    }

    if (
      decision.code === 'self_approval_reason_required' ||
      decision.code === 'self_approval_not_allowed'
    ) {
      throw badRequest(decision.code, messageFor(decision.code));
    }

    throw conflict(messageFor(decision.code), {
      code: decision.code,
      revision: template.revision,
      approvalStatus,
    });
  }

  /** Creates the self-approved row inside the publish transaction. */
  async recordSelfApproval(
    tx: Prisma.TransactionClient,
    tenantId: string,
    template: PublishableTemplate,
    admin: AdminPrincipal,
    reason: string,
  ): Promise<string> {
    const normalized = normalizeSelfApprovalReason(reason);

    if (normalized === null) {
      throw badRequest('self_approval_reason_required', messageFor('self_approval_reason_required'));
    }

    const now = new Date();
    const row = await tx.templateApproval.create({
      data: {
        tenantId,
        templateId: template.id,
        templateVersion: template.version,
        revision: template.revision,
        status: TemplateApprovalStatus.approved,
        requestedByAdminId: admin.adminId,
        requestedByEmail: admin.email,
        reviewedByAdminId: admin.adminId,
        reviewedByEmail: admin.email,
        selfApproved: true,
        selfApprovalReason: normalized,
        requestedAt: now,
        reviewedAt: now,
      },
    });

    await tx.templateAuditEvent.create({
      data: {
        tenantId,
        templateId: template.id,
        templateVersion: template.version,
        action: TemplateAuditAction.approved,
        actorAdminId: admin.adminId,
        actorEmail: admin.email,
        metadata: { revision: template.revision, approvalId: row.id, selfApproval: true },
      },
    });

    return row.id;
  }

  private async loadPending(
    tenantId: string,
    approvalId: string,
  ): Promise<{
    id: string;
    templateId: string;
    templateVersion: number;
    revision: number;
    requestedByAdminId: string;
    templateRevision: number;
  }> {
    const approval = await this.prisma.templateApproval.findFirst({
      where: { id: approvalId, tenantId },
      include: {
        template: { select: { revision: true, status: true } },
      },
    });

    if (approval === null) {
      throw new NotFoundException('Approval not found');
    }

    if (approval.status !== TemplateApprovalStatus.pending) {
      throw conflict('Approval sudah diproses.', { code: 'approval_not_pending' });
    }

    if (approval.template.status !== TemplateStatus.draft) {
      throw conflict('Hanya draft yang dapat direview.', { code: 'only_drafts_can_be_reviewed' });
    }

    if (approval.template.revision !== approval.revision) {
      throw conflict('Draft berubah setelah diajukan; minta review ulang.', {
        code: 'approval_revision_mismatch',
        approvalRevision: approval.revision,
        templateRevision: approval.template.revision,
      });
    }

    return {
      id: approval.id,
      templateId: approval.templateId,
      templateVersion: approval.templateVersion,
      revision: approval.revision,
      requestedByAdminId: approval.requestedByAdminId,
      templateRevision: approval.template.revision,
    };
  }

  private async countApprovers(tenantId: string): Promise<number> {
    return this.prisma.adminUser.count({
      where: { tenantId, role: 'tenant_approver', active: true },
    });
  }

  private async tenantMode(tenantId: string): Promise<ApprovalMode> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { templateApprovalMode: true },
    });

    return tenant?.templateApprovalMode ?? 'two_person';
  }
}

function toView(row: ApprovalRow, templateRevision: number): TemplateApprovalView {
  return {
    id: row.id,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    revision: row.revision,
    status: row.status,
    requestedBy: { adminId: row.requestedByAdminId, email: row.requestedByEmail },
    requestedNote: row.requestedNote,
    reviewedBy:
      row.reviewedByAdminId !== null && row.reviewedByEmail !== null
        ? { adminId: row.reviewedByAdminId, email: row.reviewedByEmail }
        : null,
    reviewNote: row.reviewNote,
    selfApproved: row.selfApproved,
    selfApprovalReason: row.selfApprovalReason,
    requestedAt: row.requestedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    stale: row.revision !== templateRevision,
  };
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }

  return Math.min(MAX_LIMIT, Math.max(1, value));
}

function conflict(message: string, details: Record<string, unknown>): ConflictException {
  return new ConflictException({ message, details });
}

function badRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ message, details: { code } });
}

function messageFor(code: string): string {
  switch (code) {
    case 'approver_unavailable':
      return 'Tenant belum punya approver aktif; publish memerlukan akun approver.';
    case 'approval_required':
      return 'Template belum disetujui untuk revisi ini; ajukan review lalu minta approver menyetujui.';
    case 'approval_pending':
      return 'Template masih menunggu review approver.';
    case 'approval_rejected':
      return 'Review template ditolak; perbaiki draft atau ajukan ulang.';
    case 'approval_stale':
      return 'Draft berubah setelah disetujui; ajukan review ulang untuk revisi terbaru.';
    case 'approval_self_forbidden':
      return 'Pengaju dan penyetuju tidak boleh akun yang sama.';
    case 'self_approval_reason_required':
      return 'Self-approval memerlukan alasan minimal 20 karakter.';
    case 'self_approval_not_allowed':
      return 'Mode approval tenant mewajibkan persetujuan akun kedua.';
    default:
      return 'Publish template tidak diizinkan.';
  }
}
