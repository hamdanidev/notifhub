import type { ConnectionStatus } from '@notifhub/react';

const LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Menghubungkan…',
  open: 'SSE terhubung',
  closed: 'SSE terputus',
};

export interface ConnectionBadgeProps {
  status: ConnectionStatus;
}

export function ConnectionBadge({ status }: ConnectionBadgeProps) {
  return (
    <span className={`connection-badge connection-badge--${status}`} role="status" aria-live="polite">
      <span className="connection-badge__dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
