# Desain Admin API: API key, autentikasi admin, topik, dan isolasi tenant

Status: terimplementasi dan terverifikasi.
Basis: PART 1 (aturan 14, 33–37, 41, 46–47), serta kemampuan ingest, delivery, dan preferensi yang sudah berjalan.

---

## 1. Ruang lingkup

### Termasuk dalam cakupan

1. **ApiKey berbasis tabel** untuk ingest (menggantikan perbandingan `SERVICE_API_KEY` tunggal),
   termasuk bootstrap key dari env, pembuatan/penonaktifan key lewat Admin API, dan `lastUsedAt`.
2. **Auth admin**: login email + password (bcrypt) → JWT `ADMIN_JWT_SECRET`, bootstrap satu admin
   dari `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH`, `AdminJwtGuard` (role `tenant_admin`).
3. **Topic + membership push API** (consumer, `X-API-Key`):
   `PUT /topics/:key/members` (replace), `POST /topics/:key/members` (add), `GET .../members`,
   auto-create topic, `expiresAt`, `isTimeBound`.
4. **Targeting topic di ingest**: `topics[]` + `recipients[]`, union + dedupe, snapshot,
   `targetType` (`recipients` | `topics` | `mixed`), tenant dari API key.
5. **Admin API tenant-scoped** (`/api/v1/admin/*`): auth, api-keys, templates (CRUD),
   subscribers (read + preferences write), topics (read + membership write), notifications
   (list + detail dengan recipients/attempts/events).
6. Env `ADMIN_JWT_EXPIRES_IN`, dokumentasi, dan pembaruan Swagger (skema `admin-jwt`).

### Tidak termasuk (di luar cakupan)

- Admin Console / `@notifhub/react` — lihat `docs/react-and-console.md`.
- WhatsApp provider/worker — lihat `docs/whatsapp.md`.
- Group acknowledgment (broadcast/critical, deadline) — ditunda; lihat D11.
- Self-service subscription end-user (`mode="self-service"`, opt-in) — di luar cakupan;
  batasannya dijelaskan di `docs/preference-center.md`.
- End-user preference center UI — di luar cakupan; batasannya di `docs/preference-center.md`.
  Platform admin lintas tenant belum dikerjakan.
- Cleanup member kedaluwarsa sebagai scheduled job (ditunda; resolusi sudah memfilter).
- Scheduled/delayed notification, batch ingest, workflow.

---

## 2. Tiga jalur autentikasi (tidak boleh tercampur)

| Jalur | Endpoint | Kredensial | Guard | Principal |
|---|---|---|---|---|
| Ingest / topic push | `/api/v1/notify`, `/api/v1/topics/*`, `/api/v1/subscribers/*` | `X-API-Key: nhk_...` | `ApiKeyGuard` | `{ apiKeyId, tenantId }` |
| Admin | `/api/v1/admin/*` (kecuali login) | `Authorization: Bearer <admin JWT>` | `AdminJwtGuard` | `{ adminId, email, role, tenantId }` |
| End-user in-app | `/api/v1/in-app/*` | `Authorization: Bearer <subscriber JWT>` | `SubscriberJwtGuard` | `{ recipientId, tenantId }` |

- Admin JWT memakai `ADMIN_JWT_SECRET`; subscriber JWT memakai `SUBSCRIBER_JWT_SECRET`.
- Token subscriber/admin tidak pernah diterima di endpoint ingest, dan sebaliknya.
- `X-API-Key` mentah tidak pernah disimpan; hanya hash SHA-256.

---

## 3. ApiKey tabel

### 3.1 Format & penyimpanan

- Key dibuat server: `nhk_` + 32 byte acak (base64url) → ± 47 karakter.
- Disimpan sebagai `keyHash = sha256(rawKey)` (hex) di `ApiKey.keyHash` (unique).
- Key mentah **hanya dikembalikan sekali** saat pembuatan (Admin API) dan tidak pernah di-log.
- `keyPreview` untuk daftar: `nhk_` + 4 karakter awal + `...` + 4 karakter akhir.

### 3.2 Bootstrap

