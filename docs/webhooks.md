# Desain webhook provider, rollup status, dan pembersihan data

Status: terimplementasi dan terverifikasi.
Basis: PART 1 (aturan 19, 25–27, 45) dan fondasi platform notifikasi yang sudah berjalan
(lihat `docs/local-setup.md`, `docs/in-app.md`, `docs/email-and-preferences.md`).

---

## 1. Ruang lingkup

### Termasuk dalam cakupan

1. **Webhook status provider** `POST /api/v1/webhooks/:provider`:
   - verifikasi signature HMAC (timestamp + body mentah),
   - simpan setiap event ke `delivery_events` (append-only),
   - perbarui `notification_recipients` (status + `sentAt`/`deliveredAt`/`readAt`/`lastError`),
   - idempoten terhadap retry provider (update status monotonik).
2. **Rollup job** `Notification.overallStatus` (pending | partial | sent | failed) terjadwal
   (`@nestjs/schedule`, setiap menit) dengan keyset sweep.
3. **Cleanup job** terjadwal malam hari:
   - **retention**: soft delete (`deletedAt`) notifikasi lebih tua dari `RETENTION_DAYS`,
   - **idempotency**: membebaskan `idempotencyKey` yang sudah kedaluwarsa tanpa menghapus data audit.
4. Kolom/endpoint pendukung: capture raw body untuk signature, env baru
   `WEBHOOK_SIGNING_SECRET`, dokumentasi dan `.env.example`.

### Tidak termasuk (di luar cakupan)

- Topic & admin API + auth admin JWT (lihat `docs/admin-api.md`).
- Admin Console & `@notifhub/react` (lihat `docs/react-and-console.md`).
- WhatsApp provider/worker (lihat `docs/whatsapp.md`).
- End-user preference center, platform admin (lihat `docs/preference-center.md`).
- API baca `delivery_events` (menyusul di admin API — `docs/admin-api.md` — dan konsolnya di
  `docs/react-and-console.md`).
- Batch ingest, digest, campaign features.

---

## 2. Webhook provider

### 2.1 Endpoint

```http
POST /api/v1/webhooks/:provider
Content-Type: application/json
X-NotifHub-Signature: t=1794760000,v1=<hex hmac sha256>
```

- `provider` harus salah satu dari allowlist: `smtp`, `whatsapp`, `sms`
  (case-insensitive, dipetakan ke `Channel`); selain itu `404`.
- Tidak memakai `X-API-Key`. Autentikasi webhook = signature HMAC.
- Signature dihitung provider (atau simulator) atas string: `<timestamp>.<raw body>`
  dengan `WEBHOOK_SIGNING_SECRET`, hex SHA-256.
- Toleransi timestamp: **300 detik** (mencegah replay). Signature dibandingkan dengan
  `timingSafeEqual`.
- Gagal signature / timestamp kedaluwarsa / header tidak lengkap → `401`.
- Body bukan JSON valid → `400`.

### 2.2 Body

```json
{
  "eventId": "evt_123",
  "eventType": "delivered",
  "notificationId": "1e0eb116-5ac9-4216-88b1-22c4c037ce4a",
  "recipientId": "user-test-1",
  "channel": "email",
  "providerMessageId": "<abc@notifhub.local>",
  "occurredAt": "2026-11-15T23:50:00.000Z",
  "metadata": { "remoteIp": "203.0.113.10" }
}
```

- `eventId`: string 1–128, wajib (disimpan di `rawPayload` untuk audit/idempotensi logis).
- `eventType`: `delivered` | `failed` | `bounced` | `read` | `opened`.
- `notificationId`: UUID; `recipientId`: string; `channel`: opsional, default dari provider.
- `providerMessageId`, `metadata`, `occurredAt` opsional.

### 2.3 Efek

| eventType | Efek pada `notification_recipients` |
|---|---|
| `delivered` | `status = sent`, `deliveredAt = occurredAt` (diisi bila kosong), `providerMessageId` bila kosong |
| `read` | `status = read`, `readAt = occurredAt` (bila kosong), `deliveredAt` bila kosong |
| `failed` / `bounced` | `status = failed`, `lastError = "<eventType>: <message/metadata ringkas>"` |
| `opened` | tidak mengubah status; hanya dicatat di `delivery_events` |

