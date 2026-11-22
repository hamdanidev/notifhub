# Project brief

Konteks ringkas untuk siapa pun (atau sesi AI) yang melanjutkan pekerjaan di NotifHub.
Dokumen ini menggambarkan kondisi terkini, bukan riwayat pengerjaan.

**Isi dokumen**

- [1. Produk dan aturan kerja](#1-produk-dan-aturan-kerja)
- [2. Stack dan arsitektur](#2-stack-dan-arsitektur)
- [3. Kapabilitas saat ini](#3-kapabilitas-saat-ini)
- [4. Peta repository](#4-peta-repository)
- [5. Lingkungan dan perintah](#5-lingkungan-dan-perintah)
- [6. Batasan dan deviasi yang diketahui](#6-batasan-dan-deviasi-yang-diketahui)
- [7. Kandidat pekerjaan berikutnya](#7-kandidat-pekerjaan-berikutnya)

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
  - platform (baru, auth saja): JWT `ADMIN_JWT_SECRET` dengan role `platform_admin`, tanpa klaim
    tenant, di `/api/v1/platform/*`. Tenant untuk ingest/admin berasal dari API key/token, bukan
    dari body. `tenant_id` di ingest hanya boleh sama.
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
  notifications + detail + resend failed. Login throttled 5/menit.
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
| Console refresh/auto-refresh + resend failed (notification baru, audit link) | selesai & terverifikasi (tanpa browser automation) |
| Template system v2 (draft/publish/rollback/clone, preview, test send, variabel, aset email, audit) + editor aset tanpa kode + block builder email (heading/teks/gambar/tombol/divider/spacer/dua kolom) | selesai & terverifikasi (E12–E20, UI manual tanpa browser automation) |
| Template P2: impor HTML ke Visual (subset kecil: heading, paragraf, gambar, tombol, divider) | selesai & terverifikasi (2026-11-22; 55 console test; E2E manual API + DB; lihat `docs/design/templates/html-import-design.md`) |
| Template P2: approval maker-checker (role `tenant_approver`, gate publish, antrean review) + diff versi | selesai & terverifikasi (2026-11-22; 85 unit, 56 e2e, 16 migrasi; lihat `docs/design/templates/template-approval-diff-design.md`) |
| Sample in-app React 18 (sesi, SSE, read receipt, preference center) | selesai & terverifikasi lewat protokol/DB (dev-only, tanpa browser automation) |
| WhatsApp Cloud API provider/worker + webhook Meta + stub lokal | selesai & terverifikasi |
| Provider WhatsApp WAHA (opsional, self-hosted): sendText + webhook HMAC-SHA512 + pemetaan ack | terimplementasi & terverifikasi otomatis (E46); smoke: kirim OK, `delivered`/`read` belum tertutup karena WAHA 2026.10.1 tidak memancarkan ack live (§15.4) |
| Go SDK dari OpenAPI publik + wrapper + contoh + test | selesai & terverifikasi |
| Preference center end-user + API preferensi publik + secret subscriber per tenant | selesai & terverifikasi |
| Otomasi rilis: Jest e2e (E1–E40), image Docker backend/console, compose smoke stack, workflow CI | selesai & terverifikasi (CI berjalan di GitHub) |
| Distribusi SDK: `@notifhub/js` `0.4.0` + `@notifhub/react` `0.3.0` di npm, Go mirror `v0.10.0` | selesai & terverifikasi dari registry |
| Multi-tenant F1–F5: entitas `Tenant` + FK, idempotency per tenant, lane platform, provisioning tenant/admin, suspend, audit, `allowedOrigins`, console platform | selesai & terverifikasi (e2e E30–E37, console build + verifikasi manual, docs:check) |
| Host split console platform: dua artifact (`dist/tenant`, `dist/platform`), dua image nginx, CI dua target, redirect `/platform/*` | selesai & terverifikasi (P1–P4 di smoke stack; rollout domain produksi = langkah operator) |
| Hardening console P1: ganti password + `tokenVersion`, secret API key, search notifikasi, CSP | selesai & terverifikasi (E38–E40; 40 e2e, 29 unit, CSP pada image) |
| Console P2a: export CSV + resend all non-SMS | selesai & terverifikasi (E41–E42; 42 e2e) |
| Console P2b: audit aksi admin tenant (tabel + API + halaman) | selesai & terverifikasi (E43; 43 e2e) |
| Console P2c: compose/send dari console (reuse ingest) | selesai & terverifikasi (E44; 44 e2e) |
| Console P3a: test Vitest/jsdom (18 test) di CI | selesai & terverifikasi |
| Console P3b + lanjutan: lima method P1/P2, client template v2, dan platform client masuk `@notifhub/js` source 0.3.1 | selesai & terverifikasi (36 SDK test; `0.3.1` terbit 2026-11-21) |
| Console P3c: retensi `AdminAuditEvent` (default 730 hari, cleanup 03:45 UTC) | selesai & terverifikasi (E45; 45 e2e, 30 unit; tanpa migrasi baru) |
| Markdown in-app (subset aman, `bodyHtml` aditif) + `@notifhub/js` 0.4.0 + `@notifhub/react` 0.3.0 | selesai & terverifikasi (E47; 47 e2e/73 unit; terbit di npm) |
| Console login tenant/platform: split panel + signal map beranimasi, form 360 px, mark Hub | selesai & terverifikasi (23 console test; screenshot 1440/390; isolasi bundle; favicon baru) |

Versi saat ini: root `0.11.0`; npm `@notifhub/js` `0.4.0`, `@notifhub/react` `0.3.0`;
`notifhub-console` `0.2.0`; Go module `github.com/hamdanidev/notifhub-go` `v0.10.0` (Go 1.23).

---

## 4. Peta repository

- `src/` — backend NestJS. Modul penting:
  `ingest/`, `workers/`, `providers/`, `webhooks/`, `in-app/`, `admin/`, `auth/`, `topics/`,
  `routing/`, `preferences/`, `subscriber-preferences/`, `templates/`, `subscribers/`,
  `notifications/`, `cleanup/`, `queues/`, `metrics/`, `health/`, `config/`, `common/`.
  `src/bootstrap.ts` mengekspor `createApp()` yang dipakai `src/main.ts` dan test e2e.
- `prisma/schema.prisma`, `prisma/seed.ts`, `prisma/migrations/` (16 migrasi).
- `test/` — suite Jest e2e (`app.e2e-spec.ts`, `env.ts`, `setup/`, `jest-e2e.json`).
- `Dockerfile` (backend, target `runner`/`migrator`), `console/Dockerfile` (target
  `runner-tenant`/`runner-platform`), `console/nginx/*.template`, `console/nginx/check-platform-url.sh`,
  `docker-compose.prod.yml`, `.env.prod.example`.
- `.github/workflows/ci.yml` — pipeline (backend/packages/go/docker).
- `packages/js-sdk/` — `@notifhub/js`: client in-app, SSE transport, `NotifHubAdminClient`,
  method preference center.
- `packages/react/` — `@notifhub/react`: provider, hook, bell, inbox, `usePreferences`.
- `console/` — aplikasi React 18 + Vite + Bootstrap 5 (desain minimal/netral; jangan kembali ke
  gradient/glow). Dua artifact: halaman tenant (`dist/tenant`) dan platform (`dist/platform`).
- `sample/in-app-web/` — sample end-user React 18 + Vite (CSS biasa, SDK npm terbit), middleware
  `/dev/*` hanya untuk lokal; lihat `docs/design/sample-in-app-design.md` dan README sample.
- `sdk/go/` — Go SDK: `client.gen.go` (generated, jangan diedit), `client.go`, `errors.go`,
  `types.go`, `examples/send`, test.
- `openapi/notifhub.json` — spec publik konsumen (3 path, 9 schema).
- `scripts/` — `export-openapi.mjs`, `dev-whatsapp-stub.mjs`, `dev-smtp-sink.mjs`,
  `dev-subscriber-token.mjs`, `verify-preferences.mjs`, `test-db-setup.mjs`, `ci.mjs`.
- `docs/` — dokumentasi bertema; mulai dari `docs/README.md` (peta dokumen + jalur baca).
  `docs/getting-started/` berisi setup, referensi konfigurasi, dan troubleshooting;
  `docs/architecture/` berisi gambaran sistem (dokumen ini salah satunya);
  `docs/design/` berisi dokumen desain per fitur dan indeksnya; `docs/usage/` panduan pemakaian;
  `docs/sdk/` desain dan rilis SDK; `docs/operations/` kesiapan rilis, CI, dan panduan deployment
  single tenant.

---

## 5. Lingkungan dan perintah

- Working directory: root repo (mesin pengembangan awal memakai
  `D:\Softlabs-workshop\NotifHub`).
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
npm run console:typecheck && npm run console:test && npm run console:build
npm run sdk:go:test
npm run verify:preferences      # HTTP + DB, backend harus hidup
npm run docs:check              # tautan dan anchor Markdown di docs/
npx prisma migrate status
```

- Login console dev: `admin@notifhub.local` / `NotifHubAdmin123!` (hash ada di `.env`).
- API key dev: `dev-api-key-change-in-prod` (bootstrap dari `SERVICE_API_KEY`).
- Token subscriber dev: `npm run dev:subscriber-token -- <recipientId> [tenant]` (ditandatangani
  dengan secret API key tenant; lihat `docs/design/preference-center.md` §6.1).
- Jika butuh data bersih: `npm run infra:reset` → `npx prisma migrate deploy` →
  `npx prisma db seed` (destruktif; konfirmasi dulu).
- File `.env` berisi secret dev; `.env.example` adalah referensi. WhatsApp env kosong di dev
  (mode log-only).

---

## 6. Batasan dan deviasi yang diketahui

- WhatsApp hanya mengirim teks (`type: "text"`), belum approved-template Meta; inbound reply tidak
  ditangani. Provider alternatif WAHA (self-hosted, tidak resmi, `WHATSAPP_PROVIDER=waha`) tersedia
  untuk deployment yang menerima risiko banned; default tetap Meta. Lihat
  `docs/design/whatsapp-waha-provider.md`. Smoke kirim berhasil, tetapi ack `delivered`/`read`
  belum berfungsi di WAHA `2026.10.1` (NOWEB/WEBJS tidak memancarkan ack live); jangan mengklaim
  status itu sampai ada deployment WAHA dengan receipt live yang terbukti (§15.4).
- `platform_admin` sudah punya lane sendiri (`/platform/auth/*`, provisioning tenant, suspend,
  audit) dan console platform (`/platform/*` di `console/`); tenant yang di-suspend ditolak
  `403 tenant_suspended` di tiga lane. Yang belum: RBAC granular dan pengelolaan akun platform
  admin dari API. Desain: `docs/design/multi-tenant-platform-admin.md`.
- Entitas `Tenant` + status + provisioning lewat lane platform sudah ada (F1–F3); tenant `default`
  tetap dibuat oleh bootstrap/seed. Desain: `docs/design/multi-tenant-platform-admin.md`.
- Idempotency notifikasi kini unik per tenant (`@@unique([tenantId, idempotencyKey])`, migrasi
  `20261119131500_platform_tenants`); lookup ingest/resend memakai tenant. E2E E30 menguji dua
  tenant dengan key yang sama.
- Go SDK hanya mencakup endpoint consumer (notify, subscriber, topic membership); admin/in-app/
  webhook/preference center tidak masuk. Tidak ada publikasi registry untuk Go SDK.
- Console saat ini disajikan sebagai image nginx statis; belum ada browser automation permanen.
  Host split console platform sudah diverifikasi pada smoke stack (`:8080` tenant, `:8081`
  platform); domain produksi (`platform.<domain>`), TLS, dan ingress belum dikonfigurasi dari repo
  (langkah operator). Lihat `docs/design/platform-console-host-split.md` §10 dan §18.4.
- Sample `sample/in-app-web` memakai middleware Vite dev-only untuk menerbitkan token dan memanggil
  ingest. Ia bukan pola produksi, tidak punya test runner sendiri, dan interaksi visualnya belum
  diotomasi; verifikasi memakai HTTP/SSE/DB serta `typecheck`/`build`.
- Console tenant sudah mendukung ganti password (invalidasi semua sesi lewat `tokenVersion`),
  secret subscriber per API key saat create, search notifikasi **exact** ID/recipient + page size
  20/50/100, CSP, export CSV, re-send `failed`/`all` non-SMS, audit aksi admin tenant, dan
  compose/send. Re-send memakai template aktif/data Subscriber saat ini; inline override dari
  ingest awal tidak tersimpan. Operasi template v2 dan lane platform kini memakai
  `NotifHubTemplatesClient`/`NotifHubPlatformClient` dari SDK; wrapper `HttpTransport` lokal sudah
  tidak ada. Lihat `docs/design/console-admin-hardening.md` §16,
  `docs/design/console-operations-p2.md` §13–§15, dan
  `docs/design/console-sdk-consolidation.md`.
- Template system v2: loop/conditional visual, MJML/juice, Meta approved
  WhatsApp template, dan diff pixel/gambar belum ada. **Approval maker-checker** tersedia untuk
  semua channel: role `tenant_approver` (dibuat lewat lane platform atau env single tenant), gate
  publish berbasis revisi (`approval_required`/`approval_stale`), antrean review, diff field/block/
  render, dan mode `self_approval_allowed` per tenant yang wajib alasan + audit; `PUT` published
  tidak lagi auto-publish. Lihat `docs/design/templates/template-approval-diff-design.md`.
  **Impor HTML ke
  Visual** tersedia sebagai subset kecil (heading/paragraf/gambar/tombol/divider) yang dipetakan di
  console memakai `DOMParser` tanpa dependency baru; CSS/layout/dua kolom/list tidak diimpor,
  Handlebars blok/partial ditolak, dan template published/read-only tidak dapat diimpor. Detail:
  `docs/design/templates/html-import-design.md`. Markdown in-app tersedia sebagai subset aman (dirender server-side ke `bodyHtml`; email,
  WhatsApp, dan SMS tetap menolak markdown) dan `@notifhub/react` menyediakan opt-in
  `renderBody="safe-html"`. Drag-and-drop/undo-redo block builder, ekspor HTML, usage
  count/proteksi hapus aset,
  pencatatan versi template per recipient, serta upload gambar tervalidasi sudah tersedia
  (P1/P2). Upload memakai storage lokal (`TEMPLATE_IMAGE_DIR`) dan URL publik UUID; belum ada
  EXIF stripping/optimasi/orphan cleanup. `builderData` divalidasi ketat oleh backend (schema v1,
  maksimum 200 block/64 KiB); plain-text email digenerate otomatis dengan fallback HTML-only;
  audit/test send memiliki retensi (180/730 hari, dapat dinonaktifkan). Aset hanya dapat dihapus
  jika tidak direferensikan. Preview/test send memakai UI manual (tanpa Playwright); sanitizer
  HTML/CSS berbasis pola, bukan parser penuh. Lihat `docs/design/templates/template-system-design.md` §18,
  `docs/design/templates/email-block-builder-design.md`, dan `docs/design/templates/template-limitations-roadmap.md`.
- Login admin belum punya refresh token.
- Verifikasi token subscriber memakai satu query DB per request (tanpa cache).
- Lane admin juga query DB per request (akun aktif + status tenant) agar suspend/deaktivasi berlaku
  segera; tidak ada cache di v1.
- Rate limit per IP; di belakang reverse proxy tanpa `trust proxy` limit praktis menjadi global.
- `ApiKey.allowedOrigins` ditegakkan di lane API key: bila daftar tidak kosong, `Origin` yang tidak
  cocok ditolak `403 origin_not_allowed`; daftar kosong berarti semua origin. Console dapat
  mengisinya saat membuat key, tetapi belum ada endpoint/UI untuk mengubahnya setelah dibuat.
- Revocation token subscriber hanya per API key; tidak ada session/refresh token per user.
- Preferensi tidak punya FK ke `Subscriber`: GET tetap bekerja untuk recipient yang belum
  di-push (locale `null`).
- Migrasi preferensi mem-backfill baris lama ke tenant `default`; baris milik tenant lain tidak
  dapat dipetakan otomatis.
- Key `bootstrap` menyimpan snapshot `SUBSCRIBER_JWT_SECRET`; bila env berubah, startup mencatat
  `api_key.bootstrap.subscriber_secret_mismatch` dan token dengan env baru ditolak untuk tenant itu
  sampai key diselaraskan (helper dev membaca secret dari key, jadi tidak terpengaruh).
- Repo sudah menjadi git repository dengan remote `origin`
  (`https://github.com/hamdanidev/notifhub.git`) dan `.github/workflows/ci.yml` sudah ada; padanan
  lokalnya adalah `npm run ci`. Status hijau CI di GitHub tidak diperiksa dari dokumen ini.
- Image Docker dibangun single-arch (amd64) dan belum dipush ke registry. `docker-compose.prod.yml`
  adalah smoke stack (tanpa TLS/secret manager), bukan deployment produksi.
- E2E tidak menguji SSE dan rate limit 429; keduanya tetap diverifikasi manual lewat
  `verify:preferences`.
- `npm audit --omit=dev` mencatat kerentanan transitive pada `prisma`/`@prisma/config`
  (`deepmerge-ts`) dan `@nestjs-modules/mailer` (`glob`/`minimatch`); perbaikan menunggu upgrade
  dependensi tersebut.

---

## 7. Kandidat pekerjaan berikutnya

1. Aktifkan registry push untuk image backend/console, tambahkan proteksi branch, dan pastikan CI
   GitHub Actions hijau di setiap PR.
2. Self-service topic subscription oleh end-user (butuh kebijakan sumber kebenaran agar push
   membership dari consumer tidak menimpa pilihan user).
3. SDK bahasa lain (Python/PHP) dari OpenAPI publik, atau subset OpenAPI untuk endpoint subscriber.
4. Rollout host platform ke domain produksi (`platform.<domain>`): DNS/TLS/ingress, nilai
   `PLATFORM_CONSOLE_URL`/`VITE_PLATFORM_CONSOLE_URL`/`CORS_ORIGINS`, lalu verifikasi bookmark lama,
   login, dan session. Implementasi P1–P4 sudah terverifikasi di smoke stack; langkah dan hasilnya
   di `docs/design/platform-console-host-split.md` §10/§18.4.
5. Session/revocation token subscriber, CORS per tenant bila dibutuhkan, RBAC granular
   (`platform_readonly`), dan upgrade dependensi untuk menutup temuan `npm audit`.
6. P3 console selesai: P3a (18 test Vitest/jsdom), P3b (lima method P1/P2 masuk `@notifhub/js`
   source 0.3.1; `0.3.1` terbit 2026-11-21), P3c (retensi `AdminAuditEvent` default 730 hari dengan
   job 03:45 UTC; `0` menonaktifkan), dan lanjutan P3b (template v2 + platform client dipindahkan
   ke SDK, 36 SDK test) — catatan dan bukti di `docs/design/console-quality-p3.md` §11–§13 dan
   `docs/design/console-sdk-consolidation.md`.
7. WAHA lanjutan (opsional): media/gambar, pesan masuk/reply, sesi per tenant, dan pengelolaan
   QR/session dari console. Saat ini WAHA hanya teks dan satu sesi per deployment
   (`docs/design/whatsapp-waha-provider.md` §10/§15).
8. Markdown in-app selesai (2026-11-21): subset aman dirender server-side ke `bodyHtml`,
   `@notifhub/js` 0.4.0 + `@notifhub/react` 0.3.0 terbit; lihat
   `docs/design/templates/in-app-markdown-design.md`.
9. Template P2 selesai: **approval maker-checker + diff versi** (2026-11-22) dan **impor HTML ke
   Visual** subset kecil (2026-11-22); lihat
   `docs/design/templates/template-approval-diff-design.md` dan
   `docs/design/templates/html-import-design.md`. Sisa P2: Meta approved WhatsApp dan parser
   sanitizer penuh/Playwright (menunggu keputusan dependency). Rujukan batasan di
   `docs/design/templates/template-limitations-roadmap.md` §14.4.
