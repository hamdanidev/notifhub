import { NotifHubPlatformClient } from '@notifhub/js';
import { API_BASE_URL } from '../env';
import { getPlatformToken } from './platformSession';

/**
 * Platform-lane client. Kept in its own module (not `adminClient.ts`) so the tenant and platform
 * console bundles do not pull each other's session storage or client code.
 */
export const platformClient = new NotifHubPlatformClient({
  baseUrl: API_BASE_URL,
  getToken: getPlatformToken,
});
