import type { ReactNode } from 'react';

export type LoginLane = 'tenant' | 'platform';

export interface LoginLedgerRow {
  time: string;
  channel: string;
  status: string;
  tone: 'accent' | 'ok' | 'warn';
}

const LEDGER_ROWS: Record<LoginLane, LoginLedgerRow[]> = {
  tenant: [
    { time: '09:41:02', channel: 'in-app', status: 'queued', tone: 'accent' },
    { time: '09:41:03', channel: 'email', status: 'sent', tone: 'ok' },
    { time: '09:41:04', channel: 'whatsapp', status: 'delivered', tone: 'ok' },
  ],
  platform: [
    { time: '09:38:11', channel: 'tenant', status: 'acme · created', tone: 'ok' },
    { time: '09:39:27', channel: 'tenant', status: 'beta · suspended', tone: 'warn' },
    { time: '09:40:02', channel: 'audit', status: 'platform.login', tone: 'accent' },
  ],
};

const LANE_LABEL: Record<LoginLane, string> = {
  tenant: 'Tenant console',
  platform: 'Platform lane',
};

export interface LoginShellProps {
  lane: LoginLane;
  eyebrow: string;
  title: string;
  intro: string;
  headline: string;
  lede: string;
  asideFoot: string;
  /** Alerts rendered between the intro and the form. */
  alert?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}

/**
 * Shared two-column login layout: product context plus the lane-specific form.
 *
 * The ledger rows are a static example of the delivery flow, labelled as such, so they are never
 * mistaken for live operational data. Auth logic stays in the page components.
 */
export function LoginShell({
  lane,
  eyebrow,
  title,
  intro,
  headline,
  lede,
  asideFoot,
  alert,
  footer,
  children,
}: LoginShellProps): JSX.Element {
  const rows = LEDGER_ROWS[lane];

  return (
    <div className={`login-page login-page--${lane}`}>
      <div className="login-shell">
        <aside className="login-context">
          <div className="login-brand">
            <span className="brand-mark">N</span>
            <span className="brand-name">NotifHub</span>
            <span className="login-lane">{LANE_LABEL[lane]}</span>
          </div>

          <h1>{headline}</h1>
          <p className="login-lede">{lede}</p>

          <p className="login-ledger-label">Contoh alur</p>
          <div className="login-ledger" role="list" aria-label="Contoh alur">
            {rows.map((row) => (
              <div className="login-ledger-row" role="listitem" key={`${row.channel}-${row.status}`}>
                <time>{row.time}</time>
                <span className="channel">{row.channel}</span>
                <span className="login-status">{row.status}</span>
                <span className={`login-dot login-dot--${row.tone}`} aria-hidden="true" />
              </div>
            ))}
          </div>

          <p className="login-aside-foot">{asideFoot}</p>
        </aside>

        <section className="login-panel">
          <p className="login-eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p className="login-intro">{intro}</p>
          {alert}
          {children}
          <p className="login-footnote">{footer}</p>
        </section>
      </div>
    </div>
  );
}
