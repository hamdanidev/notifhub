export function EmptyState({
  message,
  title = 'Belum ada data',
}: {
  message: string;
  title?: string;
}): JSX.Element {
  return (
    <div className="empty-state">
      <div className="fw-medium text-body">{title}</div>
      <div className="mt-1">{message}</div>
    </div>
  );
}
