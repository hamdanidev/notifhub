import { NotifHubAdminClient, NotifHubTemplatesClient } from '@notifhub/js';
import { API_BASE_URL } from '../env';
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
