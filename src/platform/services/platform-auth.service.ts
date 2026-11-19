import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { PinoLogger } from 'nestjs-pino';
import { PLATFORM_ADMIN_ROLE } from '../../auth/admin/admin.types';
import { AdminTokenService } from '../../auth/admin/admin-token.service';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  PlatformAdminProfileDto,
  PlatformLoginDto,
  PlatformLoginResponseDto,
} from '../dto/platform-auth.dto';

/**
 * Authentication for the platform lane.
 *
 * Tenant admins have role tenant_admin and a tenant; platform admins have role platform_admin
 * and `tenantId = NULL`. This service only issues tokens for the latter, and the token carries
 * no tenant claim (see AdminTokenService).
 */
@Injectable()
export class PlatformAuthService {
  private readonly dummyHash: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AdminTokenService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PlatformAuthService.name);
    // Same timing regardless of whether the email exists.
    this.dummyHash = bcrypt.hashSync('notifhub-invalid-platform-password', 10);
  }

  async login(dto: PlatformLoginDto): Promise<PlatformLoginResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });
    const passwordMatches = await bcrypt.compare(
      dto.password,
      admin?.passwordHash ?? this.dummyHash,
    );

    if (admin === null || !passwordMatches) {
      this.logger.warn(
        { event: 'platform.login.failed', email, reason: 'invalid_credentials' },
        'platform login failed',
      );
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!admin.active) {
      this.logger.warn(
        { event: 'platform.login.failed', email, reason: 'inactive' },
        'platform login failed for inactive account',
      );
      throw new ForbiddenException('Platform admin account is inactive');
    }

    if (admin.role !== PLATFORM_ADMIN_ROLE || admin.tenantId !== null) {
      this.logger.warn(
        { event: 'platform.login.failed', email, reason: 'not_platform_admin' },
        'platform login rejected for a tenant admin account',
      );
      throw new ForbiddenException('Admin role is not permitted');
    }

    const signed = this.tokens.sign({
      id: admin.id,
      email: admin.email,
      role: admin.role,
    });

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    this.logger.info(
      { event: 'platform.login.succeeded', admin_id: admin.id },
      'platform admin logged in',
    );

    return {
      accessToken: signed.token,
      tokenType: 'Bearer',
      expiresIn: signed.expiresInSeconds,
      admin: toProfile(admin),
    };
  }

  async me(adminId: string): Promise<PlatformAdminProfileDto> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });

    if (admin === null || !admin.active) {
      throw new UnauthorizedException('Admin account is not available');
    }

    if (admin.role !== PLATFORM_ADMIN_ROLE || admin.tenantId !== null) {
      throw new ForbiddenException('Admin role is not permitted');
    }

    return toProfile(admin);
  }
}

function toProfile(admin: { id: string; email: string; role: string }): PlatformAdminProfileDto {
  return {
    id: admin.id,
    email: admin.email,
    role: admin.role,
  };
}
