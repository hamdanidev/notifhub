import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcrypt';
import { PinoLogger } from 'nestjs-pino';
import { AdminTokenService } from '../../auth/admin/admin-token.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AdminProfileDto, LoginDto, LoginResponseDto } from '../dto/auth.dto';

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
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });
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

    const signed = this.tokens.sign(admin);

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
      admin: toProfile(admin),
    };
  }

  async me(adminId: string): Promise<AdminProfileDto> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });

    if (admin === null || !admin.active) {
      throw new UnauthorizedException('Admin account is not available');
    }

    return toProfile(admin);
  }
}

function toProfile(admin: {
  id: string;
  email: string;
  role: string;
  tenantId: string;
}): AdminProfileDto {
  return {
    id: admin.id,
    email: admin.email,
    role: admin.role,
    tenantId: admin.tenantId,
  };
}
