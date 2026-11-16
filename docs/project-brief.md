# Project brief

Konteks ringkas untuk siapa pun (atau sesi AI) yang melanjutkan pekerjaan di NotifHub.
Dokumen ini menggambarkan kondisi terkini, bukan riwayat pengerjaan.

---

## 1. Produk dan aturan kerja

NotifHub adalah layanan notifikasi multi-channel yang general-purpose (tidak terikat industri):
in-app, email, dan WhatsApp. Integrasi **SDK-first**; `POST /api/v1/notify` adalah entry point
utama, dan OpenAPI (`/api/docs-json`) adalah sumber kontrak SDK.

Aturan kerja:

1. Semua balasan ke pengguna memakai **Bahasa Indonesia**.
2. Setiap pekerjaan fitur dimulai dengan **draf desain** di `docs/` (Bahasa Indonesia), menunggu
   persetujuan pengguna, baru implementasi.
3. Setelah implementasi: verifikasi end-to-end (bukan hanya kompilasi), lalu laporkan hasil dengan
   bukti (status code, isi DB, test yang lulus), deviasi, dan batasan.
4. Kualitas: TypeScript strict, tanpa `any` yang tidak perlu, validasi input, error yang jelas,
   logging terstruktur, tidak ada secret di kode/log.
5. Jangan menambah dependency baru tanpa alasan kuat; jangan mengubah stack yang sudah ada.
6. Jangan mengubah module path Go (`github.com/hamdanidev/notifhub-go`).
7. Dokumentasi disusun per fitur dan merujuk path dokumen, bukan nomor urut pengerjaan.

---

## 2. Stack dan arsitektur

- Backend: **NestJS 11.2.10** (CommonJS), TypeScript 5.9, Prisma **6.19.3**, PostgreSQL 16,
  Redis 7, BullMQ (`notification-inapp`, `notification-email`, `notification-whatsapp`),
  nestjs-pino, Prometheus, Swagger. Prefix API `api/v1`.
- Auth dipisah tegas (tiga lane, tidak pernah dicampur):
  - ingest: header `X-API-Key` (tabel `ApiKey`, hash SHA-256),
  - admin: JWT `ADMIN_JWT_SECRET` (role `tenant_admin`; `platform_admin` ditolak),
  - subscriber/in-app: JWT `SUBSCRIBER_JWT_SECRET`, ditandatangani dengan secret API key tenant
    bila tenant punya (fallback ke env).
  - Tenant untuk ingest/admin berasal dari API key/token, bukan dari body. `tenant_id` di ingest
    hanya boleh sama.
- Channel:
  - in-app: SSE + Redis Stream replay + Pub/Sub, catch-up/read API.
  - email: SMTP; development log-only; staging catch-all.
  - WhatsApp: Meta Cloud API (teks), development log-only, staging catch-all, production nomor
    asli; webhook `GET/POST /api/v1/webhooks/whatsapp/events` dengan `X-Hub-Signature-256`.
- Webhook generik: `POST /api/v1/webhooks/:provider`, HMAC `<ts>.<raw body>`, `delivery_events`,
  update status monotonik, rollup `overallStatus` tiap menit.
- Topic: membership push, auto-create, `isTimeBound` + expiry; ingest mendukung `recipients` +
  `topics` (union, dedupe, `targetType`).
- Admin API tenant-scoped: auth, api-keys, templates, subscribers + preferences, topics,
  notifications + detail. Login throttled 5/menit.
- Preference center end-user: `GET/PUT /api/v1/subscriber/preferences` pada lane subscriber JWT,
  tenant-scoped, rate limit 60/menit per IP.
- Schema penting: `Notification`, `NotificationRecipient`, `DeliveryAttempt`, `DeliveryEvent`,
  `NotificationTemplate` (tenant-scoped), `Subscriber`, `NotificationPreference` (tenant-scoped),
  `ApiKey`, `AdminUser`, `Topic` + `TopicSubscriber`.

---

## 3. Kapabilitas saat ini

