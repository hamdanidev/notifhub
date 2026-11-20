import { DEFAULT_RETRY_OPTIONS, HttpTransport, type Channel } from '@notifhub/js';
import { API_BASE_URL } from '../env';
import { getToken } from './session';

export type ComposePriority = 'low' | 'normal' | 'high';

export interface ComposeNotificationInput {
  requestKey: string;
  templateKey: string;
  recipients?: string[];
  topics?: string[];
  channels: Channel[];
  data?: Record<string, unknown>;
  priority?: ComposePriority;
}

export interface ComposeNotificationResult {
  notification_id: string;
}

const transport = new HttpTransport(
  `${API_BASE_URL.replace(/\/+$/, '')}/api/v1/admin`,
  async () => getToken() ?? '',
  globalThis.fetch.bind(globalThis),
  DEFAULT_RETRY_OPTIONS,
);

export function composeNotification(
  input: ComposeNotificationInput,
): Promise<ComposeNotificationResult> {
  return transport.request<ComposeNotificationResult>('POST', '/notifications', {
    retry: false,
    body: input,
  });
}
