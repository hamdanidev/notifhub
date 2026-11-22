import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcrypt';
import { PinoLogger } from 'nestjs-pino';
import { AdminTokenService } from '../../auth/admin/admin-token.service';
import { isTenantAdminRole } from '../../auth/admin/admin.types';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AdminProfileDto,
  ChangePasswordDto,
  LoginDto,
  LoginResponseDto,
} from '../dto/auth.dto';

@Injectable()
export class AdminAuthService {
  private readonly dummyHash: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AdminTokenService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminAuthService.name);
    // Used when the email does not exist so the bcrypt comparison cost is the same.
    this.dummyHash = bcrypt.hashSync('notifhub-invalid-admin-password', 10);
  }

  async login(dto: LoginDto): Promise<LoginResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const admin = await this.prisma.adminUser.findUnique({
      where: { email },
      include: { tenant: { select: { status: true, templateApprovalMode: true } } },
    });
    const passwordMatches = await bcrypt.compare(
      dto.password,
      admin?.passwordHash ?? this.dummyHash,
    );

    if (admin === null || !passwordMatches) {
      this.logger.warn(
        { event: 'admin.login.failed', email, reason: 'invalid_credentials' },
        'admin login failed',
      );
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!admin.active) {
      this.logger.warn(
        { event: 'admin.login.failed', email, reason: 'inactive' },
        'admin login failed for inactive account',
      );
      throw new ForbiddenException('Admin account is inactive');
    }

    // Platform admins (tenantId = null) use the platform auth surface, not the tenant lane.
    if (admin.tenantId === null || !isTenantAdminRole(admin.role)) {
      this.logger.warn(
        { event: 'admin.login.failed', email, reason: 'tenant_missing' },
        'admin login rejected: account has no tenant',
      );
      throw new ForbiddenException('Admin role is not permitted');
    }

    if (admin.tenant?.status !== 'active') {
      this.logger.warn(
        { event: 'admin.login.failed', email, reason: 'tenant_suspended', tenant_id: admin.tenantId },
        'admin login rejected: tenant is suspended',
      );
      throw new ForbiddenException('tenant_suspended');
    }

    const signed = this.tokens.sign({
      id: admin.id,
      email: admin.email,
      role: admin.role,
      tenantId: admin.tenantId,
      tokenVersion: admin.tokenVersion,
    });

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    this.logger.info(
      { event: 'admin.login.succeeded', admin_id: admin.id, tenant_id: admin.tenantId },
      'admin logged in',
    );

    return {
      accessToken: signed.token,
      tokenType: 'Bearer',
      expiresIn: signed.expiresInSeconds,
      admin: toProfile({
        id: admin.id,
        email: admin.email,
        role: admin.role,
        tenantId: admin.tenantId,
        templateApprovalMode: admin.tenant?.templateApprovalMode ?? 'two_person',
      }),
    };
  }

  async changePassword(
    adminId: string,
    dto: ChangePasswordDto,
    context: { ip?: string; requestId?: string } = {},
  ): Promise<void> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });

    if (admin === null || !admin.active) {
      throw new UnauthorizedException('Admin account is not available');
    }

    if (!isTenantAdminRole(admin.role) || admin.tenantId === null) {
      throw new ForbiddenException('Admin role is not permitted');
    }

    if (Buffer.byteLength(dto.newPassword, 'utf8') > 72) {
      throw new BadRequestException({
        message: 'password_too_long',
        details: { code: 'password_too_long' },
      });
    }

    const currentMatches = await bcrypt.compare(dto.currentPassword, admin.passwordHash);

    if (!currentMatches) {
      throw new BadRequestException({
        message: 'invalid_current_password',
        details: { code: 'invalid_current_password' },
      });
    }

    if (await bcrypt.compare(dto.newPassword, admin.passwordHash)) {
      throw new BadRequestException({
        message: 'password_unchanged',
        details: { code: 'password_unchanged' },
      });
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });

    this.logger.info(
      {
        event: 'admin.password.changed',
        admin_id: admin.id,
        tenant_id: admin.tenantId,
        ip: context.ip ?? null,
        request_id: context.requestId ?? null,
      },
      'admin password changed',
    );
  }

  async me(adminId: string): Promise<AdminProfileDto> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminId },
      include: { tenant: { select: { templateApprovalMode: true } } },
    });

    if (admin === null || !admin.active) {
      throw new UnauthorizedException('Admin account is not available');
    }

    if (admin.tenantId === null || !isTenantAdminRole(admin.role)) {
      throw new ForbiddenException('Admin role is not permitted');
    }

    return toProfile({
      id: admin.id,
      email: admin.email,
      role: admin.role,
      tenantId: admin.tenantId,
      templateApprovalMode: admin.tenant?.templateApprovalMode ?? 'two_person',
    });
  }
}

function toProfile(admin: {
  id: string;
  email: string;
  role: string;
  tenantId: string;
  templateApprovalMode: string;
}): AdminProfileDto {
  return {
    id: admin.id,
    email: admin.email,
    role: admin.role,
    tenantId: admin.tenantId,
    templateApprovalMode: admin.templateApprovalMode,
  };
}
