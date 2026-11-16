import { Injectable, UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { PinoLogger } from 'nestjs-pino';
import { SubscriberSecretResolver } from './subscriber-secret-resolver';
import type { SubscriberPrincipal } from './subscriber.types';

interface SubscriberJwtPayload extends jwt.JwtPayload {
  tenant?: unknown;
}

const INVALID_TOKEN_MESSAGE = 'Invalid or missing subscriber token';

/**
 * Verifies end-user subscriber tokens (PART 1 rule 41).
 *
 * - HS256 only. Secrets come from `SubscriberSecretResolver`: the tenant's API key secrets,
 *   with `SUBSCRIBER_JWT_SECRET` as fallback for tenants that never configured one (Phase 9).
 * - The `tenant` claim is read unverified only to select the candidate secrets. The signature
 *   must still verify, and the verified claim must match the tenant used for the lookup.
 * - Required claims: sub (recipientId), tenant, exp.
 * - Uses `jsonwebtoken` directly instead of @nestjs/jwt so the admin JWT configuration cannot
 *   share or override this secret through a global module.
 */
@Injectable()
export class SubscriberTokenService {
  constructor(
    private readonly resolver: SubscriberSecretResolver,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SubscriberTokenService.name);
  }

  async verify(token: string): Promise<SubscriberPrincipal> {
    const expectedTenantId = this.readTenantClaim(token);
    const resolved = await this.resolver.resolve(expectedTenantId);
    const payload = this.verifySignature(token, resolved.secrets);

    if (payload === null) {
      this.logger.warn(
        {
          event: 'auth.subscriber_token.invalid',
          reason: 'signature_verification_failed',
          tenant_id: expectedTenantId,
          secret_source: resolved.source,
        },
        'subscriber token verification failed',
      );
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }

    const recipientId = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    const tenantId = typeof payload.tenant === 'string' ? payload.tenant.trim() : '';

    if (
      recipientId.length === 0 ||
      tenantId.length === 0 ||
      tenantId !== expectedTenantId ||
      typeof payload.exp !== 'number'
    ) {
      this.logger.warn(
        {
          event: 'auth.subscriber_token.invalid',
          reason: 'missing_or_mismatched_claims',
          has_sub: recipientId.length > 0,
          tenant_matches: tenantId === expectedTenantId,
          has_exp: typeof payload.exp === 'number',
        },
        'subscriber token is missing required claims',
      );
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }

    this.logger.debug(
      {
        event: 'auth.subscriber_token.resolved',
        tenant_id: tenantId,
        secret_source: resolved.source,
      },
      'subscriber token accepted',
    );

    return { recipientId, tenantId };
  }

  /**
   * Reads the `tenant` claim without verifying the signature. It only selects which secrets to
   * try; it is never trusted on its own.
   */
  private readTenantClaim(token: string): string {
    let decoded: string | jwt.JwtPayload | null;

    try {
      decoded = jwt.decode(token);
    } catch {
      decoded = null;
    }

    const tenant =
      decoded !== null && typeof decoded !== 'string' && typeof decoded.tenant === 'string'
        ? decoded.tenant.trim()
        : '';

    if (tenant.length === 0) {
      this.logger.warn(
        { event: 'auth.subscriber_token.invalid', reason: 'missing_tenant_claim' },
        'subscriber token has no tenant claim',
      );
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }

    return tenant;
  }

  private verifySignature(token: string, secrets: string[]): SubscriberJwtPayload | null {
    for (const secret of secrets) {
      try {
        const verified = jwt.verify(token, secret, {
          algorithms: ['HS256'],
          clockTolerance: 5,
        });

        if (typeof verified !== 'string') {
          return verified;
        }
      } catch {
        // Try the next candidate secret; the caller reports a single generic failure.
      }
    }

    return null;
  }
}
