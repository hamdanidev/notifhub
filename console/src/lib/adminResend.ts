import { DEFAULT_RETRY_OPTIONS, HttpTransport, type Channel } from '@notifhub/js';
import { API_BASE_URL } from '../env';
import { getToken } from './session';

export interface ResendFailedResult {
  notification_id: string;
  status: 'accepted';
  mode: 'failed';
  recipient_count: number;
  channels: Channel[];
}

/**
 * Console-local extension for the resend endpoint.
 *
 * `@notifhub/js` is published, so its version/API is intentionally not changed for this console
 * feature. This uses the SDK's exported HttpTransport (token injection, typed errors, retry
 * policy) instead of raw fetch. Move this method into NotifHubAdminClient when the next SDK
 * version is released.
 */
const transport = new HttpTransport(
  `${API_BASE_URL.replace(/\/+$/, '')}/api/v1/admin`,
  async () => getToken() ?? '',
  globalThis.fetch.bind(globalThis),
  DEFAULT_RETRY_OPTIONS,
);

export function resendFailedNotification(
  notificationId: string,
  requestKey: string,
): Promise<ResendFailedResult> {
  return transport.request<ResendFailedResult>(
    'POST',
    `/notifications/${encodeURIComponent(notificationId)}/resend`,
    {
      retry: false,
      body: { mode: 'failed', requestKey },
    },
  );
}
