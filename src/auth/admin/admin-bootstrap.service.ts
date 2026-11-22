import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import { ensureTenant } from '../../tenants/ensure-tenant';
import { PLATFORM_ADMIN_ROLE, TENANT_ADMIN_ROLE, TENANT_APPROVER_ROLE } from './admin.types';

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
    await this.bootstrapApprover(tenantId);
    await this.bootstrapApprovalMode(tenantId);
  }

  private async bootstrapApprover(tenantId: string): Promise<void> {
    const rawEmail = this.config.get<string>('APPROVER_EMAIL');
    const passwordHash = this.config.get<string>('APPROVER_PASSWORD_HASH');

    if (rawEmail === undefined || passwordHash === undefined) {
      await this.warnIfNoApprover(tenantId);
      return;
    }

    const email = rawEmail.trim().toLowerCase();
    const adminEmail = this.config.getOrThrow<string>('ADMIN_EMAIL').trim().toLowerCase();

    if (email === adminEmail) {
      throw new Error('APPROVER_EMAIL must differ from ADMIN_EMAIL; use a second account');
    }

    const existing = await this.prisma.adminUser.findUnique({ where: { email } });

    if (existing === null) {
      await this.prisma.adminUser.create({
        data: {
          email,
          passwordHash,
          bootstrapPasswordHash: passwordHash,
          role: TENANT_APPROVER_ROLE,
          tenantId,
          active: true,
        },
      });

      this.logger.info(
        { event: 'approver.bootstrap.created', tenant_id: tenantId },
        'bootstrap approver user created',
      );

      return;
    }

    if (existing.role !== TENANT_APPROVER_ROLE || existing.tenantId !== tenantId) {
      throw new Error(
        `APPROVER_EMAIL (${email}) is already used by another account; pick another email`,
      );
    }

    const sync = this.passwordSync(existing, passwordHash);
    const accountChanged = !existing.active;

    if (sync.shouldSyncPassword || sync.shouldTrackEnvHash || accountChanged) {
      await this.prisma.adminUser.update({
        where: { id: existing.id },
        data: {
          ...(sync.shouldSyncPassword
            ? { passwordHash, tokenVersion: { increment: 1 } }
            : {}),
          ...(sync.shouldTrackEnvHash ? { bootstrapPasswordHash: passwordHash } : {}),
          active: true,
        },
      });

      this.logger.info(
        { event: 'approver.bootstrap.updated', admin_id: existing.id, tenant_id: tenantId },
        'bootstrap approver user updated from environment',
      );

      return;
    }

    this.logger.info(
      { event: 'approver.bootstrap.ready', admin_id: existing.id, tenant_id: tenantId },
      'bootstrap approver user is up to date',
    );
  }

  private async bootstrapApprovalMode(tenantId: string): Promise<void> {
    const envMode = this.config.get<'two_person' | 'self_approval_allowed'>(
      'TEMPLATE_APPROVAL_MODE',
    );

    const platformAdmins = await this.prisma.adminUser.count({
      where: { role: PLATFORM_ADMIN_ROLE, tenantId: null, active: true },
    });

    if (platformAdmins > 0) {
      if (envMode !== undefined) {
        this.logger.warn(
          { event: 'tenant.approval_mode.env_ignored', mode: envMode },
          'TEMPLATE_APPROVAL_MODE is ignored while the platform lane is active; use the platform console',
        );
      }

      return;
    }

    const mode: 'two_person' | 'self_approval_allowed' = envMode ?? 'two_person';
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { templateApprovalMode: true },
    });

    if (tenant === null || tenant.templateApprovalMode === mode) {
      return;
    }

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { templateApprovalMode: mode },
    });

    this.logger.info(
      { event: 'tenant.approval_mode.bootstrap', tenant_id: tenantId, mode },
      'template approval mode applied from environment',
    );
  }

  private async warnIfNoApprover(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { templateApprovalMode: true },
    });

    if (tenant?.templateApprovalMode === 'self_approval_allowed') {
      this.logger.info(
        { event: 'template.approval.self_approval_mode', tenant_id: tenantId },
        'template approval mode allows self-approval; no approver account required',
      );
      return;
    }

    const approvers = await this.prisma.adminUser.count({
      where: { tenantId, role: TENANT_APPROVER_ROLE, active: true },
    });

    if (approvers === 0) {
      this.logger.warn(
        { event: 'template.approval.approver_missing', tenant_id: tenantId },
        'publishing templates requires an approver account; set APPROVER_EMAIL/APPROVER_PASSWORD_HASH or add one from the platform lane',
      );
    }
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
          bootstrapPasswordHash: passwordHash,
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

    const sync = this.passwordSync(existing, passwordHash);
    const accountChanged =
      existing.role !== TENANT_ADMIN_ROLE || existing.tenantId !== tenantId || !existing.active;

    if (sync.shouldSyncPassword || sync.shouldTrackEnvHash || accountChanged) {
      await this.prisma.adminUser.update({
        where: { id: existing.id },
        data: {
          ...(sync.shouldSyncPassword
            ? { passwordHash, tokenVersion: { increment: 1 } }
            : {}),
          ...(sync.shouldTrackEnvHash ? { bootstrapPasswordHash: passwordHash } : {}),
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
          bootstrapPasswordHash: passwordHash,
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

    const sync = this.passwordSync(existing, passwordHash);

    if (sync.shouldSyncPassword || sync.shouldTrackEnvHash || !existing.active) {
      await this.prisma.adminUser.update({
        where: { id: existing.id },
        data: {
          ...(sync.shouldSyncPassword
            ? { passwordHash, tokenVersion: { increment: 1 } }
            : {}),
          ...(sync.shouldTrackEnvHash ? { bootstrapPasswordHash: passwordHash } : {}),
          active: true,
        },
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

  /**
   * The environment hash is applied on first bootstrap and again only when it changes. A password
   * changed from the UI is therefore not reverted on restart, while rotating ADMIN_PASSWORD_HASH
   * still forces a sync. `bootstrapPasswordHash` remembers the last env value that was applied.
   */
  private passwordSync(
    existing: { passwordHash: string; bootstrapPasswordHash: string | null },
    envPasswordHash: string,
  ): { shouldSyncPassword: boolean; shouldTrackEnvHash: boolean } {
    const bootstrapHashMissing = existing.bootstrapPasswordHash === null;
    const envHashChanged =
      !bootstrapHashMissing && existing.bootstrapPasswordHash !== envPasswordHash;
    const passwordDiffers = existing.passwordHash !== envPasswordHash;
    const shouldSyncPassword = (bootstrapHashMissing || envHashChanged) && passwordDiffers;

    return {
      shouldSyncPassword,
      shouldTrackEnvHash: bootstrapHashMissing || envHashChanged,
    };
  }
}
