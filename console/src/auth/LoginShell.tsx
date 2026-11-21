import type { ReactNode } from 'react';
import { BrandMark } from '../components/BrandMark';

export type LoginLane = 'tenant' | 'platform';

const LANE_LABEL: Record<LoginLane, string> = {
  tenant: 'Tenant console',
  platform: 'Platform lane',
};

const SIGNAL_LABELS: Record<LoginLane, [string, string, string]> = {
  tenant: ['IN-APP', 'EMAIL', 'WHATSAPP'],
  platform: ['PROVISION', 'SUSPEND', 'AUDIT'],
};

const SIGNAL_Y = [60, 160, 260];

export interface LoginShellProps {
  lane: LoginLane;
  eyebrow: string;
  title: string;
  intro: string;
  headline: string;
  lede: string;
  /** Alerts rendered between the intro and the form. */
  alert?: ReactNode;
  children: ReactNode;
}

/**
 * Shared two-column login layout: product context plus the lane-specific form.
 *
 * The left panel uses a decorative signal map (a hub branching to three channels with slowly
 * travelling dashes) to suggest delivery without pretending to show live data. Auth logic stays in
 * the page components.
 */
export function LoginShell({
  lane,
  eyebrow,
  title,
  intro,
  headline,
  lede,
  alert,
  children,
}: LoginShellProps): JSX.Element {
  const labels = SIGNAL_LABELS[lane];

  return (
    <div className={`login-page login-page--${lane}`}>
      <div className="login-shell">
        <aside className="login-context">
          <div className="login-brand">
            <BrandMark variant={lane} />
            <span className="brand-name">NotifHub</span>
            <span className="login-lane">{LANE_LABEL[lane]}</span>
          </div>

          <h1>{headline}</h1>
          <p className="login-lede">{lede}</p>

          <svg className="login-map" viewBox="0 0 400 320" aria-hidden="true" role="presentation">
            <g className="login-map-base">
              {SIGNAL_Y.map((y) => (
                <path key={`base-${y}`} d={`M70 160 C 150 160, 220 ${y}, 300 ${y}`} />
              ))}
            </g>
            <g className="login-map-flow">
              {SIGNAL_Y.map((y, index) => (
                <path
                  key={`flow-${y}`}
                  d={`M70 160 C 150 160, 220 ${y}, 300 ${y}`}
                  style={{
                    animationDelay: `${-index * 3}s`,
                    animationDuration: `${9 + index * 1.5}s`,
                  }}
                />
              ))}
            </g>
            <circle className="login-map-hub" cx="70" cy="160" r="5" />
            <text className="login-map-label" x="70" y="184" textAnchor="middle">
              API
            </text>
            {SIGNAL_Y.map((y, index) => (
              <g key={`node-${y}`}>
                <circle className="login-map-node" cx="300" cy={y} r="4" />
                <text className="login-map-label" x="314" y={y + 3}>
                  {labels[index]}
                </text>
              </g>
            ))}
          </svg>
        </aside>

        <section className="login-panel">
          <div className="login-panel-inner">
            <p className="login-eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
            <p className="login-intro">{intro}</p>
            {alert}
            {children}
          </div>
        </section>
      </div>
    </div>
  );
}
