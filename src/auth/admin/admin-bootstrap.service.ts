import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import { ensureTenant } from '../../tenants/ensure-tenant';
import { TENANT_ADMIN_ROLE } from './admin.types';

/**
 * Bootstraps the single tenant admin from ADMIN_EMAIL / ADMIN_PASSWORD_HASH (PART 1 rule 47).
 *
 * Multi-admin management is not implemented yet; the environment is the source of truth for
 * this account, so a changed hash or tenant is applied on startup.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminBootstrapService.name);
  }

  async onApplicationBootstrap(): Promise<void> {
    const email = this.config.getOrThrow<string>('ADMIN_EMAIL').trim().toLowerCase();
    const passwordHash = this.config.getOrThrow<string>('ADMIN_PASSWORD_HASH');
    const tenantId = this.config.getOrThrow<string>('DEFAULT_TENANT_ID');

    const tenantState = await ensureTenant(this.prisma, tenantId);

    if (tenantState === 'created') {
      this.logger.info(
        { event: 'tenant.bootstrap.created', tenant_id: tenantId },
        'bootstrap tenant created',
      );
    }

    const existing = await this.prisma.adminUser.findUnique({ where: { email } });

    if (existing === null) {
      await this.prisma.adminUser.create({
        data: {
          email,
          passwordHash,
          role: TENANT_ADMIN_ROLE,
          tenantId,
          active: true,
        },
      });

      this.logger.info(
        { event: 'admin.bootstrap.created', tenant_id: tenantId },
        'bootstrap admin user created',
      );

      return;
    }

    if (
      existing.passwordHash !== passwordHash ||
      existing.role !== TENANT_ADMIN_ROLE ||
      existing.tenantId !== tenantId ||
      !existing.active
    ) {
      await this.prisma.adminUser.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          role: TENANT_ADMIN_ROLE,
          tenantId,
          active: true,
        },
      });

      this.logger.info(
        { event: 'admin.bootstrap.updated', admin_id: existing.id, tenant_id: tenantId },
        'bootstrap admin user updated from environment',
      );

      return;
    }

    this.logger.info(
      { event: 'admin.bootstrap.ready', admin_id: existing.id, tenant_id: tenantId },
      'bootstrap admin user is up to date',
    );
  }
}
