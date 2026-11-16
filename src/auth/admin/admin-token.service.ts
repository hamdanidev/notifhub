import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { PinoLogger } from 'nestjs-pino';
import type { AdminPrincipal } from './admin.types';

interface AdminJwtPayload extends jwt.JwtPayload {
  email?: unknown;
  role?: unknown;
  tenant?: unknown;
}

export interface SignedAdminToken {
  token: string;
  expiresInSeconds: number;
}

/**
 * Admin JWT signing/verification (PART 1 rule 47).
 *
 * Separate secret from subscriber and ingest auth. Claims: sub, email, role, tenant, exp, iat.
 */
@Injectable()
export class AdminTokenService {
  private readonly secret: string;
  private readonly expiresIn: string;

  constructor(
    config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminTokenService.name);
    this.secret = config.getOrThrow<string>('ADMIN_JWT_SECRET');
    this.expiresIn = config.getOrThrow<string>('ADMIN_JWT_EXPIRES_IN');
  }

  sign(admin: {
    id: string;
    email: string;
    role: string;
    tenantId: string;
  }): SignedAdminToken {
    const token = jwt.sign(
      {
        sub: admin.id,
        email: admin.email,
        role: admin.role,
        tenant: admin.tenantId,
      },
      this.secret,
      {
        algorithm: 'HS256',
        expiresIn: this.expiresIn as jwt.SignOptions['expiresIn'],
      },
    );

    return { token, expiresInSeconds: ttlToSeconds(this.expiresIn) };
  }

  verify(token: string): AdminPrincipal {
    let payload: string | AdminJwtPayload;

    try {
      payload = jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        clockTolerance: 5,
      });
    } catch (error) {
      this.logger.warn(
        {
          event: 'auth.admin_token.invalid',
          reason: error instanceof Error ? error.message : 'verification_failed',
        },
        'admin token verification failed',
      );
      throw new Error('invalid admin token');
    }

    if (typeof payload === 'string') {
      throw new Error('invalid admin token');
    }

    const adminId = typeof payload.sub === 'string' ? payload.sub : '';
    const email = typeof payload.email === 'string' ? payload.email : '';
    const role = typeof payload.role === 'string' ? payload.role : '';
    const tenantId = typeof payload.tenant === 'string' ? payload.tenant : '';

    if (
      adminId.length === 0 ||
      email.length === 0 ||
      role.length === 0 ||
      tenantId.length === 0 ||
      typeof payload.exp !== 'number'
    ) {
      throw new Error('admin token is missing required claims');
    }

    return { adminId, email, role, tenantId };
  }
}

function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);

  if (match === null) {
    return 3600;
  }

  const amount = Number(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 3600;
    case 'd':
      return amount * 86_400;
    default:
      return 3600;
  }
}
