# Desain preference center end-user

Status: **terimplementasi dan terverifikasi**.
Basis: keputusan produk NotifHub (SDK-first, isolasi tenant, tiga lane auth). Dokumen pendamping:
`docs/design/email-and-preferences.md`, `docs/design/admin-api.md`, `docs/design/in-app.md`, `docs/getting-started/local-setup.md`.

**Isi dokumen**

- [1. Latar belakang: dua celah yang harus ditutup lebih dulu](#1-latar-belakang-dua-celah-yang-harus-ditutup-lebih-dulu)
- [2. Ruang lingkup](#2-ruang-lingkup)
- [3. Arsitektur dan alur](#3-arsitektur-dan-alur)
- [4. Schema dan migrasi](#4-schema-dan-migrasi)
- [5. Endpoint](#5-endpoint)
- [6. Verifikasi JWT subscriber per tenant](#6-verifikasi-jwt-subscriber-per-tenant)
- [7. Keputusan bernomor](#7-keputusan-bernomor)
- [8. File](#8-file)
- [9. Batasan dan di luar scope](#9-batasan-dan-di-luar-scope)
- [10. Catatan implementasi](#10-catatan-implementasi)

---

## 1. Latar belakang: dua celah yang harus ditutup lebih dulu

Sejak awal, preferensi notifikasi (`NotificationPreference`) dan penegakannya (skip/quiet hours)
hanya bisa dibaca/diubah oleh tenant admin (`/api/v1/admin/subscribers/:externalId/preferences`)
atau lewat seed. End-user tidak punya jalan self-service. Membukanya ke end-user memunculkan dua
masalah yang selama ini tidak terlihat:

1. **`NotificationPreference` tidak tenant-scoped.** Model ini unik pada
   `@@unique([recipientId, channel])`, tanpa `tenantId`. Padahal `recipientId` adalah `externalId`
   milik consumer yang **hanya unik per tenant**. Dua tenant dengan `externalId` sama (`user-1`)
   saat ini **berbagi satu baris preferensi**: tenant A mematikan email untuk `user-1`, dan email
   `user-1` di tenant B ikut mati. Admin API menyamarkan ini karena ia lebih dulu mencari
   `Subscriber` dengan `(tenantId, externalId)`, tetapi query preferensinya tetap tanpa tenant.
2. **Secret JWT subscriber bersifat global.** `ApiKey.subscriberJwtSecret` sudah ada di schema dan
   diisi oleh bootstrap key, tetapi `SubscriberTokenService` **selalu** memakai
   `SUBSCRIBER_JWT_SECRET` dari env; kolom itu tidak pernah dibaca saat verifikasi. Artinya setiap
   consumer memegang secret yang sama dan dapat menandatangani token dengan klaim `tenant` mana pun.

Keduanya adalah cacat isolasi tenant. Selama API preferensi hanya dipakai admin (di belakang token
tenant sendiri) dampaknya terbatas; begitu API dibuka ke end-user (token yang dibuat consumer dan
dipakai di browser), keduanya menjadi kebocoran lintas tenant. Karena itu keduanya diperbaiki
sebagai bagian dari scope.

---

## 2. Ruang lingkup

### 2.1 Termasuk

1. **Migrasi tenant scoping preferensi**: `NotificationPreference.tenantId`, unique
   `(tenantId, recipientId, channel)`, backfill baris lama ke tenant `default`.
2. **End-user API (lane subscriber JWT)**:
   - `GET /api/v1/subscriber/preferences` — snapshot preferensi 3 channel + konteks profil.
   - `PUT /api/v1/subscriber/preferences/:channel` — full snapshot satu channel.
3. **Penegakan preferensi yang benar per tenant** di worker in-app, email, dan WhatsApp (worker
   mengirim `tenantId` ke `PreferencesService`).
4. **Verifikasi JWT subscriber per tenant**: secret diambil dari `ApiKey.subscriberJwtSecret` milik
   tenant pada klaim token; `SUBSCRIBER_JWT_SECRET` hanya fallback untuk tenant yang belum punya
   secret sendiri. Tidak ada downgrade (lihat D4).
5. **SDK**: metode preferensi di `@notifhub/js` dan hook headless `usePreferences` di
   `@notifhub/react`.
6. **Rate limit** lokal untuk endpoint publik (ThrottlerModule di modul baru).
7. **Logging terstruktur** untuk baca/ubah preferensi oleh end-user (tanpa PII).
8. **Skrip verifikasi** `scripts/verify-preferences.mjs` (HTTP + DB) yang dapat dijalankan ulang.
9. **Helper token dev** `scripts/dev-subscriber-token.mjs`, karena token kini ditandatangani dengan
   secret tenant (bukan selalu env).

### 2.2 Tidak termasuk

UI preference center di console, self-service topic subscription, perubahan email/phone oleh
end-user, OpenAPI subset publik subscriber, komponen React UI, audit table, CI. Rinciannya di §9.

---

## 3. Arsitektur dan alur

### 3.1 Lane auth (tetap tiga, tidak dicampur)

| Lane | Kredensial | Pemakaian |
|---|---|---|
| ingest | `X-API-Key` (`ApiKey` + SHA-256) | consumer push subscriber (tidak berubah) |
| admin | JWT `ADMIN_JWT_SECRET` (`tenant_admin`) | console melihat preferensi (ikut tenant-scoped) |
| subscriber | JWT HS256, klaim `sub, tenant, exp` | **end-user preference center (baru)** |

Endpoint baru **hanya** memakai `SubscriberJwtGuard`. Tenant dan recipient **selalu** berasal dari
token terverifikasi (`request.subscriber`), tidak pernah dari body, path, atau query. Tidak ada
endpoint preference center yang menerima `X-API-Key` maupun admin JWT.

### 3.2 Alur baca

```
Browser end-user
  Authorization: Bearer <subscriber JWT>
        │
        ▼
SubscriberJwtGuard ──► SubscriberTokenService.verify()
        │                1. decode klaim `tenant` (belum diverifikasi)
        │                2. ambil secret kandidat tenant dari ApiKey
        │                3. verifikasi HS256 + cek sub/tenant/exp
        ▼
SubscriberPreferencesService.get(principal)
        │  NotificationPreference where { tenantId, recipientId }  (3 channel)
        │  Subscriber where { tenantId, externalId }               (locale, timezone; opsional)
        ▼
200 { recipientId, locale, timezone, channels[3] }
```

### 3.3 Alur tulis dan penegakan

```
PUT /api/v1/subscriber/preferences/:channel
        │  validasi DTO (enabled wajib; quiet hours sepasang; timezone IANA; channel didukung)
        ▼
upsert NotificationPreference (tenantId, recipientId, channel)
        │  log event subscriber.preference.updated
        ▼
200 { channel, enabled, quietHoursStart, quietHoursEnd, timezone, isDefault:false, updatedAt }

... kemudian, saat consumer mengirim notifikasi ...

POST /notify (X-API-Key) → NotificationRecipient pending → queue
        ▼
worker (in-app/email/whatsapp)
        │  DeliveryContextService.load() → context.tenantId
        ├─► PreferencesService.evaluate({ tenantId, recipientId, channel, priority, ... })
        │       NotificationPreference findUnique(tenantId + recipientId + channel)
        │       enabled=false        → skip (fallback channel bila template punya)
        │       quiet hours (prio>1) → defer (maks 3 kali)
        ▼
provider / SSE
```

Perubahan yang menentukan: `PreferencesService.evaluate` **wajib** menerima `tenantId`. Worker sudah
memuat `context.tenantId` satu baris sebelum memanggil preferensi, jadi tidak ada query tambahan.

---

## 4. Schema dan migrasi

`prisma/schema.prisma`:

```prisma
model NotificationPreference {
  id              String   @id @default(uuid())
  tenantId        String   @default("default")
  recipientId     String
  channel         Channel
  enabled         Boolean  @default(true)
  quietHoursStart String?
  quietHoursEnd   String?
  timezone        String   @default("Asia/Jakarta")
  createdAt       DateTime @default(now()) @db.Timestamptz
  updatedAt       DateTime @updatedAt @db.Timestamptz

  @@unique([tenantId, recipientId, channel])
}
```

Migrasi `prisma/migrations/20261116120000_phase9_preference_tenant/migration.sql`:

```sql
ALTER TABLE "NotificationPreference" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';

DROP INDEX "NotificationPreference_recipientId_channel_key";

CREATE UNIQUE INDEX "NotificationPreference_tenantId_recipientId_channel_key"
  ON "NotificationPreference"("tenantId", "recipientId", "channel");
```

Backfill: hanya `default`. Baris lama milik tenant lain **tidak dapat** dipetakan otomatis (tidak
ada kolom tenant di baris lama); ini deviasi yang dicatat.

---

## 5. Endpoint

Base: `/api/v1`. Auth: `Authorization: Bearer <subscriber JWT>`, Swagger security `subscriber-jwt`.
Tag Swagger: `subscriber-preferences`.

### 5.1 `GET /subscriber/preferences`

Mengembalikan **selalu 3 channel** (inapp, email, whatsapp). Channel tanpa baris preferensi
disintesis menjadi default (`enabled=true`, quiet hours kosong, `timezone` = timezone subscriber
atau `Asia/Jakarta`, `isDefault=true`), sehingga SDK tidak perlu meniru aturan "baris tidak ada =
aktif".

```json
{
  "recipientId": "user-test-1",
  "locale": "id",
  "timezone": "Asia/Jakarta",
  "channels": [
    {
      "channel": "inapp",
      "enabled": true,
      "quietHoursStart": "22:00",
      "quietHoursEnd": "07:00",
      "timezone": "Asia/Jakarta",
      "isDefault": false,
      "updatedAt": "2026-11-16T04:10:00.000Z"
    },
    {
      "channel": "email",
      "enabled": true,
      "quietHoursStart": null,
      "quietHoursEnd": null,
      "timezone": "Asia/Jakarta",
      "isDefault": true,
      "updatedAt": null
    },
    {
      "channel": "whatsapp",
      "enabled": true,
      "quietHoursStart": null,
      "quietHoursEnd": null,
      "timezone": "Asia/Jakarta",
      "isDefault": true,
      "updatedAt": null
    }
  ]
}
```

- `locale` dan `timezone` berasal dari `Subscriber` tenant tersebut; bila subscriber belum pernah
  di-push, `locale` = `null` dan `timezone` = `Asia/Jakarta`.
- Urutan channel tetap (inapp, email, whatsapp) agar UI stabil.

### 5.2 `PUT /subscriber/preferences/:channel`

`channel` ∈ `inapp | email | whatsapp` (400 untuk nilai lain, termasuk `sms`). Body:

```json
{
  "enabled": false,
  "quietHoursStart": "22:00",
  "quietHoursEnd": "07:00",
  "timezone": "Asia/Jakarta"
}
```

Aturan validasi (sama dengan admin, ditambah dua perbaikan):

- `enabled` wajib, boolean.
- `quietHoursStart`/`quietHoursEnd` `HH:mm` 24 jam; harus **diberikan bersama**, atau tidak sama
  sekali. Bila `start === end`, dianggap quiet hours mati (perilaku `parseQuietHours` yang ada) —
  nilai tetap disimpan apa adanya, penegakan yang mengabaikannya.
- `timezone` opsional, IANA. **Bila dihilangkan, mewarisi `Subscriber.timezone`** (fallback
  `Asia/Jakarta`), bukan hardcode `Asia/Jakarta` seperti admin (D5).
- Semantik **full snapshot** untuk channel tersebut: field yang tidak dikirim dikosongkan
  (quiet hours), sama seperti PUT admin, agar PUT tetap idempoten.

Response 200: satu objek channel (bentuk sama dengan elemen `channels` pada GET, `isDefault=false`).

### 5.3 Error

Mengikuti filter global (`{ statusCode, message, error, timestamp, path, requestId }`).

| Status | Kondisi |
|---|---|
| 401 | Token tidak ada, bukan `Bearer`, signature salah, `sub`/`tenant`/`exp` tidak ada, atau `tenant` tidak cocok dengan hasil verifikasi |
| 400 | `:channel` tidak dikenal/tidak didukung; quiet hours hanya salah satu; format `HH:mm` salah; timezone bukan IANA; `enabled` tidak dikirim |
| 429 | Melebihi 60 request/menit per IP |

Tidak ada 403/404: preferensi tidak memerlukan baris `Subscriber` (D6), dan end-user tidak bisa
menunjuk recipient lain.

### 5.4 Logging

Tidak ada secret/token di log. Event pino (konvensi yang sudah ada):

- `subscriber.preferences.read` — `tenant_id`, `recipient_id`, `channel_count`.
- `subscriber.preference.updated` — `tenant_id`, `recipient_id`, `channel`, `enabled`,
  `quiet_hours_start`, `quiet_hours_end`, `timezone`.
- `auth.subscriber_token.resolved` (level debug) — `tenant_id`, `secret_source`
  (`tenant_key` | `env_fallback`) tanpa nilai secret.

`PinoLogger` sudah meredaksi header `authorization`.

---

## 6. Verifikasi JWT subscriber per tenant

`SubscriberTokenService.verify(token)`:

1. `jwt.decode(token)` **tanpa verifikasi**, ambil klaim `tenant` (string non-kosong). Bila tidak
   ada → 401 (tanpa query DB).
2. Ambil kandidat secret: `ApiKey.findMany({ where: { tenantId, active: true,
   subscriberJwtSecret: { not: null } } })`, dedupe.
3. Bila **tidak ada** kandidat → pakai `SUBSCRIBER_JWT_SECRET` (env) sebagai fallback, sumber
   dicatat `env_fallback`.
4. Verifikasi `jwt.verify(token, secret, { algorithms: ['HS256'], clockTolerance: 5 })` untuk setiap
   kandidat sampai satu berhasil; bila semuanya gagal → 401 + `auth.subscriber_token.invalid`.
5. Setelah signature valid, cek `sub`, `tenant`, `exp` dan **pastikan `payload.tenant` sama dengan
   tenant yang dipakai untuk memilih secret**.

Konsekuensi keamanan yang disengaja:

- Tenant yang **punya** secret sendiri tidak pernah menerima token yang ditandatangani dengan
  `SUBSCRIBER_JWT_SECRET` (tidak ada downgrade ke secret global).
- Tenant tanpa secret tetap kompatibel dengan deployment lama.
- Revocation berlaku seketika: key yang di-revoke (`active=false`) tidak lagi menjadi kandidat,
  karena tidak ada cache (D4).
- Biaya: satu query terindeks (`ApiKey` punya `@@index([tenantId])`) per request bertoken. Dicatat
  sebagai batasan; cache dengan TTL adalah optimasi lanjutan.

### 6.1 Konsekuensi operasional (penting)

Karena secret tenant kini otoritatif, key `bootstrap` yang menyimpan **snapshot** lama
`SUBSCRIBER_JWT_SECRET` akan menolak token yang ditandatangani dengan env terbaru. Perilaku ini
tidak diubah otomatis. Sebagai gantinya, saat startup `ApiKeyService` mencatat peringatan
`api_key.bootstrap.subscriber_secret_mismatch` bila nilai tersimpan berbeda dari env, sehingga
operator bisa menyelaraskan key atau menandatangani dengan secret key tersebut.

Helper `scripts/dev-subscriber-token.mjs` membaca secret dari API key aktif tenant, sehingga
token dev selalu valid tanpa perlu mengingat snapshot di DB.

---

## 7. Keputusan bernomor

| # | Keputusan | Status |
|---|---|---|
| D1 | Preference center end-user lewat lane subscriber; tanpa halaman console baru | diterapkan |
| D2 | Preferensi tenant-scoped: `tenantId` + unique `(tenantId, recipientId, channel)`; backfill ke `default` | diterapkan |
| D3 | Endpoint publik hanya `SubscriberJwtGuard`; `tenantId`/`recipientId` hanya dari token | diterapkan |
| D4 | Secret JWT subscriber per tenant dari `ApiKey.subscriberJwtSecret`; env hanya fallback; tanpa cache | diterapkan |
| D5 | `PUT` tanpa `timezone` mewarisi `Subscriber.timezone` (fallback `Asia/Jakarta`) | diterapkan |
| D6 | `GET` selalu mengembalikan 3 channel dengan default sintetis; preferensi tidak mewajibkan baris `Subscriber` | diterapkan |
| D7 | Hanya 2 endpoint (list + per-channel PUT); tanpa bulk PUT dan DELETE | diterapkan |
| D8 | SDK: `getPreferences()`/`updatePreference()` di `@notifhub/js` + hook `usePreferences()` di `@notifhub/react`; tanpa komponen UI | diterapkan |
| D9 | `openapi/notifhub.json` (spec konsumen) tidak berubah; endpoint subscriber hanya di Swagger | diterapkan (hash spec identik) |
| D10 | Rate limit lokal: 60 request/menit per IP | diterapkan |
| D11 | Console tidak diubah | diterapkan |
| D12 | Versi: root `0.9.0`, `@notifhub/js` `0.3.0`, `@notifhub/react` `0.2.0`; tanpa dependency baru | diterapkan |

---

## 8. File

### 8.1 Baru

| File | Isi |
|---|---|
| `prisma/migrations/20261116120000_phase9_preference_tenant/migration.sql` | tenantId + unique baru |
| `src/subscriber-preferences/subscriber-preferences.module.ts` | `AuthModule` + `ThrottlerModule`, controller, service |
| `src/subscriber-preferences/subscriber-preferences.controller.ts` | dua endpoint, guard throttle + subscriber |
| `src/subscriber-preferences/subscriber-preferences.service.ts` | baca dengan default sintetis, upsert tenant-scoped, log |
| `src/subscriber-preferences/dto/subscriber-preference.dto.ts` | DTO request/response + contoh Swagger |
| `src/auth/subscriber/subscriber-secret-resolver.ts` | resolusi secret per tenant |
| `packages/js-sdk/test/preferences.test.ts` | 5 unit test method preferensi |
| `packages/react/test/preferences.test.tsx` | 1 smoke test SSR hook |
| `scripts/verify-preferences.mjs` | verifikasi HTTP + DB, 33 check |
| `scripts/dev-subscriber-token.mjs` | helper token dev |
| `docs/design/preference-center.md` | dokumen ini |

### 8.2 Diubah

| File | Perubahan |
|---|---|
| `prisma/schema.prisma` | `NotificationPreference` + `tenantId`, unique |
| `prisma/seed.ts` | key upsert preferensi ikut `tenantId` |
| `src/preferences/preferences.service.ts` | `evaluate({ tenantId, ... })`, filter tenant |
| `src/workers/delivery-worker.support.ts` | meneruskan `tenantId` |
| `src/workers/in-app.processor.ts`, `email.processor.ts`, `whatsapp.processor.ts` | kirim `context.tenantId` |
| `src/admin/services/admin-subscribers.service.ts` | query/upsert preferensi tenant-scoped |
| `src/auth/subscriber/subscriber-token.service.ts` | verifikasi memakai resolver per tenant |
| `src/auth/subscriber/subscriber-jwt.guard.ts` | `canActivate` menjadi async |
| `src/auth/subscriber/` + `src/auth/auth.module.ts` | registrasi resolver |
| `src/auth/api-key/api-key.service.ts` | peringatan drift secret bootstrap |
| `src/app.module.ts` | registrasi modul baru |
| `src/main.ts` | deskripsi security scheme `subscriber-jwt` |
| `packages/js-sdk/src/{client,types,index}.ts` | `getPreferences`, `updatePreference`, tipe |
| `packages/react/src/{preferences,index}.ts` | hook `usePreferences` |
| `packages/*/package.json`, `package.json` | versi + script `verify:preferences`, `dev:subscriber-token` |
| `docs/getting-started/local-setup.md`, `README.md` | verifikasi & ringkasan fitur |

Tidak ada file console, Go SDK, atau `openapi/notifhub.json` yang diubah (D9, D11).

---

## 9. Batasan dan di luar scope

1. **UI preference center** di console atau komponen React siap pakai. Console tetap alat tenant
   admin; end-user UI milik aplikasi consumer, dan SDK menyediakan data + aksi.
2. **Self-service topic subscription** (opt-in/opt-out topik oleh end-user). Membership topik
   sekarang push dari consumer (`PUT/POST /topics/:key/members`); membukanya ke end-user butuh
   kebijakan sumber kebenaran (mis. kolom `source` + prioritas) agar push berikutnya tidak menimpa
   pilihan user.
3. **End-user mengubah email/phone.** Data itu milik consumer (push-synced).
4. **Rotasi/session management token subscriber**: belum ada refresh token, daftar session, atau
   revoke per user (hanya per API key).
5. **Enforcement `ApiKey.allowedOrigins`** dan CORS per tenant (kolom ada, belum dipakai).
6. **OpenAPI subset publik untuk endpoint subscriber** dan SDK bahasa lain (Python/PHP).
7. **Audit table** perubahan preferensi (hanya structured log).
8. **Double opt-in / notifikasi konfirmasi** saat preferensi berubah.
9. CI/publikasi registry.

Batasan teknis:

- **Backfill `default`** tidak dapat memetakan baris lama milik tenant non-default.
- **Satu query DB tambahan per request bertoken** untuk resolusi secret (D4), tanpa cache.
- **Rate limit per IP**, bukan per subscriber. Di belakang reverse proxy tanpa `trust proxy`
  semua request terlihat satu IP; belum diubah di sini.
- **Preferensi tanpa FK ke `Subscriber`**, jadi `GET` tetap bekerja untuk recipient yang belum
  pernah di-push (locale `null`).
- **Snapshot timezone**: `PUT` menyimpan timezone hasil warisan ke baris preferensi. Perubahan
  `Subscriber.timezone` setelahnya tidak mengubah baris yang sudah ada.
- **`enabled=false` untuk `inapp`** membuat notifikasi in-app tidak dikirim (perilaku worker yang
  sudah ada); UI sebaiknya menjelaskannya.

---

## 10. Catatan implementasi

1. **Index tambahan tidak dibuat.** Desain awal menyebut `@@index([tenantId, recipientId])`, tetapi
   unique `(tenantId, recipientId, channel)` sudah melayani prefix tersebut; index terpisah akan
   redundan. Deviasi kecil, tanpa dampak perilaku.
2. **`sms` ditolak di service.** `Channel` punya nilai `sms`, tetapi tidak ada provider/worker.
   `GET` hanya mengembalikan tiga channel, dan `PUT .../sms` mengembalikan `400` agar data yang
   tidak bisa dikirim tidak bisa diaktifkan.
3. **Guard async.** Resolusi secret memerlukan query DB, sehingga `SubscriberJwtGuard.canActivate`
   menjadi `Promise<boolean>`; seluruh pemanggil lain tidak berubah.
4. **Peringatan drift secret bootstrap** ditambahkan setelah verifikasi pertama menemukan DB dev
   menyimpan secret bootstrap lama (35 karakter) berbeda dari `.env` (43 karakter). Tanpa
   peringatan, operator hanya melihat `401` tanpa petunjuk. Nilai DB dev diselaraskan manual
   sebagai bagian dari perbaikan lingkungan.
5. **Verifikasi end-to-end**: `npm run verify:preferences` menjalankan 33 check (HTTP + DB) dan
   lulus semua: snapshot default, baca/tulis, penegakan worker (`skipped`/`preference_disabled`),
   lima kasus validasi `400`, tiga kasus `401`, isolasi tenant dengan `recipientId` sama, tidak ada
   downgrade ke secret global, regresi admin & in-app, dan `429` pada rate limit.
6. **Test**: `@notifhub/js` 23 test (5 baru), `@notifhub/react` 4 test (1 baru), `go test` tetap
   lulus, `console:build` tetap lulus, dan `openapi/notifhub.json` tetap identik (3 path, 9 schema).
7. **Nama migrasi** mempertahankan awalan `phase9` karena folder migrasi sudah diterapkan ke DB;
   mengganti nama folder akan membuat histori migrasi tidak sinkron. Ini artefak teknis, bukan
   istilah produk di dokumentasi.