- Setiap event **selalu** menulis satu baris `delivery_events`
  (`notificationId`, `recipientId`, `channel`, `providerName`, `eventType`, `rawPayload`, `occurredAt`).
- Update status bersifat **monotonik**:
  - `delivered`/`read` boleh menaikkan `pending`/`failed` menjadi `sent`/`read`;
  - `failed` **tidak** menurunkan `sent`/`read` (event telat/bounce setelah delivered diabaikan
    untuk status, tetap dicatat);
  - `skipped` tidak pernah diubah oleh webhook.
- Duplikat event diperbolehkan (append-only); efek status idempoten karena hanya mengisi
  timestamp yang masih kosong dan tidak menurunkan status.
- Notifikasi/recipient yang tidak ditemukan → tetap `202` dengan `{ "status": "accepted" }`
  dan log `webhook.unmatched` (provider tidak perlu retry karena data kita tidak ada).
- Notifikasi soft-deleted (`deletedAt != null`) → event dicatat, status tidak diubah,
  log `webhook.deleted_notification`.

Response `202`:

```json
{ "status": "accepted" }
```

### 2.4 Raw body

`main.ts` saat ini mendaftarkan `express.json({ limit })` manual (bodyParser Nest dimatikan).
Ditambahkan `verify` callback yang menyimpan buffer mentah ke `req.rawBody` hanya untuk
kebutuhan signature. Tidak ada perubahan limit (64 KB tetap berlaku).

---

## 3. Rollup `overallStatus`

### 3.1 Aturan

Dihitung dari status seluruh baris `notification_recipients` milik notifikasi:

- `success` = jumlah `sent` + `read`
- `failed` = jumlah `failed`
- `skipped` = jumlah `skipped`
- `pending` = jumlah `pending`

| Kondisi | overallStatus |
|---|---|
| `pending > 0` dan `success = 0` dan `failed = 0` | `pending` |
| `pending > 0` dan (`success > 0` atau `failed > 0`) | `partial` |
| `pending = 0`, `success > 0`, `failed = 0` | `sent` |
| `pending = 0`, `success > 0`, `failed > 0` | `partial` |
| `pending = 0`, `success = 0`, `failed > 0` | `failed` |
| `pending = 0`, `success = 0`, `failed = 0` (semua skipped) | `failed` |

`skipped` tidak menghalangi status `sent` (contoh: 1 sent + 1 skipped → `sent`).

### 3.2 Penjadwalan

- `@Cron(CronExpression.EVERY_MINUTE)` pada `NotificationRollupService`.
- Sweep keyset per proses: ambil batch (200) notifikasi dengan
  `overallStatus IN ('pending','partial')` dan `id > lastSeenId` urut `id asc`;
  jika batch terakhir kosong, reset `lastSeenId` ke awal (siklus berulang).
- Untuk setiap notifikasi: satu query `groupBy status` + update bila berubah.
- Log ringkasan per siklus (`notification.rollup.cycle`) dan log perubahan
  (`notification.rollup.updated`).
- Tidak ada env baru; interval tetap 60 detik.

---

## 4. Cleanup job

Dua job `@Cron` terpisah, timezone **UTC** (deterministik), berjalan malam:

### 4.1 Retention (`0 2 * * *`)

- Ambil id notifikasi dengan `createdAt < now - RETENTION_DAYS` dan `deletedAt IS NULL`
  (batch 1000, loop sampai habis).
- Soft delete: `deletedAt = now()` (PART 1 rule 27: soft delete only, tidak ada hard delete).
- Log jumlah baris (`notification.retention.archived`).
- Data tetap dapat dibaca admin (`docs/admin-api.md`, `docs/react-and-console.md`)
  dengan filter `deletedAt`.

### 4.2 Idempotency (`30 2 * * *`)