| Area | Status |
|---|---|
| Ingest + queue + schema + health + metrics + Swagger | selesai & terverifikasi |
| In-app + SSE + catch-up/read + `@notifhub/js` | selesai & terverifikasi |
| Email + abstraksi provider/circuit breaker + preferensi/quiet hours + Subscriber API | selesai & terverifikasi |
| Webhook signed → `delivery_events`, rollup status, retention/idempotency cleanup | selesai & terverifikasi |
| ApiKey table, admin auth, topics + membership, Admin API tenant-scoped | selesai & terverifikasi |
| `@notifhub/react` (headless) + `NotifHubAdminClient` + `notifhub-console` | selesai & terverifikasi |
| Sample in-app React 18 (sesi, SSE, read receipt, preference center) | selesai & terverifikasi lewat protokol/DB (dev-only, tanpa browser automation) |
| WhatsApp Cloud API provider/worker + webhook Meta + stub lokal | selesai & terverifikasi |
| Go SDK dari OpenAPI publik + wrapper + contoh + test | selesai & terverifikasi |
| Preference center end-user + API preferensi publik + secret subscriber per tenant | selesai & terverifikasi |
| Otomasi rilis: Jest e2e (E1–E10), image Docker backend/console, compose smoke stack, workflow CI | selesai & terverifikasi (CI berjalan di GitHub) |
| Distribusi SDK: `@notifhub/js` `0.3.0` + `@notifhub/react` `0.2.0` di npm, Go mirror `v0.10.0` | selesai & terverifikasi dari registry |

Versi saat ini: root `0.10.0`; npm `@notifhub/js` `0.3.0`, `@notifhub/react` `0.2.0`;
`notifhub-console` `0.1.0`; Go module `github.com/hamdanidev/notifhub-go` `v0.10.0` (Go 1.23).

---

## 4. Peta repository

- `src/` — backend NestJS. Modul penting:
  `ingest/`, `workers/`, `providers/`, `webhooks/`, `in-app/`, `admin/`, `auth/`, `topics/`,
  `routing/`, `preferences/`, `subscriber-preferences/`, `templates/`, `subscribers/`,
  `notifications/`, `cleanup/`, `queues/`, `metrics/`, `health/`, `config/`, `common/`.
  `src/bootstrap.ts` mengekspor `createApp()` yang dipakai `src/main.ts` dan test e2e.
- `prisma/schema.prisma`, `prisma/seed.ts`, `prisma/migrations/` (3 migrasi).
- `test/` — suite Jest e2e (`app.e2e-spec.ts`, `env.ts`, `setup/`, `jest-e2e.json`).
- `Dockerfile` (backend, target `runner`/`migrator`), `console/Dockerfile`, `console/nginx.conf`,
  `docker-compose.prod.yml`, `.env.prod.example`.
- `.github/workflows/ci.yml` — pipeline (backend/packages/go/docker).
- `packages/js-sdk/` — `@notifhub/js`: client in-app, SSE transport, `NotifHubAdminClient`,
  method preference center.
- `packages/react/` — `@notifhub/react`: provider, hook, bell, inbox, `usePreferences`.
- `console/` — aplikasi React 18 + Vite + Bootstrap 5 (desain minimal/netral; jangan kembali ke
  gradient/glow). Tenant admin only.
- `sample/in-app-web/` — sample end-user React 18 + Vite (CSS biasa, SDK npm terbit), middleware
  `/dev/*` hanya untuk lokal; lihat `docs/sample-in-app-design.md` dan README sample.
- `sdk/go/` — Go SDK: `client.gen.go` (generated, jangan diedit), `client.go`, `errors.go`,
  `types.go`, `examples/send`, test.
- `openapi/notifhub.json` — spec publik konsumen (3 path, 9 schema).
- `scripts/` — `export-openapi.mjs`, `dev-whatsapp-stub.mjs`, `dev-smtp-sink.mjs`,
  `dev-subscriber-token.mjs`, `verify-preferences.mjs`, `test-db-setup.mjs`, `ci.mjs`.
- `docs/` — `docs/usage/` berisi panduan pemakaian (konsep, consumer, end-user, admin/operasi);
  sisanya dokumen desain per fitur (lihat `README.md`), `docs/local-setup.md` berisi semua
  perintah verifikasi, `docs/project-brief.md` (dokumen ini).

---

## 5. Lingkungan dan perintah

- Working directory: `D:\Softlabs-workshop\NotifHub`
- Windows PowerShell; Node 24; npm; Go 1.23.4; Docker Desktop (mungkin perlu dihidupkan).
- Container Postgres/Redis biasanya hidup. Cek dengan
  `docker compose -f docker-compose.dev.yml ps`.
- Menyalakan:

```bash
npm run infra:up          # Postgres + Redis
npm run start:dev         # backend :3000
npm run console:dev       # console :5173 (bila perlu)
```

- Verifikasi:

