import type { InAppNotification } from '@notifhub/js';
import { useNotifHub } from './provider';

export type NotificationBodyRenderMode = 'text' | 'safe-html';

export interface NotificationInboxProps {
  limit?: number;
  className?: string;
  emptyState?: React.ReactNode;
  /**
   * `safe-html` renders `bodyHtml` (server-sanitized subset for markdown templates) with
   * `dangerouslySetInnerHTML`. Only enable it against a trusted NotifHub backend; the default
   * `text` renders `body` as plain text.
   */
  renderBody?: NotificationBodyRenderMode;
  renderItem?: (notification: InAppNotification) => React.ReactNode;
  onNotificationClick?: (notification: InAppNotification) => void;
}

/** Headless list of notifications; marks an item as read when clicked. */
export function NotificationInbox({
  limit = 20,
  className,
  emptyState,
  renderBody = 'text',
  renderItem,
  onNotificationClick,
}: NotificationInboxProps): JSX.Element {
  const { notifications, markRead } = useNotifHub();
  const items = notifications.slice(0, limit);
  const rootClassName = className === undefined ? 'notifhub-inbox' : `notifhub-inbox ${className}`;

  if (items.length === 0) {
    return (
      <div className={`${rootClassName} notifhub-inbox--empty`}>
        {emptyState ?? 'No notifications'}
      </div>
    );
  }

  return (
    <ul className={rootClassName}>
      {items.map((notification) => (
        <li
          key={notification.notificationId}
          className={
            notification.status === 'read'
              ? 'notifhub-inbox__item notifhub-inbox__item--read'
              : 'notifhub-inbox__item'
          }
        >
          {renderItem !== undefined ? (
            renderItem(notification)
          ) : (
            <button
              type="button"
              className="notifhub-inbox__button"
              onClick={() => {
                onNotificationClick?.(notification);
                void markRead(notification.notificationId).catch(() => undefined);
              }}
            >
              {renderBody === 'safe-html' && notification.bodyHtml != null ? (
                <span
                  className="notifhub-inbox__body"
                  dangerouslySetInnerHTML={{ __html: notification.bodyHtml }}
                />
              ) : (
                <span className="notifhub-inbox__body">{notification.body}</span>
              )}
              <time className="notifhub-inbox__time" dateTime={notification.createdAt}>
                {new Date(notification.createdAt).toLocaleString()}
              </time>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
