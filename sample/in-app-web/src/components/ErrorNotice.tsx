import type { ErrorInfo } from '../errors';

export interface ErrorNoticeProps {
  info: ErrorInfo;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  compact?: boolean;
}

export function ErrorNotice({
  info,
  actionLabel,
  onAction,
  actionDisabled = false,
  compact = false,
}: ErrorNoticeProps) {
  return (
    <div className={compact ? 'error-notice error-notice--compact' : 'error-notice'} role="alert">
      <div>
        <p className="error-notice__title">{info.title}</p>
        <p className="error-notice__message">{info.message}</p>
        {info.requestId !== undefined && info.requestId !== null ? (
          <p className="error-notice__meta">requestId: {info.requestId}</p>
        ) : null}
      </div>

      {actionLabel !== undefined && onAction !== undefined ? (
        <button
          type="button"
          className="button button--danger"
          onClick={onAction}
          disabled={actionDisabled}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
