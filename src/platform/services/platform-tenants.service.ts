import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TemplateApprovalMode } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListTenantsQueryDto, TenantDto, TenantListResponseDto } from '../dto/tenant.dto';
import {
  TENANT_DEFAULT_LIST_LIMIT,
  TENANT_MAX_LIST_LIMIT,
} from '../platform.constants';
import {
  PlatformAuditService,
  type PlatformAuditActor,
  type PlatformAuditContext,
} from './platform-audit.service';

const TENANT_COUNT_SELECT = {
  _count: { select: { adminUsers: true, apiKeys: true } },
} satisfies Prisma.TenantInclude;

@Injectable()
export class PlatformTenantsService {
  private readonly defaultTenantId: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly audit: PlatformAuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PlatformTenantsService.name);
    this.defaultTenantId = config.getOrThrow<string>('DEFAULT_TENANT_ID');
  }

  async list(query: ListTenantsQueryDto): Promise<TenantListResponseDto> {
    const limit = Math.min(query.limit ?? TENANT_DEFAULT_LIST_LIMIT, TENANT_MAX_LIST_LIMIT);
    const offset = query.offset ?? 0;
    const where: Prisma.TenantWhereInput = {};

    if (query.status !== undefined) where.status = query.status;

    if (query.q !== undefined && query.q.trim().length > 0) {
      const q = query.q.trim();
      where.OR = [
        { id: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: TENANT_COUNT_SELECT,
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return { items: rows.map(toTenantDto), total, limit, offset };
  }

  async get(id: string): Promise<TenantDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: TENANT_COUNT_SELECT,
    });

    if (tenant === null) {
      throw new NotFoundException('tenant_not_found');
    }

    return toTenantDto(tenant);
  }

  async create(
    input: { id: string; name: string },
    actor: PlatformAuditActor,
    context: PlatformAuditContext,
  ): Promise<TenantDto> {
    const existing = await this.prisma.tenant.findUnique({
      where: { id: input.id },
      select: { id: true },
    });

    if (existing !== null) {
      throw new ConflictException('tenant_exists');
    }

    const tenant = await this.prisma.tenant
      .create({
        data: { id: input.id, name: input.name },
        include: TENANT_COUNT_SELECT,
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ConflictException('tenant_exists');
        }

        throw error;
      });

    await this.audit.record({
      actor,
      action: 'tenant.created',
      tenantId: tenant.id,
      targetType: 'tenant',
      targetId: tenant.id,
      metadata: { name: tenant.name },
      context,
    });

    this.logger.info(
      { event: 'platform.tenant.created', tenant_id: tenant.id },
      'tenant created',
    );

    return toTenantDto(tenant);
  }

  async update(
    id: string,
    input: { name?: string; templateApprovalMode?: TemplateApprovalMode },
    actor: PlatformAuditActor,
    context: PlatformAuditContext,
  ): Promise<TenantDto> {
    const existing = await this.requireTenant(id);
    const data: { name?: string; templateApprovalMode?: TemplateApprovalMode } = {};

    if (input.name !== undefined && input.name !== existing.name) {
      data.name = input.name;
    }

    if (
      input.templateApprovalMode !== undefined &&
      input.templateApprovalMode !== existing.templateApprovalMode
    ) {
      data.templateApprovalMode = input.templateApprovalMode;
    }

    if (Object.keys(data).length === 0) {
      return this.get(id);
    }

    await this.prisma.tenant.update({ where: { id }, data });

    if (data.name !== undefined) {
      await this.audit.record({
        actor,
        action: 'tenant.renamed',
        tenantId: id,
        targetType: 'tenant',
        targetId: id,
        metadata: { from: existing.name, to: data.name },
        context,
      });
    }

    if (data.templateApprovalMode !== undefined) {
      await this.audit.record({
        actor,
        action: 'tenant.approval_mode.changed',
        tenantId: id,
        targetType: 'tenant',
        targetId: id,
        metadata: {
          from: existing.templateApprovalMode,
          to: data.templateApprovalMode,
        },
        context,
      });
    }

    return this.get(id);
  }

  async suspend(
    id: string,
    actor: PlatformAuditActor,
    context: PlatformAuditContext,
  ): Promise<TenantDto> {
    const tenant = await this.requireTenant(id);

    if (tenant.status === 'suspended') {
      return this.get(id);
    }

    await this.prisma.tenant.update({
      where: { id },
      data: { status: 'suspended', suspendedAt: new Date() },
    });

    await this.audit.record({
      actor,
      action: 'tenant.suspended',
      tenantId: id,
      targetType: 'tenant',
      targetId: id,
      context,
    });

    this.logger.info(
      { event: 'platform.tenant.suspended', tenant_id: id },
      'tenant suspended',
    );

    return this.get(id);
  }

  async resume(
    id: string,
    actor: PlatformAuditActor,
    context: PlatformAuditContext,
  ): Promise<TenantDto> {
    const tenant = await this.requireTenant(id);

    if (tenant.status === 'active') {
      return this.get(id);
    }

    await this.prisma.tenant.update({
      where: { id },
      data: { status: 'active', suspendedAt: null },
    });

    await this.audit.record({
      actor,
      action: 'tenant.resumed',
      tenantId: id,
      targetType: 'tenant',
      targetId: id,
      context,
    });

    this.logger.info(
      { event: 'platform.tenant.resumed', tenant_id: id },
      'tenant resumed',
    );

    return this.get(id);
  }

  async remove(
    id: string,
    actor: PlatformAuditActor,
    context: PlatformAuditContext,
  ): Promise<void> {
    if (id === this.defaultTenantId) {
      throw new ForbiddenException('tenant_protected');
    }

    const tenant = await this.requireTenant(id);

    if (await this.hasTenantData(id)) {
      throw new ConflictException('tenant_not_empty');
    }

    try {
      await this.prisma.tenant.delete({ where: { id } });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException('tenant_not_empty');
      }

      throw error;
    }

    await this.audit.record({
      actor,
      action: 'tenant.deleted',
      tenantId: id,
      targetType: 'tenant',
      targetId: id,
      metadata: { name: tenant.name },
      context,
    });

    this.logger.info({ event: 'platform.tenant.deleted', tenant_id: id }, 'tenant deleted');
  }

  private async requireTenant(id: string): Promise<{
    id: string;
    name: string;
    status: string;
    templateApprovalMode: TemplateApprovalMode;
  }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, templateApprovalMode: true },
    });

    if (tenant === null) {
      throw new NotFoundException('tenant_not_found');
    }

    return tenant;
  }

  private async hasTenantData(tenantId: string): Promise<boolean> {
    const counts = await this.prisma.$transaction([
      this.prisma.adminUser.count({ where: { tenantId } }),
      this.prisma.apiKey.count({ where: { tenantId } }),
      this.prisma.subscriber.count({ where: { tenantId } }),
      this.prisma.notification.count({ where: { tenantId } }),
      this.prisma.notificationTemplate.count({ where: { tenantId } }),
      this.prisma.notificationPreference.count({ where: { tenantId } }),
      this.prisma.topic.count({ where: { tenantId } }),
      this.prisma.billingEvent.count({ where: { tenantId } }),
      this.prisma.templateLayout.count({ where: { tenantId } }),
      this.prisma.templateTheme.count({ where: { tenantId } }),
      this.prisma.templatePartial.count({ where: { tenantId } }),
      this.prisma.templateAuditEvent.count({ where: { tenantId } }),
      this.prisma.templateTestSend.count({ where: { tenantId } }),
      this.prisma.templateImage.count({ where: { tenantId } }),
    ]);

    return counts.some((count) => count > 0);
  }
}

function toTenantDto(tenant: {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  suspendedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { adminUsers: number; apiKeys: number };
  templateApprovalMode: TemplateApprovalMode;
}): TenantDto {
  return {
    id: tenant.id,
    name: tenant.name,
    status: tenant.status,
    suspendedAt: tenant.suspendedAt?.toISOString() ?? null,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
    templateApprovalMode: tenant.templateApprovalMode,
    adminCount: tenant._count.adminUsers,
    apiKeyCount: tenant._count.apiKeys,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2003'
  );
}
