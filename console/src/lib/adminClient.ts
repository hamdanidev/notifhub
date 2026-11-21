import {
  NotifHubAdminClient,
  NotifHubPlatformClient,
  NotifHubTemplatesClient,
} from '@notifhub/js';
import { API_BASE_URL } from '../env';
import { getPlatformToken } from './platformSession';
import { getToken } from './session';

/** Single Admin SDK instance used by every query and mutation in the console. */
export const adminClient = new NotifHubAdminClient({
  baseUrl: API_BASE_URL,
  getToken,
});

/** Template v2 (templates, versions, preview/test send, assets and image upload). */
export const templatesClient = new NotifHubTemplatesClient({
  baseUrl: API_BASE_URL,
  getToken,
});

/** Platform lane (tenant provisioning, tenant admins, platform audit). */
export const platformClient = new NotifHubPlatformClient({
  baseUrl: API_BASE_URL,
  getToken: getPlatformToken,
});