- Saat startup, jika `ApiKey` belum punya baris dan `SERVICE_API_KEY` tersedia:
  buat satu baris `{ name: "bootstrap", keyHash: sha256(SERVICE_API_KEY),
  tenantId: DEFAULT_TENANT_ID, subscriberJwtSecret: SUBSCRIBER_JWT_SECRET, active: true }`.
- Setelah tabel terisi, `SERVICE_API_KEY` **tidak** lagi dipakai untuk autentikasi (hanya
  bootstrap), sehingga alur yang sudah berjalan (ingest, delivery, preferensi) tetap berjalan
  tanpa perubahan curl.
- Log hanya `api_key.bootstrap.created` (tanpa key).

### 3.3 Guard

- Ambil header `x-api-key`; kosong → 401.
- `sha256` → cari `ApiKey` dengan `keyHash` dan `active=true`.
- Tidak ditemukan/nonaktif → 401 (log `auth.api_key.rejected` dengan ip/path).
- `lastUsedAt` diperbarui maksimal sekali per 60 detik per key (update bersyarat, error diabaikan).
- `request.apiKey = { id, tenantId }`; controller/service tidak membaca header lagi.
- Tidak ada cache in-memory (satu query per request; sederhana dan selalu segar).

### 3.4 Admin API key management

- `GET /api/v1/admin/api-keys` → daftar milik tenant admin (tanpa raw key).
- `POST /api/v1/admin/api-keys` body `{ name, allowedOrigins?, subscriberJwtSecret? }`
  → `201 { id, name, key, keyPreview, tenantId, createdAt }` (raw key sekali).
- `POST /api/v1/admin/api-keys/:id/revoke` → `active=false` (idempoten), `200`.
- `tenantId` selalu dari admin JWT; tidak boleh dari body/query.

---

## 4. Ingest dengan topic

### 4.1 DTO

- `topics?: string[]` (opsional, maks 50, tiap key pola `^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$`).
- `recipients?` menjadi opsional; jika ada minimal 1, maks 1000.
- Minimal salah satu `topics`/`recipients` tidak kosong; jika keduanya kosong → `400`
  (divalidasi di service, pesan `topics or recipients must not be empty`).
- `tenant_id` **deprecated**: bila dikirim dan tidak sama dengan tenant API key → `400`;
  bila sama, diterima. Tanpa `tenant_id`, tenant diambil dari API key.

### 4.2 Resolusi

`TopicResolutionService.resolve(tenantId, topicKeys)`:

1. Ambil `Topic` dengan `(tenantId, key in keys)`.
2. Key yang tidak ditemukan → `400` `unknown topic key: <key>` (topic dibuat lewat membership push).
3. Ambil `TopicSubscriber` milik topic tersebut dengan `expiresAt IS NULL OR expiresAt > now()`.
4. Hasil: map `recipientId → { topicKeys[] }`.

Ingest menggabungkan:

- recipient langsung (string/objek, data inline dipertahankan),
- recipient dari topic (tanpa inline data; jika recipient juga dikirim langsung, data inline
  menang — PART 1 rule 35/39),
- dedupe by `recipientId`.

Snapshot:

```json
{
  "topics": ["shift:gudang"],
  "recipient_ids": ["user-1", "user-2"],
  "channels": ["inapp", "email"]
}
```

`targetType` = `topics` (hanya topic), `recipients` (hanya direct), `mixed` (keduanya).
`NotificationRecipient` dan job dibuat untuk hasil union (satu job per recipient × channel).

---

## 5. Topic membership API (consumer)

Auth: `X-API-Key` (tenant dari key). Base `/api/v1/topics`.

### 5.1 `PUT /topics/:key/members` — replace membership

```json
{
  "members": [{ "recipientId": "user-1" }, { "recipientId": "user-2", "expiresAt": "2026-12-01T00:00:00.000Z" }],
  "expiresAt": "2026-11-30T00:00:00.000Z",
  "isTimeBound": true
}
```

- Auto-create topic `(tenantId, key)` dengan `mode="push"`, `isTimeBound` dari body
  (default `false`).
- Replace: seluruh membership lama yang tidak ada di body dihapus, yang ada di-upsert.
- `expiresAt` efektif per member = `member.expiresAt ?? body.expiresAt ?? null`.
- Jika `topic.isTimeBound=true` (existing atau hasil create) → setiap member wajib punya
  `expiresAt` efektif; jika tidak → `400`.
