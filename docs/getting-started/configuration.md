# Konfigurasi (environment variable)

Semua konfigurasi backend dibaca dari environment (`.env` saat lokal) dan divalidasi satu kali saat
startup oleh [zod](https://zod.dev) di `src/config/env.schema.ts`. Nilai yang hilang atau tidak
valid menggagalkan startup dengan daftar masalah yang jelas — tidak ada fallback diam-diam.

| File | Kegunaan |
|---|---|
| `.env.example` | Nilai development; `cp .env.example .env` untuk mulai |
| `.env.prod.example` | Variabel untuk `docker-compose.prod.yml`; salin ke `.env.prod` dan ganti semua `CHANGE_ME` |
| `src/config/env.schema.ts` | Sumber kebenaran tipe, default, dan aturan validasi |

Kolom **Default** di bawah adalah default di schema (bukan selalu nilai di `.env.example`). Tanda
`—` berarti variabel **wajib** diisi.

## Runtime dan koneksi

| Variabel | Default | Catatan |
|---|---|---|
| `SERVICE_NAME` | `notifhub` | Muncul di log dan objek health |
| `NOTIFHUB_MODE` | `development` | `development` \| `staging` \| `production`; menentukan perilaku pengiriman |
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `PORT` | `3000` | Port HTTP backend |
| `LOG_LEVEL` | `info` | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` (`.env.example` memakai `debug`) |
| `DATABASE_URL` | — | PostgreSQL; dipakai Prisma CLI dan aplikasi |
| `REDIS_URL` | — | Redis untuk BullMQ (tiga queue channel) dan event bus in-app (stream + pub/sub) |

## Autentikasi dan signing

| Variabel | Default | Catatan |
|---|---|---|
| `SERVICE_API_KEY` | — | Minimal 16 karakter. Menjadi bootstrap API key pertama saat tabel `ApiKey` kosong; key itu juga yang berlaku untuk `/metrics` (guard API key) di development |
| `ADMIN_EMAIL` | — | Email admin bootstrap; harus format email valid |
| `ADMIN_PASSWORD_HASH` | — | Hash bcrypt, wajib diawali `$2`; pertahankan kutip tunggal di `.env` |
| `ADMIN_JWT_SECRET` | — | Minimal 32 karakter |
| `ADMIN_JWT_EXPIRES_IN` | `1h` | Format `30m`, `1h`, `7d` (`^\d+[smhd]$`) |
| `PLATFORM_ADMIN_EMAIL` | — | Opsional; platform admin awal (lane `/platform/*`). Harus berpasangan dengan hash-nya dan **tidak boleh** sama dengan `ADMIN_EMAIL` |
| `PLATFORM_ADMIN_PASSWORD_HASH` | — | Opsional; bcrypt (`$2…`), berpasangan dengan `PLATFORM_ADMIN_EMAIL` |
| `SUBSCRIBER_JWT_SECRET` | — | Minimal 32 karakter; **fallback** untuk tenant yang belum punya secret API key sendiri |
| `WEBHOOK_SIGNING_SECRET` | — | Minimal 32 karakter; HMAC webhook provider generik |
| `CORS_ORIGINS` | `*` | `*` atau daftar origin dipisah koma; daftarkan origin console di luar development |
| `SWAGGER_BASIC_AUTH_USER` | — | Wajib di luar `development` (Swagger tidak boleh publik) |
| `SWAGGER_BASIC_AUTH_PASS` | — | Wajib di luar `development` |

## Ingest dan batas permintaan

| Variabel | Default | Catatan |
|---|---|---|
| `DEFAULT_TENANT_ID` | `default` | Tenant untuk baris lama/seed |
| `DEFAULT_LOCALE` | `id` | Locale template default |
| `IDEMPOTENCY_TTL_DAYS` | `7` | Umur `idempotency_key` sebelum dirotasi job cleanup |
| `INGEST_MAX_PAYLOAD_BYTES` | `65536` | Batas body ingest (64 KB) → `413` |
| `INGEST_RATE_LIMIT_PER_KEY` | `100` | Jumlah request per jendela, **per IP** (nama env menyebut "per key") |
| `INGEST_RATE_LIMIT_WINDOW_SECONDS` | `60` | Jendela rate limit ingest |
| `RECIPIENT_THROTTLE_WINDOW_SECONDS` | `60` | Didefinisikan di schema tetapi belum dipakai kode (reserved) |

Batas yang tidak dikonfigurasi (tetap): maksimum 1.000 recipient dan 50 topik per request.

## Pengiriman dan provider

| Variabel | Default | Catatan |
|---|---|---|
| `PROVIDER_RATE_LIMIT_EMAIL_PER_SEC` | `10` | Limiter queue email: maksimum job per 1000 ms |
| `PROVIDER_RATE_LIMIT_WHATSAPP_PER_SEC` | `5` | Limiter queue WhatsApp: maksimum job per 1000 ms |
| `FAIL_MODE_ON_REDIS_DOWN` | `closed` | `closed` = tolak ingest `503` saat Redis mati; `open` = buffer perintah |
| `CATCH_ALL_RECIPIENT` | — | **Wajib** saat `NOTIFHUB_MODE=staging`; semua kiriman dialihkan ke sini |
| `SMTP_HOST` | — | Wajib di luar `development` |
| `SMTP_PORT` | — | Wajib di luar `development` |
| `SMTP_FROM` | — | Wajib di luar `development` |
| `SMTP_USER` | — | Opsional |
| `SMTP_PASS` | — | Opsional |

Di `development` email tidak pernah dikirim: provider mencatat `email.log_only` dan menyimpan
`providerMessageId=dev-log-only`.

## WhatsApp (opsional)

| Variabel | Default | Catatan |
|---|---|---|
| `WHATSAPP_API_BASE_URL` | `https://graph.facebook.com` | Ganti ke stub lokal (`http://127.0.0.1:2526`) untuk uji end-to-end |
| `WHATSAPP_API_VERSION` | `v21.0` | Format `v<major>.<minor>` |
| `WHATSAPP_PHONE_NUMBER_ID` | — | Harus diisi bersama `WHATSAPP_ACCESS_TOKEN` |
| `WHATSAPP_ACCESS_TOKEN` | — | Harus diisi bersama `WHATSAPP_PHONE_NUMBER_ID` |
| `WHATSAPP_APP_SECRET` | — | Harus diisi bersama `WHATSAPP_VERIFY_TOKEN`; dipakai `X-Hub-Signature-256` |
| `WHATSAPP_VERIFY_TOKEN` | — | Harus diisi bersama `WHATSAPP_APP_SECRET` |
| `WHATSAPP_CATCH_ALL_RECIPIENT` | — | Nomor pengganti di staging |

## In-app dan SSE

| Variabel | Default | Catatan |
|---|---|---|
| `SSE_HEARTBEAT_INTERVAL_SECONDS` | `25` | Interval heartbeat koneksi SSE |
| `SSE_REPLAY_BUFFER_SECONDS` | `300` | Lama event disimpan di Redis Stream untuk replay `Last-Event-ID` |

## Template dan retensi

| Variabel | Default | Catatan |
|---|---|---|
| `RETENTION_DAYS` | `90` | Umur notifikasi sebelum soft delete oleh job retention (UTC 02:00) |
| `TEMPLATE_TEST_SEND_RETENTION_DAYS` | `180` | Retensi `TemplateTestSend`; `0` menonaktifkan |
| `TEMPLATE_AUDIT_RETENTION_DAYS` | `730` | Retensi `TemplateAuditEvent`; `0` menonaktifkan |
| `TEMPLATE_MAX_PAYLOAD_BYTES` | `1048576` | Batas payload Admin API template/aset (1 MB) |
| `TEMPLATE_IMAGE_DIR` | `var/template-images` | Direktori gambar template (di-ignore git) |
| `TEMPLATE_IMAGE_MAX_BYTES` | `5242880` | Batas ukuran gambar (5 MB) |
| `TEMPLATE_IMAGE_BASE_URL` | — | URL publik untuk gambar absolut; isi bila di belakang reverse proxy |

## Khusus docker compose dan frontend

Variabel ini tidak dibaca oleh schema backend:

| Variabel | Dipakai oleh | Catatan |
|---|---|---|
| `CONSOLE_API_URL` | Build image console | URL API yang dipanggil browser |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Service `postgres` di compose | Hindari `@ : / #` pada password agar URL valid |
| `VITE_NOTIFHUB_API_URL` | `console/.env` | Default `http://localhost:3000` |

## Syarat per mode

Selain validasi per variabel, ada aturan lintas variabel:

| Mode | Syarat tambahan |
|---|---|
| `development` | Tidak ada syarat tambahan; email/WhatsApp log-only |
| `staging` | `CATCH_ALL_RECIPIENT` wajib; `SWAGGER_BASIC_AUTH_*` dan `SMTP_*` wajib (aturan mode non-development) |
| `production` | Sama seperti staging tanpa `CATCH_ALL_RECIPIENT`; semua secret minimal 32 karakter |

Aturan lain: `WHATSAPP_PHONE_NUMBER_ID` ↔ `WHATSAPP_ACCESS_TOKEN` harus diisi bersama, dan
`WHATSAPP_APP_SECRET` ↔ `WHATSAPP_VERIFY_TOKEN` juga.

## Cara mengubah konfigurasi

1. Tambah/ubah variabel di `src/config/env.schema.ts` (tipe + default + validasi).
2. Perbarui `.env.example` (dan `.env.prod.example` bila relevan dengan compose).
3. Perbarui tabel di halaman ini.
4. Restart backend; bila ada yang salah, startup gagal dengan pesan seperti:

   ```
   Invalid environment configuration:
     - SUBSCRIBER_JWT_SECRET: Too small: expected string to have >=32 characters
   ```

## Catatan keamanan

- Jangan commit `.env`/`.env.prod`; keduanya berisi secret. Yang di-commit hanya file `.example`.
- `ADMIN_PASSWORD_HASH` harus bcrypt (`$2a$`/`$2b$`); buat dengan `npm run admin:hash-password "..."`.
- Di luar `development`, Swagger dilindungi basic auth — tanpa `SWAGGER_BASIC_AUTH_*` startup gagal
  (sengaja, agar dokumentasi API tidak terbuka).
- `SUBSCRIBER_JWT_SECRET` hanya fallback; secret efektif per tenant berasal dari API key tenant
  (lihat [preference-center §6](../design/preference-center.md#6-verifikasi-jwt-subscriber-per-tenant)).

Verifikasi cepat setelah mengubah konfigurasi: [local setup: Verify](local-setup.md#verify).
