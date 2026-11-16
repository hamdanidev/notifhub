import { useNotifHub } from './provider';

export interface NotificationBellProps {
  onClick?: () => void;
  className?: string;
  renderBadge?: (unreadCount: number) => React.ReactNode;
}

/** Headless bell button: renders the unread count with stable class names, no styling. */
export function NotificationBell({ onClick, className, renderBadge }: NotificationBellProps): JSX.Element {
  const { unreadCount } = useNotifHub();
  const label = unreadCount === 0 ? 'Notifications' : `Notifications (${unreadCount} unread)`;

  return (
    <button
      type="button"
      className={className === undefined ? 'notifhub-bell' : `notifhub-bell ${className}`}
      onClick={onClick}
      aria-label={label}
    >
      {renderBadge === undefined ? (
        <span className="notifhub-bell__count" aria-hidden="true">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      ) : (
        renderBadge(unreadCount)
      )}
    </button>
  );
}
