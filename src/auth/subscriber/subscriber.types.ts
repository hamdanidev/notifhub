import type { Request } from 'express';

/** Identity resolved from a verified end-user subscriber JWT. */
export interface SubscriberPrincipal {
  recipientId: string;
  tenantId: string;
}

export interface RequestWithSubscriber extends Request {
  subscriber?: SubscriberPrincipal;
}