- Jika topic existing `isTimeBound=false` dan body `isTimeBound=true` → `400`
  (`isTimeBound cannot be changed on an existing topic`); perubahan hanya lewat Admin Console
  (lihat `docs/react-and-console.md`).
- `members` maks 1000; `recipientId` 1–128 karakter.
- Response `200`:

```json
{ "topic": { "key": "shift:gudang", "isTimeBound": true }, "memberCount": 2, "removed": 1 }
```

### 5.2 `POST /topics/:key/members` — add/update subset

- Sama seperti PUT tetapi **tidak menghapus** member yang tidak dikirim.
- Response `200 { topic, added, updated }` (angka berdasarkan ada/tidaknya baris).
- Aturan `isTimeBound`/`expiresAt` identik.

### 5.3 `GET /topics/:key/members`

- `?includeExpired=true|false` (default false).
- Response `200 { topic: { key, isTimeBound, mode }, members: [{ recipientId, addedAt, expiresAt }], expiredCount }`.
- `404` jika topic tidak ada (key tenant lain dianggap tidak ada).

### 5.4 Mode self-service

- `Topic.mode` default `"push"`; dokumen ini tidak menyediakan endpoint untuk mengubah `mode`.
- Consumer membership API tetap dapat dipakai untuk topic mode apa pun; pembatasan self-service
  (opt-in end-user) berada di luar cakupan dokumen ini dan dicatat sebagai batasan di
  `docs/preference-center.md`.

---

## 6. Admin API

Base `/api/v1/admin`, semua endpoint memakai `AdminJwtGuard` kecuali login.
Semua query difilter `tenantId` dari token; parameter tenant dari client diabaikan.

### 6.1 Auth

- `POST /auth/login` body `{ email, password }`.
  - bcrypt.compare; email tidak ada tetap menjalankan compare terhadap dummy hash
    (mengurangi enumerasi timing).
  - `active=false` → `403`; kredensial salah → `401`.
  - Sukses: update `lastLoginAt`, response:
    `{ accessToken, tokenType: "Bearer", expiresIn: 3600, admin: { id, email, role, tenantId } }`.
  - Throttle: 5 percobaan/menit per IP (`@Throttle` + `ThrottlerGuard` scoped di AdminModule).
- `GET /auth/me` → profil admin dari token.

Bootstrap admin (saat `onApplicationBootstrap`):

- Upsert by `ADMIN_EMAIL`; role `tenant_admin`, tenant `DEFAULT_TENANT_ID`, `active=true`.
- Jika `ADMIN_PASSWORD_HASH` berbeda dari baris existing, hash diperbarui (env = sumber
  kebenaran untuk satu admin).
- Log `admin.bootstrap.ready` (tanpa hash).

### 6.2 Templates

- `GET /templates?channel&locale&active&search&limit&offset` (default limit 20, max 100).
- `POST /templates` `{ key, channel, locale, subject?, body, version?, active? }` → `201`.
  Bentrok unique `(key, channel, locale, version)` → `409`.
- `PUT /templates/:id` (partial update: subject/body/active/fallbackProvider/fallbackChannel)
  → `200`; `404` bila bukan tenant admin.
- `DELETE /templates/:id` → set `active=false` (soft delete), `200`.
- `GET /templates/:id` → detail.

### 6.3 Subscribers

- `GET /subscribers?search&limit&offset`.
- `GET /subscribers/:externalId`.
- `GET /subscribers/:externalId/preferences` → daftar preferensi per channel.
- `PUT /subscribers/:externalId/preferences/:channel`
  `{ enabled, quietHoursStart?, quietHoursEnd?, timezone }` → upsert, `200`.
  (Diperlukan Admin Console — lihat `docs/react-and-console.md`; enforcement sudah berjalan
  sejak fitur preferensi diperkenalkan — lihat `docs/email-and-preferences.md`.)
- API preferensi self-service publik untuk end-user berada di luar Admin API dan dibahas di
  `docs/preference-center.md`.

### 6.4 Topics

