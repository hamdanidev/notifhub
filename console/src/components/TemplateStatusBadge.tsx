import type { TemplateStatus } from '@notifhub/js';

export function TemplateStatusBadge({ status }: { status: TemplateStatus }): JSX.Element {
  return (
    <span className={`status ${status === 'published' ? 'status--sent' : 'status--pending'}`}>
      {status}
    </span>
  );
}
