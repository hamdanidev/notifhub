import { NotifHubAdminClient } from '@notifhub/js';
import { API_BASE_URL } from '../env';
import { getToken } from './session';

/** Single Admin SDK instance used by every query and mutation in the console. */
export const adminClient = new NotifHubAdminClient({
  baseUrl: API_BASE_URL,
  getToken,
});
