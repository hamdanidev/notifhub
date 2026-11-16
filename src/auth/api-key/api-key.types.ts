import type { Request } from 'express';

/** Principal resolved from a valid X-API-Key. */
export interface ApiKeyPrincipal {
  apiKeyId: string;
  tenantId: string;
}

export interface RequestWithApiKey extends Request {
  apiKey?: ApiKeyPrincipal;
}