- `GET /topics?search&limit&offset` (member count per topic).
- `GET /topics/:key` + `GET /topics/:key/members?includeExpired=`.
- `PUT /topics/:key/members` dan `POST /topics/:key/members` dengan body yang sama seperti
  endpoint consumer (tenant dari admin JWT). Dipakai Admin Console — lihat
  `docs/react-and-console.md`.

### 6.5 Notifications

- `GET /notifications?status&templateKey&from&to&limit&offset`
  → ringkasan: id, templateKey, tenantId, priority, overallStatus, targetType, createdAt,
  recipientCount, sentCount, failedCount.
- `GET /notifications/:id` → detail: notification (termasuk `payload`, `targetSnapshot`,
  `resendOfNotificationId`, `resendMode`) + recipients (status, attempts, provider, timestamps,
  lastError) + 20 `delivery_attempts` terakhir + 20 `delivery_events` terakhir.
- `404` bila bukan milik tenant admin.

### 6.6 Re-send failed

`POST /admin/notifications/:id/resend` (admin JWT, tenant-scoped):

```json
{
  "mode": "failed",
  "requestKey": "<uuid>"
}
```

- Hanya baris `NotificationRecipient` berstatus `failed` yang dikirim ulang, dengan pasangan
  `(recipientId, channel)` yang sama; channel yang sudah sukses tidak ikut dikirim.
- Membuat **notification baru**; notification asli tetap immutable.
- `resendOfNotificationId` dan `resendMode` menyimpan jejak audit.
- `requestKey` adalah idempotency key; request berulang mengembalikan notification baru yang sama.
- Tidak membuat `BillingEvent` baru.
- `202 { notification_id, status: "accepted", mode: "failed", recipient_count, channels }`.
- Tidak ada failed recipient → `409`; notification bukan milik tenant → `404`.
- `mode: "all"` belum didukung pada fase ini.

### 6.7 Pagination

- Semua list: `limit` (default 20, max 100) + `offset` (default 0).
- Response list: `{ items, total, limit, offset }`.
- Notifications juga memakai limit/offset (bukan cursor) agar konsisten untuk console.

---

## 7. Data model & konfigurasi

- **Perubahan schema setelah fase awal:** `NotificationTemplate.tenantId` (§11.1) dan, untuk
  re-send console, `Notification.resendOfNotificationId` + `Notification.resendMode` (migrasi
  `20261116130000_resend_audit`).
- **Env baru:** `ADMIN_JWT_EXPIRES_IN` (pola `^\d+[smhd]$`, default `1h`).
- **Dependency:** tidak ada yang baru (`jsonwebtoken`, `bcrypt`, `@nestjs/throttler` sudah ada).
- **Versi root:** `0.5.0`.
- Swagger: tambah skema `admin-jwt`; dokumentasi endpoint admin/topic.

---

## 8. Daftar file

### Auth / API key (baru & diubah)

| File | Isi |
|---|---|
| `src/auth/api-key/api-key.service.ts` | Hash, authenticate, bootstrap, create/list/revoke |
| `src/auth/api-key/api-key.types.ts` | `ApiKeyPrincipal`, `RequestWithApiKey` |
| `src/auth/admin/admin-token.service.ts` | Sign/verify admin JWT |
| `src/auth/admin/admin-jwt.guard.ts` | Guard admin (role tenant_admin) |
| `src/auth/admin/admin-bootstrap.service.ts` | Bootstrap admin dari env |
| `src/auth/admin/admin.types.ts` | `AdminPrincipal`, `RequestWithAdmin` |
| `src/auth/auth.module.ts` | Diubah: provider baru |
| `src/common/guards/api-key.guard.ts` | Diubah: lookup tabel + `lastUsedAt` |

### Topic & routing

| File | Isi |
|---|---|
| `src/topics/topics.service.ts` | Membership replace/add/get + validasi time-bound |
| `src/topics/topics.controller.ts` | Endpoint consumer `/topics/*` |
| `src/topics/dto/topic-members.dto.ts` | DTO membership (dipakai consumer & admin) |
| `src/topics/topics.module.ts` | Modul topic |
| `src/routing/topic-resolution.service.ts` | Resolusi topic → recipient aktif |
| `src/routing/routing.module.ts` | Modul routing |

### Admin API

