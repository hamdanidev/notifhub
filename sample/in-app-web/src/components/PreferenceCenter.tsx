import type {
  ChannelPreference,
  NotifHubClient,
  PreferenceChannel,
  UpdatePreferenceInput,
} from '@notifhub/js';
import { usePreferences } from '@notifhub/react';
import { useEffect, useState } from 'react';
import { describeError, type ErrorInfo } from '../errors';
import { formatDateTime } from '../format';
import { ErrorNotice } from './ErrorNotice';

export interface PreferenceCenterProps {
  client: NotifHubClient;
  onRenew: () => void;
  renewing: boolean;
}

interface PreferenceDraft {
  enabled: boolean;
  quietEnabled: boolean;
  quietStart: string;
  quietEnd: string;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_QUIET_START = '22:00';
const DEFAULT_QUIET_END = '07:00';

const CHANNEL_COPY: Record<PreferenceChannel, { title: string; description: string }> = {
  inapp: {
    title: 'In-app',
    description:
      'Notifikasi di dalam aplikasi. Mematikan channel ini membuat notifikasi in-app baru tidak dikirim.',
  },
  email: {
    title: 'Email',
    description:
      'Email transaksional. Di development, worker berjalan log-only dan tidak membuka koneksi SMTP.',
  },
  whatsapp: {
    title: 'WhatsApp',
    description:
      'Pesan teks WhatsApp. Di development, worker berjalan log-only tanpa memanggil Meta Cloud API.',
  },
};

function toDraft(preference: ChannelPreference): PreferenceDraft {
  const hasQuietHours =
    preference.quietHoursStart !== null && preference.quietHoursEnd !== null;

  return {
    enabled: preference.enabled,
    quietEnabled: hasQuietHours,
    quietStart: preference.quietHoursStart ?? DEFAULT_QUIET_START,
    quietEnd: preference.quietHoursEnd ?? DEFAULT_QUIET_END,
  };
}

function isDirty(draft: PreferenceDraft, preference: ChannelPreference): boolean {
  const hasQuietHours =
    preference.quietHoursStart !== null && preference.quietHoursEnd !== null;

  if (draft.enabled !== preference.enabled || draft.quietEnabled !== hasQuietHours) {
    return true;
  }

  if (!draft.quietEnabled) {
    return false;
  }

  return (
    draft.quietStart !== preference.quietHoursStart || draft.quietEnd !== preference.quietHoursEnd
  );
}

function validateDraft(draft: PreferenceDraft): string | null {
  if (!draft.quietEnabled) {
    return null;
  }

  if (!TIME_PATTERN.test(draft.quietStart) || !TIME_PATTERN.test(draft.quietEnd)) {
    return 'Quiet hours harus memakai format 24 jam HH:mm.';
  }

  if (draft.quietStart === draft.quietEnd) {
    return 'Jam mulai dan jam selesai quiet hours tidak boleh sama.';
  }

  return null;
}

interface ChannelCardProps {
  preference: ChannelPreference;
  onSave: (channel: PreferenceChannel, input: UpdatePreferenceInput) => Promise<ChannelPreference>;
  onRenew: () => void;
  renewing: boolean;
}

function ChannelCard({ preference, onSave, onRenew, renewing }: ChannelCardProps) {
  const [draft, setDraft] = useState<PreferenceDraft>(() => toDraft(preference));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<ErrorInfo | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(toDraft(preference));
  }, [preference]);

  const copy = CHANNEL_COPY[preference.channel];
  const dirty = isDirty(draft, preference);

  const updateDraft = (next: PreferenceDraft): void => {
    setDraft(next);
    setFormError(null);
    setRequestError(null);
    setSaved(false);
  };

  const handleSave = async (): Promise<void> => {
    if (saving) {
      return;
    }

    const validation = validateDraft(draft);

    if (validation !== null) {
      setFormError(validation);
      return;
    }

    const input: UpdatePreferenceInput = { enabled: draft.enabled };

    if (draft.quietEnabled) {
      input.quietHoursStart = draft.quietStart;
      input.quietHoursEnd = draft.quietEnd;
    }

    setSaving(true);
    setFormError(null);
    setRequestError(null);
    setSaved(false);

    try {
      await onSave(preference.channel, input);
      setSaved(true);
    } catch (cause: unknown) {
      setRequestError(describeError(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="preference-card" aria-labelledby={`channel-${preference.channel}`}>
      <div className="preference-card__heading">
        <div>
          <p className="eyebrow">Channel</p>
          <h3 id={`channel-${preference.channel}`}>{copy.title}</h3>
        </div>
        <div className="preference-card__badges">
          {preference.isDefault ? <span className="badge badge--muted">Default</span> : null}
          <span className={preference.enabled ? 'badge badge--on' : 'badge badge--off'}>
            {preference.enabled ? 'Aktif' : 'Nonaktif'}
          </span>
        </div>
      </div>

      <p className="preference-card__copy">{copy.description}</p>

      <label className="switch-row">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => updateDraft({ ...draft, enabled: event.target.checked })}
          disabled={saving}
        />
        <span>
          <strong>Aktifkan channel ini</strong>
          <small>Perubahan baru berlaku setelah tombol simpan ditekan.</small>
        </span>
      </label>

      {preference.channel === 'inapp' && !draft.enabled ? (
        <p className="preference-warning" role="note">
          Notifikasi in-app baru akan di-skip dengan alasan <code>preference_disabled</code>.
        </p>
      ) : null}

      <fieldset className="quiet-hours">
        <legend>Quiet hours (opsional)</legend>
        <label className="switch-row switch-row--tight">
          <input
            type="checkbox"
            checked={draft.quietEnabled}
            onChange={(event) =>
              updateDraft({ ...draft, quietEnabled: event.target.checked })
            }
            disabled={saving}
          />
          <span>
            <strong>Tunda notifikasi non-kritis pada jam tertentu</strong>
            <small>
              Prioritas critical tetap dikirim. Timezone channel: {preference.timezone}.
            </small>
          </span>
        </label>

        <div className="quiet-hours__inputs">
          <label className="field field--time">
            <span>Mulai</span>
            <input
              type="time"
              value={draft.quietStart}
              onChange={(event) => updateDraft({ ...draft, quietStart: event.target.value })}
              disabled={!draft.quietEnabled || saving}
              step={60}
            />
          </label>
          <span className="quiet-hours__dash" aria-hidden="true">
            →
          </span>
          <label className="field field--time">
            <span>Selesai</span>
            <input
              type="time"
              value={draft.quietEnd}
              onChange={(event) => updateDraft({ ...draft, quietEnd: event.target.value })}
              disabled={!draft.quietEnabled || saving}
              step={60}
            />
          </label>
        </div>
      </fieldset>

      <div className="preference-card__meta">
        <span>timezone {preference.timezone}</span>
        {preference.updatedAt !== null ? (
          <span>diperbarui {formatDateTime(preference.updatedAt)}</span>
        ) : (
          <span>belum pernah disimpan</span>
        )}
      </div>

      {formError !== null ? <p className="form-error">{formError}</p> : null}

      {requestError !== null ? (
        <ErrorNotice
          info={requestError}
          compact
          actionLabel={
            requestError.unauthorized
              ? renewing
                ? 'Memperbarui…'
                : 'Perbarui sesi'
              : undefined
          }
          onAction={requestError.unauthorized ? onRenew : undefined}
          actionDisabled={renewing}
        />
      ) : null}

      {saved && requestError === null ? (
        <p className="inline-success" role="status">
          Preferensi {copy.title} tersimpan.
          {preference.quietHoursStart !== null && preference.quietHoursEnd !== null
            ? ` Quiet hours ${preference.quietHoursStart}–${preference.quietHoursEnd}.`
            : ''}
        </p>
      ) : null}

      <div className="preference-card__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
        >
          {saving ? 'Menyimpan…' : 'Simpan channel'}
        </button>
      </div>
    </article>
  );
}

export function PreferenceCenter({ client, onRenew, renewing }: PreferenceCenterProps) {
  const { preferences, status, error, reload, update } = usePreferences(client);

  const handleReload = async (): Promise<void> => {
    await reload();
  };

  if (status === 'loading' && preferences === null) {
    return (
      <section className="panel" aria-busy="true" aria-label="Memuat preferensi">
        <p className="eyebrow">Preference center</p>
        <h2>Memuat preferensi…</h2>
        <div className="preference-grid">
          {[0, 1, 2].map((index) => (
            <div className="preference-card skeleton-card" key={index}>
              <span className="skeleton-line skeleton-line--short" />
              <span className="skeleton-line" />
              <span className="skeleton-line" />
              <span className="skeleton-line skeleton-line--short" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (preferences === null) {
    const info: ErrorInfo =
      error !== null
        ? describeError(error)
        : {
            title: 'Preferensi tidak dapat dimuat',
            message: 'Respons kosong dari hook usePreferences.',
            unauthorized: false,
          };

    return (
      <section className="panel" aria-labelledby="preferences-error-title">
        <p className="eyebrow">Preference center</p>
        <h2 id="preferences-error-title">Preferensi belum tersedia</h2>
        <ErrorNotice
          info={info}
          actionLabel={
            info.unauthorized
              ? renewing
                ? 'Memperbarui…'
                : 'Perbarui sesi'
              : 'Muat ulang'
          }
          onAction={
            info.unauthorized
              ? onRenew
              : () => {
                  void handleReload();
                }
          }
          actionDisabled={info.unauthorized ? renewing : false}
        />
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="preferences-title">
      <div className="panel__heading">
        <div>
          <p className="eyebrow">Subscriber lane · usePreferences()</p>
          <h2 id="preferences-title">Preference center</h2>
        </div>
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => {
            void handleReload();
          }}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Memuat…' : 'Muat ulang'}
        </button>
      </div>

      <p className="panel__intro">
        {preferences.recipientId} · tenant tampil dari token · locale{' '}
        <code>{preferences.locale ?? 'null'}</code> · timezone{' '}
        <code>{preferences.timezone}</code>
      </p>

      {error !== null ? (
        <ErrorNotice
          info={describeError(error)}
          actionLabel={error.code === 'unauthorized' ? 'Perbarui sesi' : 'Muat ulang'}
          onAction={
            error.code === 'unauthorized'
              ? onRenew
              : () => {
                  void handleReload();
                }
          }
          actionDisabled={error.code === 'unauthorized' ? renewing : false}
        />
      ) : null}

      <div className="preference-grid">
        {preferences.channels.map((preference) => (
          <ChannelCard
            key={preference.channel}
            preference={preference}
            onSave={update}
            onRenew={onRenew}
            renewing={renewing}
          />
        ))}
      </div>

      <p className="preferences-note">
        Quiet hours disimpan sebagai full snapshot per channel. Menghapus centang quiet hours akan
        mengosongkan <code>quietHoursStart</code>/<code>quietHoursEnd</code> pada channel tersebut.
      </p>
    </section>
  );
}
