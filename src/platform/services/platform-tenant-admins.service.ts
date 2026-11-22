import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateTenantAdminDto,
  TenantAdminDto,
  UpdateTenantAdminDto,
} from '../dto/tenant.dto';
import {
  PlatformAuditService,
  type PlatformAuditActor,
  type PlatformAuditContext,
} from './platform-audit.service';

const TENANT_ADMIN_ROLE = 'tenant_admin';
const TENANT_APPROVER_ROLE = 'tenant_approver';

@Injectable()
export class PlatformTenantAdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PlatformTenantAdminsService.name);
  }

  async list(tenantId: string): Promise<TenantAdminDto[]> {
    await this.requireTenant(tenantId);

    const admins = await this.prisma.adminUser.findMany({
      where: { tenantId, role: { in: [TENANT_ADMIN_ROLE, TENANT_APPROVER_ROLE] } },
      orderBy: { email: 'asc' },
    });

    return admins.map(toAdminDto);
  }

  async create(
    tenantId: string,
    dto: CreateTenantAdminDto,
    actor: PlatformAuditActor,
    context: PlatformAuditContext,
  ): Promise<TenantAdminDto> {
    await this.requireTenant(tenantId);

    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.adminUser.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existing !== null) {
      throw new ConflictException('admin_email_taken');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const role = dto.role ?? TENANT_ADMIN_ROLE;
    const admin = await this.prisma.adminUser
      .create({
        data: {
          email,
          passwordHash,
          role,
          tenantId,
          active: true,
        },
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ConflictException('admin_email_taken');
        }

        throw error;
      });

    await this.audit.record({
      actor,
      action: 'tenant.admin.created',
      tenantId,
      targetType: 'admin',
      targetId: admin.id,
      metadata: { email, role },
      context,
    });

    this.logger.info(
      { event: 'platform.tenant_admin.created', tenant_id: tenantId, admin_id: admin.id },
      'tenant admin created',
    );

    return toAdminDto(admin);
  }

  async update(
    tenantId: string,
    adminId: string,
    dto: UpdateTenantAdminDto,
    actor: PlatformAuditActor,
    context: PlatformAuditContext,
  ): Promise<TenantAdminDto> {
    await this.requireTenant(tenantId);

    const admin = await this.prisma.adminUser.findFirst({
      where: { id: adminId, tenantId },
    });

    if (
      admin === null ||
      (admin.role !== TENANT_ADMIN_ROLE && admin.role !== TENANT_APPROVER_ROLE)
    ) {
      throw new NotFoundException('Admin not found');
    }

    const data: Prisma.AdminUserUpdateInput = {};

    if (dto.password !== undefined) {
      data.passwordHash = await bcrypt.hash(dto.password, 10);
      data.tokenVersion = { increment: 1 };
    }

    if (dto.active !== undefined && dto.active !== admin.active) {
      if (!dto.active && admin.role === TENANT_ADMIN_ROLE) {
        await this.assertNotLastActiveAdmin(tenantId);
      }

      data.active = dto.active;
    }

    if (Object.keys(data).length === 0) {
      return toAdminDto(admin);
    }

    const updated = await this.prisma.adminUser.update({ where: { id: admin.id }, data });

    const action =
      dto.password !== undefined
        ? 'tenant.admin.password_reset'
        : dto.active === false
          ? 'tenant.admin.deactivated'
          : 'tenant.admin.updated';

    await this.audit.record({
      actor,
      action,
      tenantId,
      targetType: 'admin',
      targetId: admin.id,
      metadata: {
        email: admin.email,
        ...(dto.active === undefined ? {} : { activeFrom: admin.active, activeTo: dto.active }),
        ...(dto.password === undefined ? {} : { passwordReset: true }),
      },
      context,
    });

    this.logger.info(
      { event: 'platform.tenant_admin.updated', tenant_id: tenantId, admin_id: admin.id, action },
      'tenant admin updated',
    );

    return toAdminDto(updated);
  }

  private async requireTenant(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    if (tenant === null) {
      throw new NotFoundException('tenant_not_found');
    }
  }

  private async assertNotLastActiveAdmin(tenantId: string): Promise<void> {
    const activeAdmins = await this.prisma.adminUser.count({
      where: { tenantId, role: TENANT_ADMIN_ROLE, active: true },
    });

    if (activeAdmins <= 1) {
      throw new ConflictException('last_tenant_admin');
    }
  }
}

function toAdminDto(admin: {
  id: string;
  email: string;
  role: string;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}): TenantAdminDto {
  return {
    id: admin.id,
    email: admin.email,
    role: admin.role,
    active: admin.active,
    lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
    createdAt: admin.createdAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
