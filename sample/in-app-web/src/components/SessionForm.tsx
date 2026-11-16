import { useState, type FormEvent } from 'react';
import { createSession } from '../dev-api';
import { describeError, type ErrorInfo } from '../errors';
import type { SampleSession } from '../session';
import { ErrorNotice } from './ErrorNotice';

export interface SessionFormProps {
  onStarted: (session: SampleSession) => void;
}

export function SessionForm({ onStarted }: SessionFormProps) {
  const [recipientId, setRecipientId] = useState('user-test-1');
  const [tenant, setTenant] = useState('default');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const cleanRecipient = recipientId.trim();
    const cleanTenant = tenant.trim();

    if (cleanRecipient.length === 0 || cleanTenant.length === 0) {
      setError({
        title: 'Data sesi belum lengkap',
        message: 'recipientId dan tenant wajib diisi.',
        unauthorized: false,
      });
      return;
    }

    setPending(true);
    setError(null);

    try {
      const session = await createSession({ recipientId: cleanRecipient, tenant: cleanTenant });
      onStarted(session);
    } catch (cause: unknown) {
      setError(describeError(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="session-card" aria-labelledby="session-title">
      <p className="eyebrow">Langkah 1 · sesi lokal</p>
      <h2 id="session-title">Mulai sebagai end-user</h2>
      <p className="session-card__intro">
        Token subscriber diterbitkan server-side oleh middleware Vite. Browser tidak pernah melihat
        API key atau secret tenant.
      </p>

      <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
        <label className="field">
          <span>recipientId</span>
          <input
            value={recipientId}
            onChange={(event) => setRecipientId(event.target.value)}
            maxLength={128}
            autoComplete="off"
            spellCheck={false}
            placeholder="user-test-1"
            required
          />
          <small>Klaim <code>sub</code> pada JWT. Gunakan recipient seed agar template tersedia.</small>
        </label>

        <label className="field">
          <span>tenant</span>
          <input
            value={tenant}
            onChange={(event) => setTenant(event.target.value)}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            placeholder="default"
            required
          />
          <small>Klaim <code>tenant</code>. Efektif hanya jika tenant punya API key dengan secret.</small>
        </label>

        {error !== null ? <ErrorNotice info={error} compact /> : null}

        <button type="submit" className="button button--primary" disabled={pending}>
          {pending ? 'Menerbitkan token…' : 'Mulai'}
        </button>
      </form>

      <div className="security-note">
        <strong>Catatan keamanan</strong>
        <p>
          Token disimpan di <code>sessionStorage</code> hanya untuk sample ini. API key tetap di
          proses Vite dan tidak pernah masuk bundle browser.
        </p>
      </div>
    </section>
  );
}
