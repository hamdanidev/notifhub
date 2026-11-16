import type { ReactNode } from 'react';
import { Alert, Button } from 'react-bootstrap';
import { describeError } from '../lib/format';
import { Skeleton, TableSkeleton } from './Skeleton';

export interface QueryStateProps {
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  skeleton?: 'table' | 'card' | 'lines';
  children: ReactNode;
}

export function QueryState({
  isLoading,
  error,
  onRetry,
  skeleton = 'lines',
  children,
}: QueryStateProps): JSX.Element {
  if (isLoading) {
    if (skeleton === 'table') {
      return <TableSkeleton rows={6} columns={5} />;
    }

    if (skeleton === 'card') {
      return (
        <div className="d-flex flex-column gap-2 py-2">
          <Skeleton width="40%" height={18} />
          <Skeleton width="100%" />
          <Skeleton width="82%" />
          <Skeleton width="60%" />
        </div>
      );
    }

    return (
      <div className="d-flex flex-column gap-2 py-2">
        <Skeleton width="34%" />
        <Skeleton width="90%" />
        <Skeleton width="70%" />
      </div>
    );
  }

  if (error !== null && error !== undefined) {
    return (
      <Alert variant="danger" className="d-flex align-items-center justify-content-between gap-3">
        <span>{describeError(error)}</span>
        {onRetry !== undefined ? (
          <Button size="sm" variant="outline-danger" onClick={onRetry}>
            Coba lagi
          </Button>
        ) : null}
      </Alert>
    );
  }

  return <>{children}</>;
}