- Notifikasi dengan `idempotencyExpiresAt < now()` masih menempati unique index
  `idempotencyKey`, sehingga key tidak bisa dipakai ulang.
- Solusi: **rotasi key** (bukan hapus data audit) memakai SQL parameterized:

```sql
UPDATE "Notification"
SET "idempotencyKey" = 'expired:' || "id"::text
WHERE "idempotencyExpiresAt" < $1
  AND "idempotencyKey" NOT LIKE 'expired:%'
```

- `expired:<uuid>` unik (id unik), panjang < 128, tidak bertabrakan dengan pola key consumer
  (`^[a-zA-Z0-9._:-]+$` — huruf/angka/titik/underscore/titik dua/hyphen; prefix `expired:`
  valid dan unik karena diikuti UUID).
- Setelah rotasi, ingest dengan key asli akan membuat notifikasi baru (bukan idempotent hit),
  sesuai TTL `IDEMPOTENCY_TTL_DAYS`.
- Log jumlah baris (`notification.idempotency.expired_keys_released`).

---

## 5. Konfigurasi & perubahan proyek

- **Env baru:** `WEBHOOK_SIGNING_SECRET` (min 32 karakter, wajib; ditambahkan ke
  `env.schema.ts`, `.env.example`, dan `.env` lokal).
- **Tidak ada perubahan `schema.prisma`** (semua kolom dan tabel sudah tersedia sejak
  fondasi skema awal).
- **Dependency:** tidak ada yang baru (`crypto` bawaan Node, `@nestjs/schedule` sudah ada).
- **Versi root:** `0.4.0`.
- Swagger: dokumentasi endpoint webhook (tanpa skema keamanan `api-key`).

---

## 6. Daftar file

### Backend — baru

| File | Isi |
|---|---|
| `src/webhooks/webhooks.controller.ts` | `POST /webhooks/:provider` (delegasi ke service) |
| `src/webhooks/webhooks.service.ts` | Verifikasi signature, simpan event, update status |
| `src/webhooks/webhook-signature.service.ts` | HMAC verification + timestamp tolerance |
| `src/webhooks/dto/webhook-event.dto.ts` | DTO + validasi event type/channel |
| `src/webhooks/webhooks.module.ts` | Wiring webhook |
| `src/notifications/notification-rollup.service.ts` | Cron rollup + keyset sweep |
| `src/notifications/notifications.module.ts` | Modul rollup |
| `src/cleanup/cleanup.service.ts` | Cron retention + idempotency |
| `src/cleanup/cleanup.module.ts` | Modul cleanup |

### Backend — diubah

| File | Perubahan |
|---|---|
| `src/main.ts` | `express.json({ verify })` menyimpan `req.rawBody` |
| `src/config/env.schema.ts` | `WEBHOOK_SIGNING_SECRET` (min 32) |
| `src/app.module.ts` | `WebhooksModule`, `NotificationsModule`, `CleanupModule` |
| `.env.example`, `.env` | `WEBHOOK_SIGNING_SECRET` |
| `package.json` | versi 0.4.0 |
| `docs/local-setup.md`, `README.md` | Bagian webhook provider, rollup status, dan pembersihan data |

### SDK — tidak berubah

Tidak ada perubahan pada SDK; lihat `docs/go-sdk.md`.

---

## 7. Rencana verifikasi

1. `npm run typecheck`, `npm run build`, `npm run sdk:test` — hijau.
2. Ingest email untuk `user-test-1` (development, log-only) → recipient `sent`.
3. Kirim webhook `delivered` bertanda tangan valid untuk recipient tersebut:
   - response `202`,
   - satu baris `delivery_events`,
   - `deliveredAt` terisi, status tetap `sent`,
   - `providerMessageId` terisi bila kosong.
4. Webhook `read` → status `read`, `readAt` terisi.
5. Webhook `bounced` untuk recipient yang masih `pending` → status `failed`, `lastError` terisi,
   satu baris `delivery_events`.
