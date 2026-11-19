import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import jwt from 'jsonwebtoken';
import type { PrismaService } from '../src/prisma/prisma.service';
import { AdminTokenService } from '../src/auth/admin/admin-token.service';
import { PlatformAdminGuard } from '../src/auth/admin/platform-admin.guard';
import type { RequestWithPlatformAdmin } from '../src/auth/admin/admin.types';

const secret = 'unit-test-admin-secret-32-characters-min';
const config = {
  getOrThrow: (key: string): string => {
    const values: Record<string, string> = {
      ADMIN_JWT_SECRET: secret,
      ADMIN_JWT_EXPIRES_IN: '1h',
    };

    return values[key];
  },
} as unknown as ConfigService;

const logger = {
  setContext: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  error: () => undefined,
} as unknown as PinoLogger;

function contextFor(request: RequestWithPlatformAdmin): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function requestWith(token?: string): RequestWithPlatformAdmin {
  const request = {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    method: 'GET',
    url: '/api/v1/platform/auth/me',
    ip: '127.0.0.1',
  };

  return request as unknown as RequestWithPlatformAdmin;
}

describe('platform admin lane', () => {
  const tokens = new AdminTokenService(config, logger);

  it('token platform tidak membawa klaim tenant', () => {
    const signed = tokens.sign({ id: 'p1', email: 'ops@example.com', role: 'platform_admin' });
    const payload = jwt.decode(signed.token) as Record<string, unknown>;

    expect(payload.role).toBe('platform_admin');
    expect(payload.tenant).toBeUndefined();
  });

  it('verify mengembalikan tenantId hanya untuk token tenant admin', () => {
    const platform = tokens.verify(
      tokens.sign({ id: 'p1', email: 'ops@example.com', role: 'platform_admin' }).token,
    );
    const tenant = tokens.verify(
      tokens.sign({
        id: 't1',
        email: 'admin@example.com',
        role: 'tenant_admin',
        tenantId: 'default',
      }).token,
    );

    expect(platform.tenantId).toBeUndefined();
    expect(tenant.tenantId).toBe('default');
  });

  it('guard menerima platform admin aktif dan memasang principal', async () => {
    const prisma = {
      adminUser: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'p1',
          email: 'ops@example.com',
          role: 'platform_admin',
          tenantId: null,
          active: true,
        }),
      },
    } as unknown as PrismaService;
    const guard = new PlatformAdminGuard(tokens, prisma, logger);
    const request = requestWith(
      tokens.sign({ id: 'p1', email: 'ops@example.com', role: 'platform_admin' }).token,
    );

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.platformAdmin).toEqual({
      adminId: 'p1',
      email: 'ops@example.com',
      role: 'platform_admin',
    });
  });

  it('guard menolak token tenant admin di lane platform', async () => {
    const prisma = {
      adminUser: { findUnique: jest.fn() },
    } as unknown as PrismaService;
    const guard = new PlatformAdminGuard(tokens, prisma, logger);
    const request = requestWith(
      tokens.sign({
        id: 't1',
        email: 'admin@example.com',
        role: 'tenant_admin',
        tenantId: 'default',
      }).token,
    );

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(ForbiddenException);
    expect((prisma.adminUser.findUnique as jest.Mock).mock.calls).toHaveLength(0);
  });

  it('guard menolak platform admin yang sudah nonaktif', async () => {
    const prisma = {
      adminUser: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'p1',
          email: 'ops@example.com',
          role: 'platform_admin',
          tenantId: null,
          active: false,
        }),
      },
    } as unknown as PrismaService;
    const guard = new PlatformAdminGuard(tokens, prisma, logger);

    await expect(
      guard.canActivate(
        contextFor(
          requestWith(
            tokens.sign({ id: 'p1', email: 'ops@example.com', role: 'platform_admin' }).token,
          ),
        ),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('guard menolak request tanpa token', async () => {
    const prisma = { adminUser: { findUnique: jest.fn() } } as unknown as PrismaService;
    const guard = new PlatformAdminGuard(tokens, prisma, logger);

    await expect(guard.canActivate(contextFor(requestWith()))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
