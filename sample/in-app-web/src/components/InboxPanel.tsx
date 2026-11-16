import { NotificationInbox, useNotifHub } from '@notifhub/react';
import { useState, type FormEvent } from 'react';
import { sendTestNotification, type TestChannel } from '../dev-api';
import { describeError, type ErrorInfo } from '../errors';
import type { SampleSession } from '../session';
import { ErrorNotice } from './ErrorNotice';
import { NotificationRow } from './NotificationRow';

export interface InboxPanelProps {
  session: SampleSession;
}

const CHANNEL_OPTIONS: Array<{ value: TestChannel; label: string }> = [
  { value: 'inapp', label: 'In-app (muncul lewat SSE)' },
  { value: 'email', label: 'Email (development log-only)' },
  { value: 'whatsapp', label: 'WhatsApp (development log-only)' },
];

export function InboxPanel({ session }: InboxPanelProps) {
  const { notifications, status, markRead, refresh } = useNotifHub();
  const [name, setName] = useState('Budi');
  const [channel, setChannel] = useState<TestChannel>('inapp');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<ErrorInfo | null>(null);
  const [sendResult, setSendResult] = useState<{ id: string; channel: TestChannel } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<ErrorInfo | null>(null);

  const handleSend = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (sending) {
      return;
    }

    setSending(true);
    setSendError(null);
    setSendResult(null);

    try {
      const result = await sendTestNotification({
        recipientId: session.recipientId,
        channel,
        name: name.trim(),
      });

      setSendResult({ id: result.notification_id, channel });
    } catch (cause: unknown) {
      setSendError(describeError(cause));
    } finally {
      setSending(false);
    }
  };

  const handleRefresh = async (): Promise<void> => {
    if (refreshing) {
      return;
    }

    setRefreshing(true);
    setRefreshError(null);

    try {
      await refresh();
    } catch (cause: unknown) {
      setRefreshError(describeError(cause));
    } finally {
      setRefreshing(false);
    }
  };

  const emptyState =
    status === 'connecting' && notifications.length === 0 ? (
      <div className="loading-state">
        <span className="spinner" aria-hidden="true" />
        Memuat notifikasi pertama…
      </div>
    ) : (
      <div className="empty-state">
        <span className="empty-state__mark" aria-hidden="true">
          0
        </span>
        <p>Belum ada notifikasi.</p>
        <small>Kirim notifikasi uji di panel sebelah untuk melihat SSE bekerja tanpa refresh.</small>
      </div>
    );

  return (
    <div className="inbox-layout">
      <section className="panel panel--composer" aria-labelledby="composer-title">
        <p className="eyebrow">Alat uji lokal</p>
        <h2 id="composer-title">Kirim notifikasi uji</h2>
        <p className="panel__intro">
          Request browser hanya memanggil <code>/dev/notify</code>. Middleware Vite menambahkan
          <code> X-API-Key</code> di server, lalu memanggil <code>/api/v1/notify</code>.
        </p>

        <form className="form-stack" onSubmit={(event) => void handleSend(event)}>
          <label className="field">
            <span>Nama untuk data template</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              autoComplete="off"
              required
            />
            <small>
              Dipakai sebagai <code>{'{{nama}}'}</code> pada template <code>test.notification</code>.
            </small>
          </label>

          <label className="field">
            <span>Channel</span>
            <select
              value={channel}
              onChange={(event) => {
                const value = event.target.value;

                if (value === 'inapp' || value === 'email' || value === 'whatsapp') {
                  setChannel(value);
                }
              }}
            >
              {CHANNEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" className="button button--primary" disabled={sending}>
            {sending ? 'Mengirim…' : 'Kirim notifikasi uji'}
          </button>
        </form>

        {sendError !== null ? <ErrorNotice info={sendError} compact /> : null}

        {sendResult !== null ? (
          <div className="inline-success" role="status">
            <strong>Backend menerima notifikasi.</strong>
            <span>
              id <code>{sendResult.id}</code>
            </span>
            <span>
              {sendResult.channel === 'inapp'
                ? 'Tunggu event SSE; item harus muncul tanpa refresh.'
                : 'Channel ini diproses worker, tetapi development bersifat log-only.'}
            </span>
          </div>
        ) : null}

        <div className="composer-note">
          <strong>Tenant mengikuti API key</strong>
          <p>
            Body notify tidak mengirim tenant. Backend menentukan tenant dari API key server-side.
            Session tenant hanya dipakai untuk menandatangani token.
          </p>
        </div>
      </section>

      <section className="panel panel--inbox" aria-labelledby="inbox-title">
        <div className="panel__heading">
          <div>
            <p className="eyebrow">Catch-up + SSE</p>
            <h2 id="inbox-title">Kotak masuk</h2>
          </div>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
          >
            {refreshing ? 'Memuat…' : 'Muat ulang'}
          </button>
        </div>

        <p className="panel__intro">
          {notifications.length} notifikasi di memori. Klik item untuk memanggil{' '}
          <code>markRead()</code>; provider memperbarui unread count setelah receipt diterima.
        </p>

        {refreshError !== null ? <ErrorNotice info={refreshError} compact /> : null}

        <NotificationInbox
          limit={20}
          className="inbox-list"
          emptyState={emptyState}
          renderItem={(notification) => (
            <NotificationRow
              key={notification.notificationId}
              notification={notification}
              onMarkRead={markRead}
            />
          )}
        />
      </section>
    </div>
  );
}
