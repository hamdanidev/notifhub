import type { InAppNotification, NotifHubClient, NotifHubError } from '@notifhub/js';
import type { ReactNode } from 'react';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface NotifHubContextValue {
  client: NotifHubClient;
  status: ConnectionStatus;
  notifications: InAppNotification[];
  unreadCount: number;
  markRead: (notificationId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export interface NotifHubProviderProps {
  client: NotifHubClient;
  /** Maximum number of notifications kept in memory (default 50). */
  limit?: number;
  onError?: (error: NotifHubError) => void;
  children: ReactNode;
}
