import type { TenantStatus } from '@prisma/client';
import type { Request } from 'express';

/** Principal resolved from a valid X-API-Key. */
export interface ApiKeyPrincipal {
  apiKeyId: string;
  tenantId: string;
  tenantStatus: TenantStatus;
  /** Empty means "any origin" (keys created before origin enforcement). */
  allowedOrigins: string[];
}

export interface RequestWithApiKey extends Request {
  apiKey?: ApiKeyPrincipal;
}