| File | Isi |
|---|---|
| `src/admin/admin.module.ts` | Wiring admin + throttle |
| `src/admin/controllers/admin-auth.controller.ts` | login, me |
| `src/admin/controllers/admin-api-keys.controller.ts` | list, create, revoke |
| `src/admin/controllers/admin-templates.controller.ts` | CRUD template |
| `src/admin/controllers/admin-subscribers.controller.ts` | list, detail, preferences |
| `src/admin/controllers/admin-topics.controller.ts` | list, detail, members |
| `src/admin/controllers/admin-notifications.controller.ts` | list, detail, resend failed |
| `src/admin/services/admin-notification-resend.service.ts` | Resend failed-only + audit + dispatch |
| `src/admin/dto/resend-notification.dto.ts` | Body mode/requestKey |
| `src/admin/services/*.service.ts` | Logika per resource |
| `src/admin/dto/*.dto.ts` | Login, api key, template, preference, list query, response |

### Diubah

`src/ingest/dto/notify.dto.ts` (topics, recipients opsional, validasi), `src/ingest/ingest.service.ts`
(resolusi topic, tenant dari API key, snapshot/targetType), `src/ingest/ingest.module.ts`,
`src/app.module.ts`, `src/main.ts` (scheme `admin-jwt`), `src/config/env.schema.ts`,
`.env.example`/`.env`, `package.json`, `README.md`, `docs/local-setup.md`.
Untuk re-send: `prisma/schema.prisma`, migrasi
`prisma/migrations/20261116130000_resend_audit/`, `src/admin/admin.module.ts`,
`src/admin/services/admin-notifications.service.ts`.

---

## 9. Verifikasi

1. Typecheck, build, unit test SDK hijau.
2. Bootstrap: admin dari env ada di DB; bootstrap API key ada (hash, bukan raw); login dengan
   password env → `200` + JWT; password salah → `401`; email tidak ada → `401`;
   `GET /admin/auth/me` dengan token → `200`; tanpa token → `401`.
3. Token subscriber dipakai di endpoint admin → `401`; token admin dipakai di endpoint
   subscriber → `401`.
4. API key: create via admin → raw `nhk_...` (sekali), list tanpa raw; ingest memakai key baru
   → `202`; revoke → key tersebut `401`; bootstrap key (`SERVICE_API_KEY`) tetap `202`.
5. Tenant: key tenant `acme` (dibuat via SQL untuk uji) ingest → notification `tenantId=acme`;
   admin default tidak melihat notification/topic acme (`404`/list kosong).
6. Topic: `PUT` pertama auto-create; `POST` menambah; `PUT` replace menghapus yang tidak
   dikirim; `GET` menampilkan member aktif; member dengan `expiresAt` lampau tidak muncul.
7. `isTimeBound=true` tanpa `expiresAt` → `400`; mengubah `isTimeBound` pada topic existing
   → `400`; topic key invalid → `400`; unknown topic pada ingest → `400`.
8. Ingest `topics` + `recipients` yang beririsan → recipient hanya sekali, `targetType=mixed`,
   snapshot berisi topics + recipient_ids, jumlah job = recipient unik × channel.
9. Ingest tanpa topics dan tanpa recipients → `400`.
10. `tenant_id` ingest berbeda dari tenant API key → `400`; sama/absen → sukses.
11. Admin templates: create (201), duplicate version (409), update, list filter, delete
    (active=false), detail.
12. Admin subscribers: list/detail; upsert preference `enabled=false` untuk email lalu ingest
    email → recipient `skipped` (regresi preferensi tetap bekerja; lihat
    `docs/email-and-preferences.md`).
13. Admin notifications: list filter status + detail berisi recipients, attempts, events, payload;
    notification tenant lain → `404`.
14. Admin re-send failed: notification baru dibuat, original tidak berubah, audit link terisi,
    request key yang sama tidak menduplikasi, tidak ada BillingEvent baru; tanpa failed → `409`.
15. Admin topics: list dengan member count, detail, membership write memakai tenant admin.
16. Swagger: path admin/topic muncul, skema `admin-jwt`, login tidak memakai `api-key`.
17. Login throttle: 6 percobaan cepat → `429`.

---

## 10. Keputusan desain

