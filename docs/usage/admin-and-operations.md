# Admin dan operasi

Panduan untuk tenant admin (console + Admin API) dan operator yang menjalankan NotifHub.

## 1. Login admin

```bash
curl -s -X POST http://localhost:3000/api/v1/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@notifhub.local","password":"<password>"}'
```

```json
{
  "accessToken": "<jwt>",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "admin": { "id": "...", "email": "admin@notifhub.local", "role": "tenant_admin", "tenantId": "default" }
}
```

- Login dibatasi **5 percobaan/menit per IP**.
- Token ditandatangani `ADMIN_JWT_SECRET`, berlaku sesuai `ADMIN_JWT_EXPIRES_IN` (default `1h`).
- Hanya role `tenant_admin` yang diizinkan; token `platform_admin` ditolak `403` oleh guard.
- Belum ada refresh token: setelah kedaluwarsa, login ulang.
- `GET /api/v1/admin/auth/me` mengembalikan profil admin yang sedang login.

Admin bootstrap dibuat otomatis saat startup dari `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH`.

## 2. API key

```bash
TOKEN=<admin JWT>

# Daftar key (raw key tidak pernah dikembalikan)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/admin/api-keys

# Buat key baru (raw key hanya muncul di response ini)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"order-service","subscriberJwtSecret":"<32+ karakter>"}' \
  http://localhost:3000/api/v1/admin/api-keys

# Revoke (idempoten)
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/admin/api-keys/<id>/revoke
```

| Field | Arti |
|---|---|
| `name` | Label key (maks 80) |
| `allowedOrigins` | Disimpan untuk kebutuhan CORS per key; **belum ditegakkan** |
| `subscriberJwtSecret` | Secret HS256 untuk memverifikasi token subscriber tenant ini (maks 128, min 32) |

Catatan:

- Hanya hash SHA-256 yang disimpan; kehilangan raw key = buat key baru.
- Revoke berlaku seketika untuk ingest maupun verifikasi token subscriber (secret key yang
  di-revoke tidak lagi dipakai).
- Key `bootstrap` dibuat dari `SERVICE_API_KEY` saat tabel masih kosong.

## 3. Template

Template bersifat **tenant-scoped** dan unik per `(key, channel, locale, version)`.

```bash
# Daftar
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:3000/api/v1/admin/templates?limit=20&offset=0'

# Buat
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "key": "order.shipped",
    "channel": "email",
    "locale": "id",
    "subject": "Pesanan {{order_id}} dikirim",
    "body": "<p>Halo {{nama}}, pesanan Anda sedang dikirim.</p>",
    "fallbackChannel": "inapp"
  }' \
  http://localhost:3000/api/v1/admin/templates

# Ubah (subject/body/active/fallback) atau nonaktifkan
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"active":false}' http://localhost:3000/api/v1/admin/templates/<id>
```

- `DELETE /api/v1/admin/templates/{id}` = **soft delete** (`active=false`), bukan hapus permanen.
- Placeholder memakai sintaks `{{nama}}`; data berasal dari `data` pada `POST /notify`.
- `fallbackChannel` dipakai bila channel utama di-skip karena preferensi penerima.
- Locale dipilih dari subscriber/inline recipient, fallback `DEFAULT_LOCALE` (default `id`).

## 4. Subscriber dan preferensi (sisi admin)

```bash
# Daftar & detail
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:3000/api/v1/admin/subscribers?limit=20&search=budi'
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/admin/subscribers/user-1

# Preferensi
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/admin/subscribers/user-1/preferences
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"enabled":false}' \
  http://localhost:3000/api/v1/admin/subscribers/user-1/preferences/email
```

- Admin melihat data tenant-nya saja; subscriber milik tenant lain → `404`.
- Aturan preferensi sama dengan end-user (quiet hours harus sepasang, `timezone` IANA), tetapi
  admin boleh menulis channel `sms` (end-user tidak).
- Preference admin adalah "atas nama" subscriber; end-user bisa mengubahnya lagi lewat
  preference center.

## 5. Topik (sisi admin)

```bash
curl -s -H "Authorization: Bearer $TOKEN" 'http://localhost:3000/api/v1/admin/topics?limit=20'
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/admin/topics/shift:gudang
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:3000/api/v1/admin/topics/shift:gudang/members?includeExpired=true'
```