6. Webhook duplikat (event sama dua kali) → dua baris `delivery_events`, status tetap benar.
7. Webhook `failed` setelah `delivered` → status **tidak** turun, event tetap tercatat.
8. Signature salah / timestamp kedaluwarsa 10 menit / header hilang → `401`;
   provider tidak dikenal → `404`; body invalid → `400`.
9. Notification/recipient tidak ada → `202` + log `webhook.unmatched`.
10. Rollup:
    - 2 recipient: satu `delivered`, satu `bounced` → `overallStatus=partial`;
    - semua `delivered`/`read` → `sent`;
    - semua `bounced` → `failed`;
    - semua `pending` → tetap `pending`;
    - 1 `sent` + 1 `skipped` → `sent`.
11. Retention: sisipkan notifikasi `createdAt` 100 hari lalu → job retention menandai
    `deletedAt`; notifikasi baru tidak tersentuh.
12. Idempotency: notifikasi dengan `idempotencyExpiresAt` lampau → key berubah menjadi
    `expired:<uuid>`; ingest ulang dengan key asli membuat notifikasi **baru** (bukan idempotent
    hit) dan sukses.
13. Job cron berjalan otomatis (log cycle/archived/expired) tanpa mengganggu pengujian lain.

---

## 8. Keputusan desain

| # | Keputusan | Diterapkan |
|---|---|---|
| D1 | Endpoint webhook generik `POST /api/v1/webhooks/:provider` dengan HMAC `WEBHOOK_SIGNING_SECRET` | Ya |
| D2 | Event untuk notification/recipient yang tidak dikenal → `202` ignored (bukan `404`) | Ya |
| D3 | Duplikat event diizinkan (append-only); update status monotonik | Ya |
| D4 | `opened` hanya dicatat, tidak mengubah status | Ya |
| D5 | Rollup cron 60 detik + keyset sweep batch 200, tanpa env baru | Ya |
| D6 | Cleanup idempotency = rotasi key menjadi `expired:<uuid>` (audit tetap utuh) | Ya |
| D7 | Retention = soft delete `deletedAt` saja (tanpa hard delete) | Ya |
| D8 | Jadwal cleanup UTC 02:00 (retention) dan 02:30 (idempotency) | Ya |
| D9 | `WEBHOOK_SIGNING_SECRET` wajib di semua mode (min 32 karakter) | Ya |
| D10 | `delivery_events` belum punya API baca (menunggu admin API — `docs/admin-api.md`) | Ya |

---

## 9. Catatan implementasi

1. **Raw body** ditangkap lewat `express.json({ verify })` di `main.ts` dan disimpan sebagai
   `req.rawBody`; signature diverifikasi dari buffer tersebut (bukan body hasil parse).
2. **Allowlist provider** `smtp` → email, `whatsapp` → WhatsApp, `sms` → SMS. `channel` pada body
   harus cocok dengan provider (mismatch → `400`); provider tak dikenal → `404`.
3. **Event tak dikenal** (recipient row tidak ada) tetap `202` dan dicatat sebagai
   `webhook.unmatched`; notifikasi soft-deleted tetap mencatat event tanpa mengubah status.
4. **Rotasi idempotency** memakai `$executeRaw` (satu statement SQL parameterized) karena
   Prisma `updateMany` tidak bisa menulis ekspresi kolom; prefix `expired:` + UUID tetap unik.
5. **Retention** memakai batch 1000 dan hanya mengisi `deletedAt` (soft delete).
6. **Rollup** berjalan tiap menit (UTC), keyset per id, batch 200; `skipped` netral; aturan
   `computeOverallStatus` diekspor untuk memudahkan pengujian.
7. **Cron cleanup** memakai timezone UTC eksplisit agar deterministik.
8. **`WEBHOOK_SIGNING_SECRET`** wajib di semua mode (min 32 karakter) dan sudah ditambahkan ke
   `.env.example` serta `.env` lokal.
9. Verifikasi webhook/rollup/cleanup memakai skrip sementara yang sudah dihapus setelah
   pengujian; semua skenario pada §7 lulus.
10. **Tidak ada perubahan `schema.prisma`**, tidak ada dependency baru; versi root menjadi
    `0.4.0`.
