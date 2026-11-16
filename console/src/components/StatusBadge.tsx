const STATUS_CLASSES: Record<string, string> = {
  pending: 'status--pending',
  partial: 'status--partial',
  sent: 'status--sent',
  read: 'status--read',
  failed: 'status--failed',
  skipped: 'status--skipped',
};

export function StatusBadge({ status }: { status: string }): JSX.Element {
  return (
    <span className={`status ${STATUS_CLASSES[status] ?? 'status--pending'}`}>
      {status}
    </span>
  );
}
