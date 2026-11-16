import { isNotifHubError, type InAppNotification, type NotifHubError } from '@notifhub/js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ConnectionStatus, NotifHubContextValue, NotifHubProviderProps } from './types';

export const NotifHubContext = createContext<NotifHubContextValue | null>(null);

const DEFAULT_LIMIT = 50;

/**
 * Creates one SSE subscription for the surrounding subtree and keeps a bounded list of
 * notifications plus the derived unread count.
 */
export function NotifHubProvider({
  client,
  limit = DEFAULT_LIMIT,
  onError,
  children,
}: NotifHubProviderProps): JSX.Element {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const reportError = useCallback((error: unknown): void => {
    if (isNotifHubError(error)) {
      onErrorRef.current?.(error as NotifHubError);
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const page = await client.getNotifications({ limit });
    setNotifications(page.items);
  }, [client, limit]);

  useEffect(() => {
    let cancelled = false;

    void refresh().catch((error: unknown) => {
      if (!cancelled) {
        reportError(error);
      }
    });

    const subscription = client.subscribe({
      onOpen: () => {
        if (!cancelled) {
          setStatus('open');
        }
      },
      onNotification: (notification) => {
        if (cancelled) {
          return;
        }

        setNotifications((previous) => {
          if (previous.some((item) => item.notificationId === notification.notificationId)) {
            return previous;
          }

          return [notification, ...previous].slice(0, limit);
        });
      },
      onError: (error) => {
        if (!cancelled) {
          setStatus('closed');
          reportError(error);
        }
      },
    });

    return () => {
      cancelled = true;
      subscription.close();
      setStatus('closed');
    };
  }, [client, limit, refresh, reportError]);

  const markRead = useCallback(
    async (notificationId: string): Promise<void> => {
      await client.markRead(notificationId);

      setNotifications((previous) =>
        previous.map((item) =>
          item.notificationId === notificationId
            ? { ...item, status: 'read', readAt: new Date().toISOString() }
            : item,
        ),
      );
    },
    [client],
  );

  const unreadCount = useMemo(
    () => notifications.filter((notification) => notification.status !== 'read').length,
    [notifications],
  );

  const value = useMemo<NotifHubContextValue>(
    () => ({ client, status, notifications, unreadCount, markRead, refresh }),
    [client, status, notifications, unreadCount, markRead, refresh],
  );

  return <NotifHubContext.Provider value={value}>{children}</NotifHubContext.Provider>;
}

export function useNotifHub(): NotifHubContextValue {
  const context = useContext(NotifHubContext);

  if (context === null) {
    throw new Error('useNotifHub must be used inside <NotifHubProvider>');
  }

  return context;
}
