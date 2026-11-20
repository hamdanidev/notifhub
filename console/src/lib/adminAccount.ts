import { DEFAULT_RETRY_OPTIONS, HttpTransport } from '@notifhub/js';
import { API_BASE_URL } from '../env';
import { getToken } from './session';

/**
 * Console-local wrapper for the change-password endpoint.
 *
 * `@notifhub/js` is published, so this new endpoint is not added to the SDK yet. The wrapper uses
 * the SDK's exported HttpTransport (token injection, typed errors) instead of raw fetch, matching
 * the pattern in `adminResend.ts`.
 */
const transport = new HttpTransport(
  `${API_BASE_URL.replace(/\/+$/, '')}/api/v1/admin`,
  async () => getToken() ?? '',
  globalThis.fetch.bind(globalThis),
  DEFAULT_RETRY_OPTIONS,
);

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return transport.request<void>('POST', '/auth/change-password', {
    retry: false,
    body: { currentPassword, newPassword },
  });
}
