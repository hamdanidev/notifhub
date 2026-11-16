import { isNotifHubError } from '@notifhub/js';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { clearSession } from './session';

function handleGlobalError(error: unknown): void {
  if (isNotifHubError(error) && error.code === 'unauthorized') {
    clearSession();

    if (!window.location.pathname.startsWith('/login')) {
      window.location.assign('/login');
    }
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleGlobalError }),
  mutationCache: new MutationCache({ onError: handleGlobalError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
