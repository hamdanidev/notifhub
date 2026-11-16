import type { NotifHubClient } from '@notifhub/js';
import { NotificationBell, useNotifHub } from '@notifhub/react';
import { useEffect, useState } from 'react';
import type { ErrorInfo } from '../errors';
import { formatDateTime } from '../format';
import { isSessionExpired, type SampleSession } from '../session';
import { ConnectionBadge } from './ConnectionBadge';
import { ErrorNotice } from './ErrorNotice';
import { InboxPanel } from './InboxPanel';
import { PreferenceCenter } from './PreferenceCenter';

export type WorkspaceTab = 'inbox' | 'preferences';

export interface WorkspaceProps {
  session: SampleSession;
  client: NotifHubClient;
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  onLogout: () => void;
  onReconnect: () => void;
  onRenew: () => void;
  renewing: boolean;
  renewError: ErrorInfo | null;
  providerError: ErrorInfo | null;
  storageWarning: boolean;
  onSimulateUnauthorized: () => void;
}

export function Workspace({
  session,
  client,
  activeTab,
  onTabChange,
  onLogout,
  onReconnect,
  onRenew,
  renewing,
  renewError,
  providerError,
  storageWarning,
  onSimulateUnauthorized,
}: WorkspaceProps) {
  const { status, unreadCount } = useNotifHub();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const expired = isSessionExpired(session, now);
  const actionLabel = renewing ? 'Memperbarui…' : 'Perbarui token & sambungkan';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            NH
          </span>
          <div>
            <p className="brand__name">NotifHub</p>
            <p className="brand__sub">In-app sample</p>
          </div>
        </div>

        <div className="app-header__actions">
          <ConnectionBadge status={status} />

          <NotificationBell
            className="bell"
            onClick={() => onTabChange('inbox')}
            renderBadge={(count) => (
              <>
                <span className="bell__icon" aria-hidden="true">
                  ◔
                </span>
                <span className="bell__count">{count > 99 ? '99+' : count}</span>
              </>
            )}
          />

          <span className="unread-label">
            <strong>{unreadCount}</strong> belum dibaca
          </span>

          <button type="button" className="button button--ghost button--small" onClick={onLogout}>
            Keluar
          </button>
        </div>
      </header>

      <div className="session-strip">
        <div className="session-strip__identity">
          <span>
            <small>recipient</small>
            <strong>{session.recipientId}</strong>
          </span>
          <span>
            <small>tenant</small>
            <strong>{session.tenant}</strong>
          </span>
          <span>
            <small>token berlaku sampai</small>
            <strong>{formatDateTime(session.expiresAt)}</strong>
          </span>
        </div>

        <div className="session-strip__actions">
          {status === 'closed' && providerError === null ? (
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={onReconnect}
            >
              Sambungkan ulang
            </button>
          ) : null}

          {expired ? (
            <button
              type="button"
              className="button button--primary button--small"
              onClick={onRenew}
              disabled={renewing}
            >
              {renewing ? 'Memperbarui…' : 'Perbarui sesi'}
            </button>
          ) : null}

          <details className="dev-tools">
            <summary>Alat uji dev</summary>
            <div>
              <p>
                Mengubah token di sesi lalu me-mount ulang provider. Backend harus membalas
                <code> 401</code>; gunakan tombol perbarui untuk pulih.
              </p>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={onSimulateUnauthorized}
              >
                Simulasikan 401 (token diubah)
              </button>
            </div>
          </details>
        </div>
      </div>

      <nav className="tabs" role="tablist" aria-label="Bagian sample">
        <button
          type="button"
          role="tab"
          id="tab-inbox"
          aria-selected={activeTab === 'inbox'}
          aria-controls="panel-inbox"
          className={activeTab === 'inbox' ? 'tab tab--active' : 'tab'}
          onClick={() => onTabChange('inbox')}
        >
          Kotak masuk
        </button>
        <button
          type="button"
          role="tab"
          id="tab-preferences"
          aria-selected={activeTab === 'preferences'}
          aria-controls="panel-preferences"
          className={activeTab === 'preferences' ? 'tab tab--active' : 'tab'}
          onClick={() => onTabChange('preferences')}
        >
          Preferensi
        </button>
      </nav>

      {storageWarning ? (
        <p className="storage-warning" role="status">
          Sesi aktif di memory, tetapi browser menolak <code>sessionStorage</code>. Refresh halaman
          akan menghapus sesi.
        </p>
      ) : null}

      {expired && providerError === null ? (
        <div className="notice notice--warning" role="status">
          <div>
            <strong>Token sesi sudah melewati waktu berlaku.</strong>
            <p>
              Koneksi baru akan ditolak dengan <code>401</code>. Perbarui token untuk melanjutkan.
            </p>
          </div>
          <button
            type="button"
            className="button button--primary button--small"
            onClick={onRenew}
            disabled={renewing}
          >
            {actionLabel}
          </button>
        </div>
      ) : null}

      {providerError !== null ? (
        <ErrorNotice
          info={providerError}
          actionLabel={
            providerError.unauthorized
              ? actionLabel
              : status === 'closed'
                ? 'Sambungkan ulang'
                : undefined
          }
          onAction={providerError.unauthorized ? onRenew : onReconnect}
          actionDisabled={renewing}
        />
      ) : null}

      {renewError !== null ? (
        <ErrorNotice
          info={renewError}
          actionLabel={renewing ? 'Memperbarui…' : 'Coba perbarui lagi'}
          onAction={onRenew}
          actionDisabled={renewing}
        />
      ) : null}

      <main
        className="workspace-main"
        id={activeTab === 'inbox' ? 'panel-inbox' : 'panel-preferences'}
        role="tabpanel"
        aria-labelledby={activeTab === 'inbox' ? 'tab-inbox' : 'tab-preferences'}
      >
        {activeTab === 'inbox' ? (
          <InboxPanel session={session} />
        ) : (
          <PreferenceCenter client={client} onRenew={onRenew} renewing={renewing} />
        )}
      </main>

      <footer className="app-footer">
        <span>
          SDK <code>@notifhub/js@0.3.0</code> + <code>@notifhub/react@0.2.0</code>
        </span>
        <span>Dev-only · token dan API key tidak masuk bundle</span>
      </footer>
    </div>
  );
}