Bentuk body sama dengan endpoint consumer (`members[]`, `expiresAt`, `isTimeBound`); lihat
[integration.md](integration.md#3-topik-dan-keanggotaan).

## 6. Notifikasi

```bash
# List dengan filter
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:3000/api/v1/admin/notifications?limit=20&status=partial&templateKey=order.shipped&from=2026-11-01T00:00:00Z'

# Detail
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/admin/notifications/<uuid>
```

Parameter list: `limit` (default 20, maks 100), `offset`, `status` (`pending|partial|sent|failed`),
`templateKey`, `from`, `to`. Setiap item memuat ringkasan hitungan:
`recipientCount`, `sentCount`, `failedCount`, `pendingCount`, `skippedCount`.

Detail mengembalikan `{ notification, recipients, deliveryAttempts, deliveryEvents }` — dipakai
console untuk menelusuri kenapa sebuah pengiriman gagal atau di-skip.

## 7. Console

```bash
npm run console:install
npm run console:dev        # http://localhost:5173
```

Halaman: Dashboard, Notifications (+detail), Templates (+form), Subscribers (+detail & editor
preferensi), Topics (+detail & membership), API Keys.

- Login memakai `ADMIN_EMAIL` / password yang hash-nya ada di `ADMIN_PASSWORD_HASH`.
- Admin JWT disimpan di `sessionStorage`; `401` menghapus sesi dan mengarahkan ke `/login`.
- `VITE_NOTIFHUB_API_URL` di `console/.env` mengatur URL backend (default `http://localhost:3000`).
- Di luar development, daftarkan origin console di `CORS_ORIGINS`.
- Dashboard menghitung agregat di sisi klien (tidak ada endpoint analytics).

## 8. Operasional

| Kebutuhan | Endpoint / mekanisme |
|---|---|
| Liveness | `GET /health/live` (tanpa auth) |
| Readiness | `GET /health/ready` (cek database + Redis) |
| Metrik Prometheus | `GET /metrics` + header `X-API-Key` |
| Rollup status | Berjalan tiap menit (`overallStatus`) |
| Retensi | Job harian 02:00 UTC; notifikasi lebih tua dari `RETENTION_DAYS` (default 90) di-soft-delete |
| Idempotency | Job harian 02:30 UTC; key kedaluwarsa dirotasi menjadi `expired:<uuid>` |
| Log | JSON terstruktur (pino) dengan `requestId`; header sensitif diredaksi |

Bootstrap saat startup: admin dari env, API key dari `SERVICE_API_KEY` bila tabel `ApiKey` kosong,
dan peringatan bila secret subscriber key `bootstrap` berbeda dari `SUBSCRIBER_JWT_SECRET`.

## 9. Deployment (Docker)

```bash
cp .env.prod.example .env.prod     # isi semua CHANGE_ME
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

| Service | Port | Catatan |
|---|---|---|
| `postgres` | internal | Volume persisten |
| `redis` | internal | Append-only |
| `migrate` | — | One-shot `prisma migrate deploy`; harus `Exited (0)` sebelum backend mulai |
| `backend` | `3000` | Image non-root, HEALTHCHECK `/health/live` |
| `console` | `8080` | nginx, SPA fallback |

Di `NOTIFHUB_MODE=production`, env ini wajib (validasi gagal saat startup bila kosong):
`SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SWAGGER_BASIC_AUTH_USER`, `SWAGGER_BASIC_AUTH_PASS`.

Build manual: `docker build --target runner .`, `docker build -f console/Dockerfile .`,
`docker build --target migrator .`. Stack ini untuk verifikasi, bukan deployment produksi
(tanpa TLS/secret manager). Detail ada di
[docs/production-readiness.md](../production-readiness.md) dan
[docs/local-setup.md](../local-setup.md).

## 10. Env penting

| Variabel | Default / catatan |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | Wajib |
| `SERVICE_API_KEY` | ≥16 karakter; bootstrap API key pertama |
| `DEFAULT_TENANT_ID` | `default` |
| `DEFAULT_LOCALE` | `id` |
| `SUBSCRIBER_JWT_SECRET` | ≥32 karakter; fallback untuk tenant tanpa secret |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` | Admin bootstrap (bcrypt, diawali `$2`) |
| `ADMIN_JWT_SECRET`, `ADMIN_JWT_EXPIRES_IN` | Signing admin + masa berlaku |
| `WEBHOOK_SIGNING_SECRET` | ≥32 karakter; HMAC webhook provider |
| `INGEST_MAX_PAYLOAD_BYTES` | `65536` |
| `INGEST_RATE_LIMIT_PER_KEY`, `INGEST_RATE_LIMIT_WINDOW_SECONDS` | `100` per `60` detik (per IP) |
| `IDEMPOTENCY_TTL_DAYS`, `RETENTION_DAYS` | `7`, `90` |
| `SSE_HEARTBEAT_INTERVAL_SECONDS`, `SSE_REPLAY_BUFFER_SECONDS` | `25`, `300` |
| `CORS_ORIGINS` | `*` di development; daftar origin di produksi |
| `NOTIFHUB_MODE` | `development` / `staging` / `production` |

## 11. Troubleshooting

| Gejala | Kemungkinan penyebab | Tindakan |
|---|---|---|
| `401` di ingest | API key salah/revoked | Cek `X-API-Key` di tabel API key |
| `401` di subscriber | Token kedaluwarsa atau secret tenant berbeda | Terbitkan ulang dengan `subscriberJwtSecret` tenant |
| `403` di Admin API | Token milik `platform_admin` | Gunakan akun `tenant_admin` |
| `400` "topics or recipients must not be empty" | Tidak ada penerima valid | Isi `recipients` atau `topics` |
| `400` "template not found" saat kirim | Template belum dibuat untuk channel/locale | Buat lewat Admin API/console |
| Recipient `skipped` + `preference_disabled` | Preferensi channel dimatikan | Cek preference center / admin |
| Notifikasi tetap `pending` | Worker tidak jalan / Redis bermasalah | Cek `/health/ready` dan log worker |
| `413` | Payload > 64 KB | Kecilkan body |
| `429` | Rate limit | Backoff + `Retry-After` |
| Token dev ditolak setelah ganti secret | Key `bootstrap` menyimpan secret lama | Selaraskan secret key atau pakai `npm run dev:subscriber-token` |
| Console gagal login | `ADMIN_PASSWORD_HASH` tidak cocok / CORS | Cek env dan `CORS_ORIGINS` |

## 12. Belum tersedia

- Platform admin lintas tenant dan RBAC.
- Self-service topic subscription oleh end-user.
- Publikasi npm untuk `@notifhub/js` / `@notifhub/react` dan rilis tag `notifhub-go`.
- Penjadwalan pengiriman (`scheduled_at` hanya disimpan).
- Approved template WhatsApp dan pesan inbound.
- Refresh token admin dan pencabutan token subscriber per user.
