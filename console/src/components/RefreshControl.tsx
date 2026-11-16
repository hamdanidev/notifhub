import { useEffect, useState } from 'react';
import { Button } from 'react-bootstrap';
import { formatUpdatedAt } from '../lib/format';
import { Icon } from './Icon';

export interface RefreshControlProps {
  isFetching: boolean;
  updatedAt: number;
  onRefresh: () => void;
  autoRefreshMs?: number;
}

export function RefreshControl({
  isFetching,
  updatedAt,
  onRefresh,
  autoRefreshMs,
}: RefreshControlProps): JSX.Element {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="refresh-control">
      {autoRefreshMs !== undefined ? (
        <span className="refresh-auto">
          <span className="refresh-auto-dot" aria-hidden="true" />
          Auto-refresh {Math.round(autoRefreshMs / 1000)}s
        </span>
      ) : null}
      <span className="refresh-updated">Diperbarui {formatUpdatedAt(updatedAt, now)}</span>
      <Button
        type="button"
        size="sm"
        variant="outline-secondary"
        className="refresh-button"
        onClick={onRefresh}
        disabled={isFetching}
      >
        <Icon name="refresh" size={14} className={isFetching ? 'icon-spin' : undefined} />
        {isFetching ? 'Memuat…' : 'Muat ulang'}
      </Button>
    </div>
  );
}
