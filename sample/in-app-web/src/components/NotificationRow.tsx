import type { InAppNotification } from '@notifhub/js';
import { useState } from 'react';
import { describeError, type ErrorInfo } from '../errors';
import { formatDateTime } from '../format';
import { ErrorNotice } from './ErrorNotice';

export interface NotificationRowProps {
  notification: InAppNotification;
  onMarkRead: (notificationId: string) => Promise<void>;
}

export function NotificationRow({ notification, onMarkRead }: NotificationRowProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const isRead = notification.status === 'read';

  const handleMarkRead = async (): Promise<void> => {
    if (pending) {
      return;
    }

    setPending(true);
    setError(null);
    setConfirmed(false);

    try {
      await onMarkRead(notification.notificationId);
      setConfirmed(true);
    } catch (cause: unknown) {
      setError(describeError(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={isRead ? 'notification-row notification-row--read' : 'notification-row'}>
      <button
        type="button"
        className="notification-row__main"
        onClick={() => void handleMarkRead()}
        aria-busy={pending}
        aria-label={
          isRead
            ? `Notifikasi sudah dibaca: ${notification.body ?? notification.templateKey}`
            : `Tandai dibaca: ${notification.body ?? notification.templateKey}`
        }
      >
        <span className="notification-row__topline">
          <span className={isRead ? 'read-dot read-dot--read' : 'read-dot'} aria-hidden="true" />
          <span className="notification-row__status">
            {isRead ? 'Dibaca' : pending ? 'Menandai dibaca…' : 'Belum dibaca'}
          </span>
          <time dateTime={notification.createdAt}>{formatDateTime(notification.createdAt)}</time>
        </span>

        {notification.subject !== null && notification.subject.length > 0 ? (
          <strong className="notification-row__subject">{notification.subject}</strong>
        ) : null}

        <span className="notification-row__body">
          {notification.body ?? 'Isi template tidak tersedia (template mungkin sudah dihapus).'}
        </span>

        <span className="notification-row__meta">
          <span>{notification.templateKey}</span>
          <span>prioritas {notification.priority}</span>
          {notification.readAt !== undefined && notification.readAt !== null ? (
            <span>dibaca {formatDateTime(notification.readAt)}</span>
          ) : null}
        </span>

        <code className="notification-row__id" title={notification.notificationId}>
          {notification.notificationId}
        </code>
      </button>

      {confirmed && !error ? (
        <p className="inline-success" role="status">
          Read receipt diterima. Status lokal dan baris <code>NotificationRecipient</code> sudah
          diperbarui.
        </p>
      ) : null}

      {error !== null ? <ErrorNotice info={error} compact /> : null}
    </div>
  );
}
