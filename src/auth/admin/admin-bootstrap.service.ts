import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import { ensureTenant } from '../../tenants/ensure-tenant';
import { PLATFORM_ADMIN_ROLE, TENANT_ADMIN_ROLE } from './admin.types';

/**
 * Bootstraps the accounts that come from the environment:
 *
 * - the default tenant (needed by the FK on every tenant-owned table),
 * - one tenant admin from ADMIN_EMAIL / ADMIN_PASSWORD_HASH (upsert; env is the source of truth),
 * - optionally one platform admin from PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD_HASH.
 *
 * Without a platform admin the service still boots: the platform API is simply unavailable, and a
 * warning is logged. An env email that already belongs to a tenant admin fails fast instead of
 * silently moving that account across lanes.
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
    const tenantId = this.config.getOrThrow<string>('DEFAULT_TENANT_ID');

    const tenantState = await ensureTenant(this.prisma, tenantId);

    if (tenantState === 'created') {
      this.logger.info(
        { event: 'tenant.bootstrap.created', tenant_id: tenantId },
        'bootstrap tenant created',
      );
    }

    await this.bootstrapTenantAdmin(tenantId);
    await this.bootstrapPlatformAdmin();
  }

  private async bootstrapTenantAdmin(tenantId: string): Promise<void> {
    const email = this.config.getOrThrow<string>('ADMIN_EMAIL').trim().toLowerCase();
    const passwordHash = this.config.getOrThrow<string>('ADMIN_PASSWORD_HASH');

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

  private async bootstrapPlatformAdmin(): Promise<void> {
    const rawEmail = this.config.get<string>('PLATFORM_ADMIN_EMAIL');
    const passwordHash = this.config.get<string>('PLATFORM_ADMIN_PASSWORD_HASH');

    if (rawEmail === undefined || passwordHash === undefined) {
      const platformAdminCount = await this.prisma.adminUser.count({
        where: { role: PLATFORM_ADMIN_ROLE, tenantId: null },
      });

      if (platformAdminCount === 0) {
        this.logger.warn(
          { event: 'platform.admin.bootstrap.missing' },
          'no platform admin configured; the platform API is unavailable',
        );
      }

      return;
    }

    const email = rawEmail.trim().toLowerCase();
    const existing = await this.prisma.adminUser.findUnique({ where: { email } });

    if (existing === null) {
      await this.prisma.adminUser.create({
        data: {
          email,
          passwordHash,
          role: PLATFORM_ADMIN_ROLE,
          tenantId: null,
          active: true,
        },
      });

      this.logger.info(
        { event: 'platform.admin.bootstrap.created', email },
        'bootstrap platform admin created',
      );

      return;
    }

    if (existing.role !== PLATFORM_ADMIN_ROLE || existing.tenantId !== null) {
      throw new Error(
        `PLATFORM_ADMIN_EMAIL (${email}) is already used by a tenant admin; ` +
          'pick another email or move that account first',
      );
    }

    if (existing.passwordHash !== passwordHash || !existing.active) {
      await this.prisma.adminUser.update({
        where: { id: existing.id },
        data: { passwordHash, active: true },
      });

      this.logger.info(
        { event: 'platform.admin.bootstrap.updated', admin_id: existing.id },
        'bootstrap platform admin updated from environment',
      );

      return;
    }

    this.logger.info(
      { event: 'platform.admin.bootstrap.ready', admin_id: existing.id },
      'bootstrap platform admin is up to date',
    );
  }
}
