import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle !== undefined ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions !== undefined ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