| # | Keputusan | Usulan default |
|---|---|---|
| D1 | ApiKey tabel + bootstrap dari `SERVICE_API_KEY` bila tabel kosong; setelah itu DB-only | Ya |
| D2 | Format key `nhk_<base64url>`, simpan `sha256`, raw ditampilkan sekali | Ya |
| D3 | Tanpa cache API key (query DB per request) | Ya |
| D4 | Tenant ingest dari API key; `tenant_id` deprecated, mismatch → `400` | Ya |
| D5 | Subscriber JWT tetap memakai `SUBSCRIBER_JWT_SECRET` global; secret per key reserved | Ya |
| D6 | Admin JWT HS256 + `ADMIN_JWT_EXPIRES_IN` (default `1h`); hanya role `tenant_admin`; `platform_admin` → `403` | Ya |
| D7 | Bootstrap satu admin dari env (upsert; hash diperbarui bila env berubah) | Ya |
| D8 | Cakupan Admin API: auth, api-keys, templates CRUD, subscribers read + preferences write, topics read + membership write, notifications read + resend failed | Ya |
| D9 | Topic consumer API: `PUT` replace, `POST` add, `GET` members; auto-create; `isTimeBound` hanya saat create | Ya |
| D10 | Cleanup member kedaluwarsa ditunda; resolusi memfilter `expiresAt` | Ya |
| D11 | Group acknowledgment ditunda; di luar cakupan dokumen ini | Ya |
| D12 | Pagination admin limit/offset + `total` | Ya |
| D13 | Login throttle 5/menit per IP | Ya |
| D14 | Tanpa dependency baru; schema berubah untuk `NotificationTemplate.tenantId` (§11.1) dan audit re-send `Notification.resendOfNotificationId`/`resendMode` | Ya |
| D15 | Preference write admin memakai validasi timezone yang sama dengan DTO subscriber | Ya |

---

## 11. Catatan implementasi

1. **Perubahan schema (deviasi dari §7):** `NotificationTemplate` memiliki kolom `tenantId`
   (default `"default"`) dan unique/index menjadi tenant-scoped. Tanpa kolom ini template tidak
   dapat dikelola per tenant sesuai PART 1 rule 46. Migrasi:
   `20261115170500_phase5_template_tenant`. `TemplateService` menerima `tenantId`
   di `resolve`/`resolveMany`; worker dan catch-up meneruskan tenant dari notifikasi/subscriber.
2. **Secret dev dibedakan:** `.env.example` sebelumnya memakai placeholder yang sama untuk
   `SUBSCRIBER_JWT_SECRET` dan `ADMIN_JWT_SECRET`, sehingga token admin lolos guard subscriber.
   Placeholder sekarang berbeda (dan nilainya tetap ≥32 karakter).
3. **ApiKeyGuard butuh AuthModule:** modul yang memakai guard (Ingest, Metrics, Subscribers,
   Topics) kini meng-import `AuthModule` agar `ApiKeyService` bisa di-resolve.
4. **Status code:** `POST /topics/:key/members` (consumer & admin) dan
   `POST /admin/api-keys/:id/revoke` mengembalikan `200` sesuai desain.
5. **Preferensi admin** diverifikasi lewat keberadaan subscriber pada tenant, karena
   `NotificationPreference` tidak memiliki kolom `tenantId` (batasan skema dasar).
6. **Template tenant-scoped** membuat tenant baru (mis. `acme`) gagal `template_not_found`
   sampai template-nya dibuat; ini juga bukti isolasi tenant.
7. **Verifikasi** memakai skrip sementara (sudah dihapus): 65 pemeriksaan HTTP lulus, plus
   pemeriksaan SQL untuk `targetType`/snapshot union, isolasi tenant, preferensi, admin
   bootstrap, API key, dan topic time-bound.
8. **Versi root** `0.5.0`; tidak ada dependency baru.
9. **Re-send failed (2026-11-16):** endpoint admin baru, migrasi audit
   `20261116130000_resend_audit`, notification baru dengan baris/job hanya untuk pasangan
   `(recipientId, channel)` failed, `requestKey` idempotent, deterministik job id untuk replay,
   dan tanpa BillingEvent baru. E2E E11 mencakup pasangan channel campuran (hanya inapp yang
   di-resend) serta replay request key.
