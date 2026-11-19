import { isNotifHubError } from '@notifhub/js';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { clearPlatformSession } from './platformSession';

/**
 * Query client for the platform console.
 *
 * A 401 clears the platform session only and returns to the platform login page; tenant sessions
 * live on another origin and must never be touched from here.
 */
function handleUnauthorized(error: unknown): void {
  if (!isNotifHubError(error) || error.code !== 'unauthorized') {
    return;
  }

  clearPlatformSession();

  if (!window.location.pathname.startsWith('/platform/login')) {
    window.location.assign('/platform/login');
  }
}

export const platformQueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleUnauthorized }),
  mutationCache: new MutationCache({ onError: handleUnauthorized }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});