```bash
npm run typecheck && npm run build
npm run test:e2e                # Jest e2e, database notifhub_test + Redis db 15
npm run ci                      # typecheck + build + e2e + migrate status (padanan CI)
npm run sdk:test
npm --prefix sample/in-app-web ci
npm run typecheck --prefix sample/in-app-web && npm run build --prefix sample/in-app-web
npm run console:typecheck && npm run console:build
npm run sdk:go:test
npm run verify:preferences      # HTTP + DB, backend harus hidup
npx prisma migrate status
```

- Login console dev: `admin@notifhub.local` / `NotifHubAdmin123!` (hash ada di `.env`).
- API key dev: `dev-api-key-change-in-prod` (bootstrap dari `SERVICE_API_KEY`).
- Token subscriber dev: `npm run dev:subscriber-token -- <recipientId> [tenant]` (ditandatangani
  dengan secret API key tenant; lihat `docs/preference-center.md` §6.1).
- Jika butuh data bersih: `npm run infra:reset` → `npx prisma migrate deploy` →
  `npx prisma db seed` (destruktif; konfirmasi dulu).
- File `.env` berisi secret dev; `.env.example` adalah referensi. WhatsApp env kosong di dev
  (mode log-only).

---

## 6. Batasan dan deviasi yang diketahui

- WhatsApp hanya mengirim teks (`type: "text"`), belum approved-template Meta; inbound reply tidak
  ditangani.
- `platform_admin` ditolak di Admin API (role tenant_admin saja); belum ada RBAC.
- Go SDK hanya mencakup endpoint consumer (notify, subscriber, topic membership); admin/in-app/
  webhook/preference center tidak masuk. Tidak ada publikasi registry untuk Go SDK.
- Console saat ini disajikan sebagai image nginx statis; belum ada browser automation permanen.
- Sample `sample/in-app-web` memakai middleware Vite dev-only untuk menerbitkan token dan memanggil
  ingest. Ia bukan pola produksi, tidak punya test runner sendiri, dan interaksi visualnya belum
  diotomasi; verifikasi memakai HTTP/SSE/DB serta `typecheck`/`build`.
- Login admin belum punya refresh token.
- Verifikasi token subscriber memakai satu query DB per request (tanpa cache).
- Rate limit per IP; di belakang reverse proxy tanpa `trust proxy` limit praktis menjadi global.
- `ApiKey.allowedOrigins` disimpan tetapi belum ditegakkan.
- Revocation token subscriber hanya per API key; tidak ada session/refresh token per user.
- Preferensi tidak punya FK ke `Subscriber`: GET tetap bekerja untuk recipient yang belum
  di-push (locale `null`).
- Migrasi preferensi mem-backfill baris lama ke tenant `default`; baris milik tenant lain tidak
  dapat dipetakan otomatis.
- Key `bootstrap` menyimpan snapshot `SUBSCRIBER_JWT_SECRET`; bila env berubah, startup mencatat
  `api_key.bootstrap.subscriber_secret_mismatch` dan token dengan env baru ditolak untuk tenant itu
  sampai key diselaraskan (helper dev membaca secret dari key, jadi tidak terpengaruh).
- Repo ini belum berupa git repository, sehingga `.github/workflows/ci.yml` belum pernah dieksekusi
  GitHub Actions; padanannya (`npm run ci`) diverifikasi lokal.
- Image Docker dibangun single-arch (amd64) dan belum dipush ke registry. `docker-compose.prod.yml`
  adalah smoke stack (tanpa TLS/secret manager), bukan deployment produksi.
- E2E tidak menguji SSE dan rate limit 429; keduanya tetap diverifikasi manual lewat
  `verify:preferences`.
- `npm audit --omit=dev` mencatat kerentanan transitive pada `prisma`/`@prisma/config`
  (`deepmerge-ts`) dan `@nestjs-modules/mailer` (`glob`/`minimatch`); perbaikan menunggu upgrade
  dependensi tersebut.

---

## 7. Kandidat pekerjaan berikutnya

1. Inisialisasi git + push ke GitHub agar CI aktif, lalu tambahkan registry push dan proteksi
   branch.
2. Self-service topic subscription oleh end-user (butuh kebijakan sumber kebenaran agar push
   membership dari consumer tidak menimpa pilihan user).
3. Platform admin lintas tenant + RBAC (`platform_admin`, manajemen tenant, audit log).
4. SDK bahasa lain (Python/PHP) dari OpenAPI publik, atau subset OpenAPI untuk endpoint subscriber.
5. Penegakan `allowedOrigins`/CORS per tenant, session/revocation token subscriber, dan upgrade
   dependensi untuk menutup temuan `npm audit`.
