import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NotificationBell } from '../src/bell';
import { NotificationInbox } from '../src/inbox';
import { NotifHubContext } from '../src/provider';
import type { NotifHubContextValue } from '../src/types';
import type { InAppNotification } from '@notifhub/js';

function contextValue(overrides: Partial<NotifHubContextValue> = {}): NotifHubContextValue {
  const notification: InAppNotification = {
    notificationId: 'n1',
    templateKey: 'test.notification',
    subject: null,
    body: 'Halo Budi',
    data: { nama: 'Budi' },
    priority: 3,
    status: 'sent',
    createdAt: '2026-01-01T00:00:00.000Z',
    readAt: null,
  };

  return {
    client: {} as NotifHubContextValue['client'],
    status: 'open',
    notifications: [notification],
    unreadCount: 1,
    markRead: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('@notifhub/react', () => {
  it('renders the unread count in the bell', () => {
    const html = renderToStaticMarkup(
      <NotifHubContext.Provider value={contextValue({ unreadCount: 3 })}>
        <NotificationBell />
      </NotifHubContext.Provider>,
    );

    expect(html).toContain('notifhub-bell');
    expect(html).toContain('>3<');
    expect(html).toContain('Notifications (3 unread)');
  });

  it('renders notification bodies in the inbox', () => {
    const html = renderToStaticMarkup(
      <NotifHubContext.Provider value={contextValue()}>
        <NotificationInbox />
      </NotifHubContext.Provider>,
    );

    expect(html).toContain('Halo Budi');
    expect(html).toContain('notifhub-inbox__button');
  });

  it('renders the empty state when there are no notifications', () => {
    const html = renderToStaticMarkup(
      <NotifHubContext.Provider value={contextValue({ notifications: [], unreadCount: 0 })}>
        <NotificationInbox emptyState="Kosong" />
      </NotifHubContext.Provider>,
    );

    expect(html).toContain('Kosong');
  });
});
