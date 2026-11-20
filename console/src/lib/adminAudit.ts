import { DEFAULT_RETRY_OPTIONS, HttpTransport } from '@notifhub/js';
import { API_BASE_URL } from '../env';
import { getToken } from './session';

export interface AdminAuditEvent {
  id: string;
  actorAdminId: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: unknown;
  ip: string | null;
  requestId: string | null;
  occurredAt: string;
}

export interface AdminAuditQuery {
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AdminAuditResult {
  items: AdminAuditEvent[];
  total: number;
  limit: number;
  offset: number;
}

const transport = new HttpTransport(
  `${API_BASE_URL.replace(/\/+$/, '')}/api/v1/admin`,
  async () => getToken() ?? '',
  globalThis.fetch.bind(globalThis),
  DEFAULT_RETRY_OPTIONS,
);

export function listAdminAudit(query: AdminAuditQuery): Promise<AdminAuditResult> {
  const params = new URLSearchParams();

  if (query.action !== undefined && query.action !== '') params.set('action', query.action);
  if (query.from !== undefined) params.set('from', query.from);
  if (query.to !== undefined) params.set('to', query.to);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));

  const suffix = params.toString();

  return transport.request<AdminAuditResult>('GET', `/audit${suffix === '' ? '' : `?${suffix}`}`);
}
