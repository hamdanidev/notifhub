import type { SampleSession } from '../session';
import { SessionForm } from './SessionForm';

export interface LandingProps {
  onStarted: (session: SampleSession) => void;
}

export function Landing({ onStarted }: LandingProps) {
  return (
    <div className="app-shell landing-shell">
      <header className="app-header app-header--landing">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            NH
          </span>
          <div>
            <p className="brand__name">NotifHub</p>
            <p className="brand__sub">In-app sample</p>
          </div>
        </div>
        <span className="landing-header-note">React 18 · Vite · SDK npm</span>
      </header>

      <main className="landing">
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">Contoh integrasi end-user</p>
          <h1 id="hero-title">
            Notifikasi in-app,
            <br />
            dari event sampai <em>read receipt</em>.
          </h1>
          <p className="hero__copy">
            Sample lokal untuk melihat <code>@notifhub/react</code> bekerja headless: bell, inbox,
            status SSE, markRead, dan preference center dengan quiet hours.
          </p>

          <div className="hero__facts">
            <article>
              <span className="fact__number">01</span>
              <h2>SSE tanpa refresh</h2>
              <p>
                Fetch-based SSE dari SDK, bukan <code>EventSource</code>. Token tetap di header
                <code> Authorization</code>.
              </p>
            </article>
            <article>
              <span className="fact__number">02</span>
              <h2>Read receipt nyata</h2>
              <p>
                Klik item memanggil <code>markRead()</code>; unread count berubah dan baris DB ikut
                diperbarui.
              </p>
            </article>
            <article>
              <span className="fact__number">03</span>
              <h2>Secret tetap di server</h2>
              <p>
                API key dan secret tenant hanya dibaca middleware Vite. Browser memegang subscriber
                JWT berumur pendek.
              </p>
            </article>
          </div>

          <div className="hero__warning" role="note">
            <strong>Hanya untuk lokal.</strong> Middleware <code>/dev/*</code> tidak ikut build
            produksi dan tidak boleh dipakai sebagai pola deployment.
          </div>
        </section>

        <SessionForm onStarted={onStarted} />
      </main>

      <footer className="app-footer">
        <span>NotifHub v0.10.0</span>
        <span>@notifhub/js 0.3.0 · @notifhub/react 0.2.0</span>
      </footer>
    </div>
  );
}
