# Desain multi-tenant: entitas tenant, platform admin, dan provisioning

Status: **terimplementasi dan terverifikasi penuh (F1–F5)** pada 2026-11-19: entitas `Tenant`,
FK, migrasi/backfill, idempotency per tenant, lane auth platform, provisioning tenant + admin,
suspend, audit, `allowedOrigins`, dan console platform. Draf disetujui 2026-11-19. Lihat §19 untuk
catatan implementasi per fase.
Tanggal: 2026-11-19. Bahasa: Indonesia.

Basis: `docs/architecture/project-brief.md`, `docs/design/admin-api.md` (terutama §2 dan D6),
`docs/design/preference-center.md` §6, kode `src/auth`, `src/admin`, `src/ingest`, `src/cleanup`,
serta suite e2e E1–E29. Audit tenancy dilakukan pada 2026-11-19; temuan dicatat di §3.

**Isi dokumen**

- [1. Latar belakang](#1-latar-belakang)
- [2. Ruang lingkup](#2-ruang-lingkup)
- [3. Kondisi saat ini dan gap](#3-kondisi-saat-ini-dan-gap)
- [4. Prinsip desain](#4-prinsip-desain)
- [5. Opsi dan keputusan](#5-opsi-dan-keputusan)
- [6. Model data dan migrasi](#6-model-data-dan-migrasi)
- [7. Auth dan otorisasi](#7-auth-dan-otorisasi)
- [8. API platform](#8-api-platform)
- [9. Perilaku tenant suspended](#9-perilaku-tenant-suspended)
- [10. Audit platform](#10-audit-platform)
- [11. Console](#11-console)
- [12. Keamanan](#12-keamanan)
- [13. Fase implementasi](#13-fase-implementasi)
- [14. Verifikasi dan regresi](#14-verifikasi-dan-regresi)
- [15. Daftar file](#15-daftar-file)
- [16. Risiko](#16-risiko)
- [17. Definition of done](#17-definition-of-done)
- [18. Pertanyaan keputusan](#18-pertanyaan-keputusan)
- [19. Catatan implementasi](#19-catatan-implementasi)

---

## 1. Latar belakang

NotifHub sudah multi-tenant di lapisan data: setiap tabel inti punya `tenantId`, tenant diturunkan
dari kredensial (bukan dari body), dan isolasi diuji e2e (E7: admin tenant A mendapat `404` untuk
data tenant B; E8: token subscriber memakai secret per tenant). Namun **operasionalnya masih
single-tenant**: tenant hanya berupa string dengan nilai `default`, tidak ada entitas tenant,
tidak ada cara membuat tenant baru selain seed/DB, dan `platform_admin` sengaja ditolak.

Akibatnya, produk belum bisa dipakai sebagai layanan multi-tenant: tidak ada provisioning,
suspend, offboarding, audit lintas tenant, maupun pemisahan peran platform vs tenant. Dokumen ini
merancang penutup gap tersebut, termasuk dua bug tenancy yang ditemukan saat audit (§3.1).

## 2. Ruang lingkup

### Termasuk

1. Entitas `Tenant` (id, nama, status) + relasi FK dari tabel yang memiliki `tenantId`.
2. Lane auth keempat: **platform admin** (`platform_admin`), terpisah dari tenant admin.
3. API platform: login, kelola tenant (list/create/rename/suspend/resume/delete-if-empty), kelola
   admin per tenant, dan baca audit.
4. Penegakan status tenant di ketiga lane yang sudah ada (ingest, admin tenant, subscriber).
5. Audit platform append-only untuk semua mutasi.
6. Penegakan `ApiKey.allowedOrigins` yang saat ini disimpan tanpa dipakai.
7. Perbaikan idempotency lintas tenant (`Notification.idempotencyKey` masih unik global).
8. Console platform (login terpisah, daftar tenant, detail tenant + admin, audit).
9. Bootstrap idempoten: tenant `default`, admin tenant, API key bootstrap, dan opsional platform
   admin dari env.
10. Test e2e baru (E30–E37), unit test guard/validator, dan pembaruan dokumentasi.

### Tidak termasuk

- **Impersonation / tenant switcher**: platform admin tidak dapat membuka console tenant atau
  membaca isi notifikasi/subscriber tenant. Hanya metadata + hitungan.
- **Kuota dan rate limit per tenant**: ditunda (D13); perlu counter Redis dan desain terpisah.
- **Membership multi-tenant satu identitas**: satu email tetap satu akun dengan satu tenant (D12).
- **Manajemen akun platform admin dari UI/API** (membuat/menonaktifkan platform admin lain); v1
  hanya bootstrap dari env.
- **RBAC granular** (`platform_readonly`, approver template, dsb.). Yang ada hanya dua role.
- **Self-service signup tenant**, billing, dan invoice.
- **SSO/OIDC, refresh token, password reset via email** — sama seperti batasan saat ini.
- **Melanjutkan/membatalkan job** milik tenant yang di-suspend (§9: job yang sudah antre tetap
  diproses).
- Publikasi `@notifhub/js` baru: console memakai transport lokal (D14).

## 3. Kondisi saat ini dan gap

### 3.1 Gap dan bug yang ditemukan

| # | Gap | Bukti |
|---|---|---|
| G1 | Tidak ada entitas/status tenant; tenant hanya string default `"default"` | Tidak ada `model Tenant` di `prisma/schema.prisma`; setiap `tenantId` memakai `@default("default")` |
| G2 | Provisioning hanya lewat seed/DB; API key selalu dibuat untuk tenant admin itu sendiri | `src/admin/services/admin-api-keys.service.ts` (`create(tenantId, …)`), dipanggil dengan `admin.tenantId` di controller |
| G3 | `platform_admin` ditolak di semua endpoint admin | `src/auth/admin/admin-jwt.guard.ts` (`principal.role !== TENANT_ADMIN_ROLE` → `403`), `docs/design/admin-api.md` D6 |
| G4 | Identitas admin global: email unik, satu admin = satu tenant, tanpa pemilihan tenant saat login | `prisma/schema.prisma` (`AdminUser.email @unique`), `src/admin/services/admin-auth.service.ts` (`findUnique({ where: { email } })`) |
| G5 | Tidak ada cara suspend tenant; hanya `ApiKey.active` per key | `prisma/schema.prisma` (`ApiKey.active`), tidak ada status tenant |
| G6 | `ApiKey.allowedOrigins` disimpan tetapi tidak pernah dibaca | `src/auth/api-key/api-key.service.ts` (`authenticate` hanya `select id, tenantId, active, lastUsedAt`) |
| G7 | Tidak ada audit platform; `TemplateAuditEvent` hanya untuk template | `prisma/schema.prisma`, `docs/design/templates/template-system-design.md` §6 |
| G8 | **Bug:** idempotency key unik global, bukan per tenant | `Notification.idempotencyKey String @unique`; lookup di `src/ingest/ingest.service.ts` (`findUnique({ where: { idempotencyKey } })`) tidak memfilter tenant |
| G9 | Guard admin hanya memverifikasi JWT (tanpa cek DB) sehingga admin nonaktif masih bisa memakai token sampai kedaluwarsa | `src/auth/admin/admin-jwt.guard.ts` (hanya `tokens.verify`) |
| G10 | Console tidak punya konsep role/tema platform | `console/src/App.tsx` (semua route di bawah `ProtectedRoute` yang sama), `console/src/lib/session.ts` |

### 3.2 Dampak G8 (bug lintas tenant)

Karena `idempotencyKey` unik global dan lookup-nya tidak memakai tenant:

1. Tenant B mengirim `idempotency_key` yang sudah dipakai tenant A → ingest mengembalikan
   `202` dengan **notification id milik tenant A** dan tidak membuat notifikasi untuk tenant B
   (`created: false`). Request tenant B hilang, dan id tenant A bocor lewat response.
2. Pada request bersamaan, unique constraint global menghasilkan `P2002` dan jalur "race" yang
   sama; tetap tidak ada notifikasi untuk tenant B.

Ini harus diperbaiki bersamaan dengan desain multi-tenant karena menyangkut batas tenant.

### 3.3 Yang sudah baik (tidak diubah)

- Tenant tidak pernah diambil dari body; `tenant_id` di body deprecated dan harus sama.
- Tiga lane tidak menerima kredensial lane lain.
- Kunci unik data bisnis sudah tenant-scoped (`Subscriber`, `NotificationPreference`,
  `NotificationTemplate`, `Topic`, `TemplateTestSend`).
- Subscriber JWT ditandatangani secret per tenant (fallback env) dan keenam guard sudah menolak
  token dari lane lain.

## 4. Prinsip desain

1. **Kontrak yang sudah terbit tidak dipecahkan.** `@notifhub/js` 0.3.0 dan endpoint
   `/api/v1/admin/*` yang ada tetap kompatibel. Fitur platform memakai surface baru.
2. **Tenant tetap berasal dari kredensial.** Tidak ada endpoint yang menerima tenant dari body
   kecuali endpoint platform (yang memang lintas tenant dan diaudit).
3. **Perubahan aditif dan bisa di-rollback.** Migrasi hanya menambah tabel/kolom/constraint;
   tidak ada drop data.
4. **Empat lane, satu kredensial per lane.** Platform admin tidak boleh memakai lane tenant, dan
   sebaliknya.
5. **Default aman.** Tanpa env platform admin, sistem tetap berjalan seperti sekarang (tenant
   `default`); fitur platform tidak aktif sampai admin platform dibuat.
6. **Audit append-only.** Tidak ada endpoint update/delete audit; data sensitif tidak disimpan.
7. **Suspend adalah tindakan ingress.** Menahan request baru, bukan menghapus data atau membunuh
   job yang sudah berjalan.
8. **Tanpa dependency baru.** Semua memakai Prisma, NestJS, bcrypt, dan Throttler yang sudah ada.

## 5. Opsi dan keputusan

### 5.1 Opsi entitas tenant

| Opsi | Isi | Trade-off |
|---|---|---|
| **A (dipilih)** | Tabel `Tenant` + FK `onDelete: Restrict` dari semua tabel ber-`tenantId` | Integritas terjaga (tidak ada baris yatim, tenant tidak bisa dihapus saat masih punya data); migrasi menyentuh 14 relasi |
| B | Tabel `Tenant` tanpa FK (soft reference) | Migrasi ringan, tetapi baris yatim dan salah ketik `tenantId` tidak terdeteksi |
| C | Tetap string tanpa entitas (status quo) | Tidak ada tempat untuk status/nama/kebijakan tenant; offboarding tidak mungkin |

Opsi A dipilih karena tujuan utamanya justru lifecycle tenant; FK adalah pengaman terakhir bila
ada bug query.

### 5.2 Keputusan

| # | Keputusan | Usulan default |
|---|---|---|
| D1 | Entitas `Tenant` dengan `id` = slug immutable (pola `^[a-z0-9](?:[a-z0-9-]{0,62})$`) dan FK `Restrict` dari 14 tabel | Ya |
| D2 | Status tenant: `active` \| `suspended` (tanpa `archived` di v1) | Ya |
| D3 | Identitas platform admin: `AdminUser.tenantId` nullable; role `platform_admin` wajib `NULL`, `tenant_admin` wajib terisi (CHECK constraint) | Ya |
| D4 | Lane platform punya surface auth sendiri (`/api/v1/platform/auth/login` + `/me`); `/api/v1/admin/auth/*` tetap tenant-only dan menolak `platform_admin` | Ya |
| D5 | `PlatformAdminGuard` memverifikasi JWT **dan** status `active` admin di DB; tenant admin guard juga mengecek status admin + status tenant | Ya |
| D6 | API platform: list/create/get/patch tenant, `suspend`, `resume`, `delete` (hanya tenant kosong, `default` dilindungi) | Ya |
| D7 | API admin per tenant: list/create (password awal), patch (`password`, `active`), larang menonaktifkan admin aktif terakhir | Ya |
| D8 | **Suspend = ingress only**: request baru ditolak di ketiga lane; job yang sudah antre tetap diproses (termasuk push in-app); koneksi SSE yang sudah terbuka tidak diputus paksa | Ya |
| D9 | `allowedOrigins` ditegakkan di lane API key: bila daftar kosong → semua origin; bila terisi dan header `Origin` tidak cocok → `403 origin_not_allowed` | Ya |
| D10 | Audit platform append-only di tabel baru `PlatformAuditEvent` (tanpa FK ke `AdminUser`) | Ya |
| D11 | Bootstrap idempoten: pastikan tenant `DEFAULT_TENANT_ID` ada, upsert admin tenant + API key bootstrap, opsional upsert platform admin dari env | Ya |
| D12 | Email admin tetap unik global; satu akun = satu tenant (membership multi-tenant ditunda) | Ya |
| D13 | Kuota/rate limit per tenant ditunda; rate limit platform memakai Throttler (login 5/menit, mutasi 60/menit, baca 120/menit) | Ya |
| D14 | Console: rute platform terpisah (`/platform/*`), session terpisah, transport lokal memakai `HttpTransport` SDK (tanpa rilis SDK baru) | Ya |
| D15 | Hapus tenant hanya bila kosong (tanpa admin, API key, dan data bisnis); `default` tidak bisa dihapus, tetapi bisa di-suspend | Ya |
| D16 | Perbaiki idempotency: unique `(tenantId, idempotencyKey)` dan semua lookup memakai tenant | Ya |

Alasan singkat keputusan yang paling berisiko:

- **D3/D4** memisahkan platform dari tenant di level identitas, bukan hanya di level guard, sehingga
  bug otorisasi di satu endpoint tidak otomatis membuka data tenant. Mengubah
  `AdminUser.tenantId` menjadi nullable adalah perubahan schema yang paling murah untuk mencapai
  itu tanpa tabel akun baru.
- **D6** tidak menyediakan `DELETE` bebas: tenant dengan data harus di-suspend dulu; penghapusan
  permanen menunggu desain retensi/offboarding.
- **D8** menjaga perilaku job tetap deterministik dan menghindari satu query tenant tambahan per
  job (worker saat ini tidak membaca status tenant).
- **D16** adalah bug fix yang tidak bisa ditunda; membiarkannya berarti isolasi tenant belum benar.

## 6. Model data dan migrasi

### 6.1 Model baru

```prisma
enum TenantStatus {
  active
  suspended
}

model Tenant {
  id          String       @id // slug, immutable
  name        String
  status      TenantStatus @default(active)
  suspendedAt DateTime?    @db.Timestamptz
  createdAt   DateTime     @default(now()) @db.Timestamptz
  updatedAt   DateTime     @updatedAt @db.Timestamptz

  // relasi (ringkas; satu baris per model di §6.2)
  notifications   Notification[]
  subscribers     Subscriber[]
  apiKeys         ApiKey[]
  adminUsers      AdminUser[]
  // … model lain mengikuti daftar §6.2

  @@index([status])
  @@index([createdAt])
}
```

`id` menjadi primary key (bukan UUID terpisah) karena nilai itu sudah dipakai sebagai `tenantId` di
seluruh tabel; tidak ada kolom yang perlu di-backfill selain membuat baris `Tenant`-nya.

### 6.2 Daftar relasi FK yang ditambahkan

| Model | Field | Catatan |
|---|---|---|
| `Notification` | `tenantId` | Data utama notifikasi |
| `NotificationTemplate`, `TemplateLayout`, `TemplateTheme`, `TemplatePartial` | `tenantId` | Template + aset |
| `TemplateAuditEvent`, `TemplateTestSend`, `TemplateImage` | `tenantId` | Telemetri template |
| `NotificationPreference` | `tenantId` | Preferensi end-user |
| `BillingEvent` | `tenantId` | Event billing |
| `Subscriber`, `Topic` | `tenantId` | Penerima dan topik |
| `ApiKey`, `AdminUser` | `tenantId` | Auth (AdminUser nullable untuk platform) |

Model anak (`NotificationRecipient`, `DeliveryAttempt`, `DeliveryEvent`, `TopicSubscriber`,
`TemplatePartialLink`) tidak punya `tenantId`; tenant-nya diwarisi dari induk, jadi tidak perlu FK.

Semua relasi memakai `onDelete: Restrict`, `onUpdate: Cascade`.

### 6.3 Perubahan pada model yang ada

```prisma
model AdminUser {
  // …
  tenantId String?   // null = platform admin
  tenant   Tenant? @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  @@index([tenantId])
  @@index([role])
}

model Notification {
  // …
  // dihapus: idempotencyKey String @unique
  @@unique([tenantId, idempotencyKey])
  // …
}
```

Tambahan constraint di migrasi SQL (tidak dapat diekspresikan Prisma):

```sql
ALTER TABLE "AdminUser"
  ADD CONSTRAINT "AdminUser_role_tenant_check"
  CHECK (
    ("role" = 'platform_admin' AND "tenantId" IS NULL) OR
    ("role" = 'tenant_admin' AND "tenantId" IS NOT NULL)
  );
```

### 6.4 Langkah migrasi

1. `CREATE TYPE "TenantStatus" AS ENUM ('active', 'suspended');`
2. `CREATE TABLE "Tenant" (…)` + index `status`, `createdAt`.
3. Backfill tenant yang sudah ada. **Sumber union wajib mencakup semua tabel di §6.2**, kalau
   tidak FK di langkah 5 akan gagal. `updatedAt` wajib diisi karena kolomnya `NOT NULL` tanpa
   default, dan literal enum perlu cast:
   ```sql
   INSERT INTO "Tenant" ("id", "name", "status", "createdAt", "updatedAt")
   SELECT DISTINCT t."tenantId", t."tenantId", 'active'::"TenantStatus",
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
   FROM (
     SELECT "tenantId" FROM "Notification"
     UNION SELECT "tenantId" FROM "NotificationTemplate"
     UNION SELECT "tenantId" FROM "TemplateLayout"
     UNION SELECT "tenantId" FROM "TemplateTheme"
     UNION SELECT "tenantId" FROM "TemplatePartial"
     UNION SELECT "tenantId" FROM "TemplateAuditEvent"
     UNION SELECT "tenantId" FROM "TemplateTestSend"
     UNION SELECT "tenantId" FROM "TemplateImage"
     UNION SELECT "tenantId" FROM "NotificationPreference"
     UNION SELECT "tenantId" FROM "BillingEvent"
     UNION SELECT "tenantId" FROM "Subscriber"
     UNION SELECT "tenantId" FROM "Topic"
     UNION SELECT "tenantId" FROM "ApiKey"
     UNION SELECT "tenantId" FROM "AdminUser" WHERE "tenantId" IS NOT NULL
   ) AS t
   ON CONFLICT ("id") DO NOTHING;

   INSERT INTO "Tenant" ("id", "name", "status", "createdAt", "updatedAt")
   VALUES ('default', 'Default', 'active'::"TenantStatus", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
   ON CONFLICT ("id") DO NOTHING;
   ```
4. `ALTER TABLE "AdminUser" ALTER COLUMN "tenantId" DROP DEFAULT, ALTER COLUMN "tenantId" DROP NOT NULL;`
5. Tambahkan 14 FK `Restrict` (§6.2).
6. Ganti unique idempotency:
   ```sql
   DROP INDEX "Notification_idempotencyKey_key";
   CREATE UNIQUE INDEX "Notification_tenantId_idempotencyKey_key"
     ON "Notification" ("tenantId", "idempotencyKey");
   ```
7. Tambahkan CHECK constraint `AdminUser_role_tenant_check`. Baris `platform_admin` manual yang
   sudah ada **harus** memiliki `tenantId` NULL; bila tidak, constraint gagal dan migrasi berhenti
   (perbaiki datanya lalu ulangi). Aplikasi belum punya jalur untuk membuat baris seperti itu.

Dibuat dengan `npx prisma migrate diff`/`migrate deploy` (lingkungan non-interaktif tidak mendukung
`migrate dev`), lalu SQL backfill/CHECK disisipkan manual. Urutan penting: tabel `Tenant` + backfill
**sebelum** FK. Untuk database kosong, langkah 3 hanya membuat `default`.

**Rollback.** Turunkan migrasi berarti mengembalikan unique global `idempotencyKey`. Ini gagal bila
sudah ada dua tenant memakai key yang sama; dokumentasikan bahwa rollback memerlukan pembersihan
data idempotency. FK dan CHECK bisa di-drop tanpa kehilangan data.

### 6.5 Dampak ke seed dan test

- `prisma/seed.ts`: upsert `Tenant(DEFAULT_TENANT_ID)` sebelum template.
- `test/setup/database.ts`: `Tenant` ditambahkan ke daftar `TRUNCATE` (paling akhir).
- `test/setup/fixtures.ts`: membuat `Tenant` `default` + tenant B, template in-app tenant B, dan
  API key tenant B dengan raw key yang diketahui agar ingest lintas tenant bisa diuji.
- `test/env.ts`: env platform admin (`PLATFORM_ADMIN_EMAIL`/`PASSWORD_HASH`) untuk test (F2, §7.6).

## 7. Auth dan otorisasi

### 7.1 Empat lane

| Lane | Prefix | Kredensial | Guard | Principal |
|---|---|---|---|---|
| Ingest/konsumen | `/api/v1/notify`, `/api/v1/subscribers/*`, `/api/v1/topics/*` | `X-API-Key` | `ApiKeyGuard` | `{ apiKeyId, tenantId }` |
| Tenant admin | `/api/v1/admin/*` | admin JWT `tenant_admin` | `AdminJwtGuard` | `{ adminId, email, role, tenantId }` |
| Subscriber | `/api/v1/in-app/*`, `/api/v1/subscriber/*` | subscriber JWT per tenant | `SubscriberJwtGuard` | `{ recipientId, tenantId }` |
| **Platform** | `/api/v1/platform/*` | admin JWT `platform_admin` | `PlatformAdminGuard` | `{ adminId, email, role }` |

Aturan batas:

| Dari \ Ke | Tenant admin API | Platform API |
|---|---|---|
| `tenant_admin` | boleh | `403 role_not_allowed` |
| `platform_admin` | `403 role_not_allowed` | boleh |

`/admin/auth/login` tetap hanya untuk `tenant_admin`. `platform_admin` yang mencoba login di sana
mendapat `403 role_not_allowed` (bukan `401`, karena kredensial valid — konsisten dengan perilaku
`platform_admin` saat ini).

### 7.2 Klaim JWT

| Role | Klaim |
|---|---|
| `tenant_admin` | `sub`, `email`, `role`, `tenant`, `exp`, `iat` (tidak berubah) |
| `platform_admin` | `sub`, `email`, `role`, `exp`, `iat` — **tanpa** `tenant` |

`AdminTokenService.sign` menerima `tenantId?: string`; `verify` mengembalikan `tenantId?: string`.
`AdminJwtGuard` mewajibkan `role === tenant_admin` **dan** `tenantId` terisi.

### 7.3 Pengecekan status di guard

| Guard | Query tambahan | Penolakan |
|---|---|---|
| `ApiKeyGuard` | `ApiKey` + relasi `tenant.status` (satu query) | key nonaktif → `401`; tenant suspended → `403 tenant_suspended` |
| `AdminJwtGuard` | `AdminUser` (`active`) + `tenant.status` | admin nonaktif → `401`; tenant suspended → `403 tenant_suspended` |
| `PlatformAdminGuard` | `AdminUser` (`active`, `role`) | tidak aktif/salah role → `401`/`403` |
| `SubscriberJwtGuard` | lookup `Tenant` terpisah (satu query). Tidak cukup menempel ke baris `ApiKey`, karena tenant tanpa API key aktif tetap harus dicek | tenant suspended → `403 tenant_suspended` |

Catatan biaya: lane admin saat ini hanya verifikasi JWT (tanpa DB). Dengan D5, lane admin
menambah satu query per request — sama seperti lane subscriber yang sudah melakukannya (tercatat
di project-brief §6). Tidak memakai cache di v1 agar suspend langsung berlaku.

Pengecualian: `GET /metrics` memakai `ApiKeyGuard` tetapi bersifat service-level. Guard diberi
opsi `allowSuspendedTenant` yang dipakai `MetricsController`, agar suspend satu tenant tidak
mematikan monitoring.

### 7.4 Endpoint webhook

Webhook provider (`/api/v1/webhooks/*`) tidak memakai keempat lane di atas; autentikasinya tanda
tangan HMAC. Callback tetap diproses walau tenant sedang suspended, supaya status pengiriman yang
sudah terjadi tetap tercatat (§9).

### 7.5 Matriks endpoint × role

| Endpoint | Public | tenant_admin | platform_admin |
|---|---|---|---|
| `/api/v1/admin/auth/login` | ya | ya | `403` |
| `/api/v1/admin/*` lainnya | tidak | ya | `403` |
| `/api/v1/platform/auth/login` | ya | `403` | ya |
| `/api/v1/platform/*` lainnya | tidak | `403` | ya |
| `/health/*` | ya | — | — |
| `/metrics` | key | — | — |

### 7.6 Bootstrap platform admin

Env opsional baru:

| Variabel | Default | Catatan |
|---|---|---|
| `PLATFORM_ADMIN_EMAIL` | — | Email platform admin awal |
| `PLATFORM_ADMIN_PASSWORD_HASH` | — | Bcrypt (`$2…`); wajib berpasangan dengan email |

Aturan: keduanya harus diisi bersama (divalidasi `superRefine` seperti pasangan WhatsApp). Saat
startup, bila diisi: upsert `AdminUser` dengan `role = platform_admin`, `tenantId = NULL`,
`active = true`, dan perbarui hash bila env berubah (pola `AdminBootstrapService` yang ada). Bila
tidak diisi dan belum ada platform admin di DB, startup mencatat warning
`platform.admin.bootstrap.missing` — sistem tetap jalan, fitur platform tidak dapat dipakai sampai
admin platform dibuat (lewat env atau seed).

Konflik email: bila `PLATFORM_ADMIN_EMAIL` sudah dipakai `tenant_admin`, startup **gagal cepat**
dengan pesan yang menyebut email tersebut. Bootstrap tidak boleh diam-diam memindahkan admin tenant
menjadi platform admin.

### 7.7 Penegakan `allowedOrigins`

| Kondisi | Perilaku |
|---|---|
| `allowedOrigins = []` (default semua key yang ada) | Semua origin diizinkan (perilaku sekarang) |
| Daftar terisi, request tanpa header `Origin` (server-to-server) | Diizinkan |
| Daftar terisi, `Origin` cocok salah satu entri | Diizinkan |
| Daftar terisi, `Origin` tidak cocok | `403 origin_not_allowed` |

Aturan tambahan: pencocokan memakai string origin persis (skema + host + port, tanpa path);
penegakan hanya di `ApiKeyGuard` (lane consumer), bukan lane admin/subscriber; preflight `OPTIONS`
ditangani middleware CORS global sebelum guard sehingga tidak ikut ditolak. Perubahan hanya
berlaku untuk key yang memang sudah mengisi daftar, jadi key lama tidak berubah perilakunya.

## 8. API platform

Semua di bawah prefix global `api/v1`; error mengikuti bentuk error service yang sudah ada
(`statusCode`, `message`, `error`, `timestamp`, `path`, `requestId`). Rate limit (D13): login
5/menit/IP, mutasi 60/menit, baca 120/menit, memakai `ThrottlerGuard` seperti endpoint admin yang
sudah ada.

### 8.1 Auth

| Method | Path | Keterangan |
|---|---|---|
| `POST` | `/platform/auth/login` | Email + password, throttle 5/menit/IP, audit log login sukses/gagal (log, bukan tabel audit) |
| `GET` | `/platform/auth/me` | Profil platform admin aktif |

Contoh login:

```json
POST /api/v1/platform/auth/login
{ "email": "ops@notifhub.local", "password": "…" }

200 {
  "accessToken": "…",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "admin": { "id": "…", "email": "ops@notifhub.local", "role": "platform_admin" }
}
```

`tenantId` tidak dikirim (bukan `null`, bukan string kosong) karena bentuk ini adalah kontrak baru
yang tidak dipakai SDK terbit.

### 8.2 Tenant

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/platform/tenants?status=&q=&limit=&offset=` | List + `total`; `q` mencari `id`/`name` |
| `POST` | `/platform/tenants` | Body `{ id, name }`; `id` wajib, slug, immutable; `409 tenant_exists` |
| `GET` | `/platform/tenants/:id` | Detail + `adminCount`, `apiKeyCount` |
| `PATCH` | `/platform/tenants/:id` | Body `{ name }` |
| `POST` | `/platform/tenants/:id/suspend` | Idempoten; `200` + tenant |
| `POST` | `/platform/tenants/:id/resume` | Idempoten; `200` + tenant |
| `DELETE` | `/platform/tenants/:id` | `204` hanya bila tenant kosong; `409 tenant_not_empty`; `403 tenant_protected` untuk `DEFAULT_TENANT_ID` |

Bentuk response tenant:

```json
{
  "id": "acme",
  "name": "Acme Corp",
  "status": "active",
  "suspendedAt": null,
  "createdAt": "2026-11-19T12:00:00.000Z",
  "updatedAt": "2026-11-19T12:00:00.000Z",
  "adminCount": 2,
  "apiKeyCount": 1
}
```

Keputusan detail:

- `id` wajib diisi pemanggil (bukan generate dari `name`) agar API key/env tenant stabil dan tidak
  ada dua tenant dengan slug mirip. Pola: `^[a-z0-9](?:[a-z0-9-]{0,62})$`.
- `adminCount`/`apiKeyCount` dihitung dengan `_count` Prisma, bukan query terpisah.
- List tidak mengembalikan data bisnis apa pun (tidak ada jumlah notifikasi di v1).

### 8.3 Admin per tenant

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/platform/tenants/:id/admins` | List admin tenant (tanpa hash) |
| `POST` | `/platform/tenants/:id/admins` | Body `{ email, password }`; password ≥ 8; `409 admin_email_taken` |
| `PATCH` | `/platform/tenants/:id/admins/:adminId` | Body `{ password?, active? }`; `409 last_tenant_admin` bila menonaktifkan admin aktif terakhir |

Aturan: tidak boleh membuat/mengubah `platform_admin` lewat rute ini (`404`). Password awal
dibuatkan platform admin dan harus diserahkan lewat kanal aman; belum ada undangan email. Akun
platform admin sendiri **tidak** dikelola lewat API di v1 — hanya lewat bootstrap env (§7.6).

### 8.4 Audit

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/platform/audit?tenantId=&action=&from=&to=&limit=&offset=` | Append-only; urut `occurredAt` desc |

### 8.5 Kode error

| `message` | Status | Kapan |
|---|---|---|
| `invalid_tenant_id` | `400` | Slug tidak sesuai pola |
| `tenant_exists` | `409` | `POST` dengan id yang sudah ada |
| `tenant_not_found` | `404` | Tenant tidak ada |
| `tenant_suspended` | `403` | Request baru di lane tenant |
| `tenant_not_empty` | `409` | `DELETE` tenant yang masih punya admin/key/data |
| `tenant_protected` | `403` | `DELETE` tenant `DEFAULT_TENANT_ID` |
| `admin_email_taken` | `409` | Email admin sudah dipakai (global) |
| `last_tenant_admin` | `409` | Aksi menghabiskan admin aktif terakhir tenant |
| `role_not_allowed` | `403` | Role tidak berhak untuk grup endpoint |
| `origin_not_allowed` | `403` | `Origin` tidak ada di `ApiKey.allowedOrigins` |
| `invalid_credentials` | `401` | Login platform gagal |

## 9. Perilaku tenant suspended

| Kejadian | Perilaku |
|---|---|
| `POST /notify`, endpoint consumer lain | `403 tenant_suspended` |
| Login admin tenant | `403 tenant_suspended` (kredensial tidak diproses lebih lanjut) |
| Request admin tenant dengan token lama | `403 tenant_suspended` (guard cek DB) |
| In-app/SSE/preference center | `403 tenant_suspended` |
| Koneksi SSE yang sudah terbuka | Tetap hidup sampai klien memutus; tidak ada push untuk notifikasi baru (ingest ditolak), tetapi event dari job in-app yang sudah antre masih dapat terkirim |
| Job yang sudah di antre | **Tetap diproses** (drain); tidak ada pengecekan tenant di worker |
| Webhook provider | Tetap diproses dan dicatat |
| `resume` | Berlaku langsung pada request berikutnya; tidak perlu restart |
| Data | Tidak dihapus/diubah; `suspendedAt` diisi saat suspend, dikosongkan saat resume |

## 10. Audit platform

```prisma
model PlatformAuditEvent {
  id           BigInt   @id @default(autoincrement())
  actorAdminId String
  actorEmail   String
  action       String   // tenant.created, tenant.renamed, tenant.suspended, …
  tenantId     String?  // tenant yang terdampak (null untuk aksi non-tenant)
  targetType   String   // tenant | admin
  targetId     String
  metadata     Json?
  ip           String?
  requestId    String?
  occurredAt   DateTime @default(now()) @db.Timestamptz

  @@index([tenantId, occurredAt])
  @@index([actorAdminId, occurredAt])
  @@index([action, occurredAt])
}
```

- Tanpa FK ke `AdminUser`/`Tenant`: audit harus tetap terbaca walau admin atau tenant dihapus.
- `metadata` hanya berisi field yang berubah dan nilai non-rahasia; **tidak pernah** password,
  hash, API key mentah, atau isi pesan.
- Aksi yang dicatat: `tenant.created`, `tenant.renamed`, `tenant.suspended`, `tenant.resumed`,
  `tenant.deleted`, `tenant.admin.created`, `tenant.admin.updated`, `tenant.admin.deactivated`,
  `tenant.admin.password_reset`.
- Append-only: tidak ada endpoint update/delete. Retensi otomatis belum ada di v1 (kandidat).

## 11. Console

| Halaman | Route | Isi |
|---|---|---|
| Platform login | `/platform/login` | Form email/password → `POST /platform/auth/login`; simpan session terpisah |
| Daftar tenant | `/platform/tenants` | Tabel status/nama/adminCount/apiKeyCount, pencarian, filter status, tombol create |
| Detail tenant | `/platform/tenants/:id` | Info tenant, aksi suspend/resume/rename, daftar admin + create/reset password/deactivate |
| Audit | `/platform/audit` | Tabel audit dengan filter tenant/action/rentang tanggal |

Perubahan teknis:

- `console/src/lib/platformSession.ts`: `sessionStorage` key terpisah
  (`notifhub.console.platform-session`) dengan tipe `PlatformAdminProfile` lokal (tanpa
  `tenantId`).
- `console/src/lib/platformClient.ts`: `HttpTransport` dari `@notifhub/js` dengan base
  `/api/v1/platform` dan token platform — pola yang sama dengan
  `console/src/lib/adminResend.ts` (SDK terbit tidak diubah). **Sejak 2026-11-21:** pindah ke
  `NotifHubPlatformClient` di SDK dan file console dihapus; lihat
  `docs/design/console-sdk-consolidation.md`.
- `ProtectedRoute` menjadi role-aware: rute tenant butuh `tenant_admin`, rute platform butuh
  `platform_admin`; role yang salah diarahkan ke beranda role-nya, bukan sekadar `401`.
- `AppLayout` tetap untuk tenant; `PlatformLayout` memakai design system console yang sama
  (sidebar, topbar, lebar konten) dengan aksen teal, brand "P"/"Platform", dan bagian navigasi
  "Manage" — sengaja tidak identik agar operator bisa membedakan lane.
- Tidak ada tenant switcher/impersonation di v1.

## 12. Keamanan

- **Batas blast radius:** platform admin tidak punya endpoint untuk membaca notifikasi,
  subscriber, template, atau preferensi tenant. Hanya metadata dan hitungan.
- **Token:** platform JWT memakai `ADMIN_JWT_SECRET` dan HS256 dengan masa berlaku sama
  (`ADMIN_JWT_EXPIRES_IN`); tidak ada refresh token (batasan lama).
- **Rate limit:** login platform 5/menit/IP; mutasi 60/menit; baca 120/menit. Login tetap
  dibatasi walau akun valid untuk memperlambat brute force.
- **Password:** minimal 8 karakter pada pembuatan (sama dengan validasi login); hash bcrypt biaya
  10 seperti admin tenant. Tidak ada password default.
- **Audit:** tidak menyimpan rahasia; `requestId` dipakai untuk korelasi log.
- **Isolasi:** FK `Restrict` mencegah baris yatim; semua query admin tetap memakai `tenantId` dari
  token; e2e E7/E8 dipertahankan sebagai regresi.
- **Suspend bukan penghapusan:** data tetap ada; `DELETE` dibatasi agar tidak ada kehilangan data
  tak sengaja.
- **Env:** platform admin bootstrap memakai bcrypt hash di env, tidak pernah password mentah;
  `.env.example` hanya memuat placeholder.
- **Discoverability lane platform.** URL `/platform/login` tidak ditautkan dari login tenant. Ini
  **bukan** kontrol keamanan — endpoint tetap publik, terdokumentasi di Swagger, dan nama rutenya
  ada di bundel console — melainkan pengurangan eksposur dan kebingungan/phishing. Pemisahan
  console platform ke host/entry terpisah dicatat sebagai kandidat lanjutan.

## 13. Fase implementasi

| Fase | Isi | Verifikasi |
|---|---|---|
| **F1 (selesai)** | Schema `Tenant`, FK, CHECK, migrasi + backfill, seed, bootstrap tenant, perbaikan idempotency (D16) | `npm run test:e2e` (E1–E29 + E30 hijau), typecheck, unit |
| **F2 (selesai)** | Klaim JWT opsional, `PlatformAdminGuard`, endpoint platform auth, env bootstrap platform admin | `npm run test:unit` (28 test) + e2e E31 |
| **F3 (selesai)** | API tenant & admin, audit, suspend enforcement di tiga lane, `allowedOrigins` | e2e E32–E37 |
| **F4 (selesai)** | Console platform (login, tenant, admin, audit) | `console:typecheck`, `console:build`, verifikasi manual (SPA + API) |
| **F5 (selesai)** | Dokumentasi (dokumen ini → status terimplementasi, indeks, project-brief, overview, usage, configuration) + regresi penuh | `npm run ci`, `console:typecheck/build`, `sdk`/`react`/`go` test, `docs:check`, OpenAPI drift |

F1 sengaja tidak menambah endpoint: migrasi besar dan bug fix idempotency diverifikasi lebih dulu
terhadap suite yang ada.

## 14. Verifikasi dan regresi

### Skenario e2e baru

| # | Skenario | Ekspektasi |
|---|---|---|
| E30 | **Sudah ada (F1).** Idempotency key sama di dua tenant (regresi G8) | Dua notifikasi berbeda, masing-masing hanya terlihat pemiliknya |
| E31 | **Sudah ada (F2).** Platform login + `/platform/auth/me`, dan tiap lane menolak token lane lain | `200` + token tanpa `tenant`; tenant admin di platform `403`; platform admin di lane tenant `403`; password salah `401` |
| E32 | **Sudah ada (F3).** Platform admin membuat tenant + admin, lalu admin tenant login dan memakai datanya | `201`/`200`; data tenant baru tidak terlihat dari tenant `default` |
| E33 | **Sudah ada (F3).** Suspend tenant: ingest, subscriber, login tenant admin | `403 tenant_suspended`; platform tetap bisa; `resume` memulihkan |
| E34 | **Sudah ada (F3).** `allowedOrigins`: key dengan daftar origin | `403 origin_not_allowed` untuk origin lain; `200` untuk origin terdaftar; daftar kosong = semua |
| E35 | **Sudah ada (F3).** Audit: create/suspend/resume/admin dibuat | Baris audit muncul dengan actor, action, tenantId; filter bekerja |
| E36 | **Sudah ada (F3).** `DELETE` tenant: berisi data vs kosong vs `default` | `409 tenant_not_empty`, `204`, `403 tenant_protected` |
| E37 | **Sudah ada (F3).** Bootstrap ulang aplikasi (restart) | Tidak ada tenant/admin ganda; `default` tetap satu baris |

### Regresi yang wajib tetap hijau

- E1–E29 (`test/app.e2e-spec.ts`) tanpa perubahan perilaku yang tidak disengaja, plus E30–E37
  (idempotency, lane platform, provisioning, suspend, origins, audit, delete, bootstrap).
- `npm run test:unit`, `npm run ci`, `npm run console:typecheck`, `npm run console:build`.
- `npm run docs:check`.
- Verifikasi manual: `npm run verify:preferences` (backend hidup) dan alur console tenant.

### Verifikasi migrasi

1. Salin database development (`pg_dump`/restore) ke database uji.
2. `npx prisma migrate deploy` pada salinan; pastikan backfill membuat `Tenant` untuk semua
   `tenantId` yang ada dan tidak ada FK yang gagal.
3. Jalankan aplikasi pada salinan; login admin lama, ingest, dan in-app tetap bekerja.
4. Uji rollback di database uji (bukan development).

## 15. Daftar file

### Backend

| File | Perubahan |
|---|---|
| `prisma/schema.prisma` | `Tenant`, `TenantStatus`, FK, `AdminUser.tenantId` nullable + CHECK, unique idempotency komposit, `PlatformAuditEvent` |
| `prisma/migrations/<baru>_platform_tenants/migration.sql` | Tabel, backfill, FK, index, CHECK |
| `prisma/migrations/20261119210000_platform_audit/migration.sql` | Tabel `PlatformAuditEvent` + index |
| `prisma/seed.ts` | Upsert `Tenant(DEFAULT_TENANT_ID)` sebelum data lain |
| `src/config/env.schema.ts` | `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD_HASH` (opsional, berpasangan) |
| `.env.example`, `.env.prod.example` | Placeholder platform admin (kosong secara default) |
| `src/platform/` (baru) | Module, controller auth/tenant/admin/audit, service, DTO, konstanta |
| `src/common/decorators/allow-suspended-tenant.decorator.ts` (baru) | Pengecualian suspend untuk `/metrics` |
| `src/auth/admin/admin.types.ts`, `admin-token.service.ts`, `admin-jwt.guard.ts` | `tenantId` opsional, guard tenant cek DB + status tenant |
| `src/auth/admin/platform-admin.guard.ts` (baru) | Guard lane platform |
| `src/tenants/ensure-tenant.ts` (baru) | `ensureTenant()` idempoten, dipanggil bootstrap admin + API key sebelum menulis baris ber-tenant |
| `src/auth/admin/admin-bootstrap.service.ts` | Bootstrap tenant + platform admin opsional |
| `src/auth/api-key/api-key.service.ts`, `src/common/guards/api-key.guard.ts` | Select `tenant.status`, enforcement `allowedOrigins`, opsi `allowSuspendedTenant` |
| `src/auth/subscriber/subscriber-jwt.guard.ts` | Lookup `Tenant.status` sebelum verifikasi token |
| `src/admin/services/admin-auth.service.ts` | Tolak `platform_admin` di login tenant (`403 role_not_allowed`) |
| `src/admin/services/admin-notification-resend.service.ts` | Lookup idempotency memakai komposit tenant |
| `src/ingest/ingest.service.ts` | Lookup/race idempotency memakai `tenantId` + key |
| `src/metrics/metrics.controller.ts` | Guard dengan `allowSuspendedTenant` |
| `src/app.module.ts` | Daftarkan `PlatformModule` |

### Console

| File | Perubahan |
|---|---|
| `console/src/App.tsx` | Route `/platform/*` |
| `console/src/auth/PlatformLoginPage.tsx` (baru) | Login platform |
| `console/src/auth/ProtectedRoute.tsx` | Cek role untuk rute tenant vs platform |
| `console/src/layout/PlatformLayout.tsx` (baru) | Navigasi platform |
| `console/src/pages/platform/*.tsx` (baru) | Tenants, TenantDetail, Audit |
| `console/src/lib/platformSession.ts`, `platformClient.ts` (baru) | Session + transport lokal |

### Test dan dokumentasi

| File | Perubahan |
|---|---|
| `test/app.e2e-spec.ts` | E30 (F1), E31 (F2), E32–E37 (F3) |
| `test/setup/database.ts` | `Tenant` di daftar `TRUNCATE` |
| `test/setup/fixtures.ts` | Baris `Tenant` untuk `default` dan tenant B |
| `test/env.ts` | Env platform admin untuk test (sudah diisi di F2) |
| `test/platform-auth.unit-spec.ts` | Klaim token platform + matriks penolakan `PlatformAdminGuard` |
| `docs/design/multi-tenant-platform-admin.md` | Dokumen ini (status → terimplementasi saat selesai) |
| `docs/design/README.md`, `docs/README.md` | Indeks |
| `docs/architecture/project-brief.md` | §3 kapabilitas, §6 batasan, §7 kandidat |
| `docs/architecture/overview.md` | Lane keempat, route `/platform`, catatan suspend |
| `docs/design/admin-api.md` | Catatan bahwa D6 dilanjutkan lane platform |
| `docs/usage/admin-and-operations.md`, `docs/getting-started/configuration.md` | Platform admin + env baru |

## 16. Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Migrasi FK pada tabel besar mengunci tabel | Downtime singkat saat `migrate deploy` | Jalankan di jendela pemeliharaan; ukur pada salinan; migrasi aditif |
| Lane admin kini query DB per request | Latensi +1 query, beban DB naik | Query by primary key + index; pantau `pg_stat_statements`; cache 30 detik sebagai fallback (belum di v1) |
| `DELETE` tenant disalahgunakan | Kehilangan data | Hanya tenant kosong; `default` dilindungi; audit |
| Suspend tidak menghentikan job yang sudah antre | Pesan tetap terkirim setelah suspend | Didokumentasikan sebagai keputusan D8; opsi blokir per job dicatat sebagai kandidat |
| Platform admin disalahgunakan (membuat banyak tenant) | Biaya/abuse | Rate limit mutasi, audit, dan tidak ada endpoint yang membaca isi data tenant |
| Rollback idempotency tidak bersih | Duplikat key lintas tenant | Uji rollback di database salinan; dokumentasikan |
| Email admin global unik | Satu orang tidak bisa admin di dua tenant | Diterima di v1 (D12); membership ditunda |
| Hanya satu platform admin (bootstrap env) | Tidak ada jalur cadangan bila kredensial hilang | Dokumentasikan prosedur membuat platform admin kedua lewat env + prosedur pemulihan |
| Key lama sudah punya `allowedOrigins` tetapi belum pernah ditegakkan | Browser client bisa tiba-tiba ditolak `403` | Daftar kosong tetap "semua origin"; informasikan ke pemilik key sebelum rilis, dan log alasan penolakan |

## 17. Definition of done

- [x] Migrasi berhasil pada database development dan database test; backfill tenant benar.
- [x] Tenant `default` dan bootstrap admin/API key tetap berjalan setelah restart (idempoten).
- [x] `platform_admin` hanya bisa di lane platform; tenant admin hanya di lane tenant (e2e E31).
- [x] Suspend/resume berlaku di ingest, admin tenant, dan subscriber (e2e E33).
- [x] Idempotency per tenant teruji (e2e E30) dan tidak ada lookup idempotency tanpa tenant.
- [x] `allowedOrigins` ditegakkan (e2e E34).
- [x] Audit tercatat untuk semua mutasi platform dan bisa dibaca dengan filter (e2e E35).
- [x] `DELETE` tenant mengikuti aturan §8.2 (e2e E36).
- [x] E1–E29 tetap hijau; `npm run ci` dan `npm run docs:check` hijau.
- [x] Console platform lolos `typecheck`/`build` dan diverifikasi manual.
- [x] Dokumentasi diperbarui (indeks, project-brief, overview, usage, configuration).

## 18. Pertanyaan keputusan

Mohon persetujuan untuk poin berikut sebelum implementasi:

| # | Pertanyaan | Usulan |
|---|---|---|
| Q1 | Surface login platform: endpoint terpisah (`/platform/auth/login`, rekomendasi) atau satu endpoint admin yang mengembalikan role? | Terpisah, agar kontrak `/admin/auth/*` dan SDK terbit tidak berubah |
| Q2 | Bootstrap platform admin lewat env opsional (`PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD_HASH`) atau seed/script manual? | Env opsional + warning bila kosong |
| Q3 | Status tenant v1: `active`/`suspended` saja, atau tambah `archived`? | Dua status; archive menyusul |
| Q4 | Suspend: job yang sudah antre tetap diproses (rekomendasi) atau ikut ditahan? | Tetap diproses (ingress-only) |
| Q5 | `DELETE` tenant: hanya jika kosong (rekomendasi) atau sediakan purge berisiko? | Hanya tenant kosong |
| Q6 | Email admin tetap unik global (satu akun satu tenant) di v1? | Ya; membership multi-tenant ditunda |
| Q7 | Apakah platform admin boleh melihat hitungan data tenant (mis. jumlah notifikasi), atau metadata tenant saja? | `adminCount` + `apiKeyCount` saja |
| Q8 | Perbaikan idempotency (G8) dikerjakan di fase F1 bersama migrasi? | Ya — selesai di F1, teruji sebagai e2e E30 |
| Q9 | Retensi `PlatformAuditEvent`: tanpa cleanup di v1, atau ikut retensi 730 hari? | Tanpa cleanup v1; evaluasi setelah ada volume |
| Q10 | `ApiKey.allowedOrigins` kosong: tetap berarti "semua origin" (kompatibel dengan key lama) atau wajib diisi? | Kosong = semua origin; hanya key yang mengisi daftar yang ditegakkan |

Semua usulan di atas disetujui pada 2026-11-19 dan menjadi acuan F2–F5. Q8 sudah selesai di F1.

## 19. Catatan implementasi

### 19.1 F1 (2026-11-19)

Yang sudah berjalan:

- `Tenant` + `TenantStatus`, FK `Restrict` dari 14 model, CHECK `AdminUser_role_tenant_check`,
  unique `(tenantId, idempotencyKey)`, dan `AdminUser.tenantId` nullable tanpa default.
- Migrasi `20261119131500_platform_tenants`: enum + tabel, drop unique global, alter `AdminUser`,
  index/unique baru, backfill 14 tabel + `default`, 14 FK, lalu CHECK.
- `ensureTenant()` (`src/tenants/ensure-tenant.ts`) dipanggil bootstrap admin dan bootstrap API
  key; `prisma/seed.ts` membuat tenant sebelum template.
- Ingest (jalur normal dan jalur race) serta resend memakai lookup komposit
  `tenantId_idempotencyKey`.
- Test e2e E30 (idempotency lintas tenant). Fixture tenant B kini punya template in-app dan API
  key dengan raw key yang diketahui, sehingga ingest lintas tenant bisa diuji.
- Diverifikasi: `npm run typecheck`, `npm run test:unit` (22 test), `npm run test:e2e` (30 test),
  `npm run ci` (6 langkah), `npx prisma migrate deploy` pada `notifhub_dev` dan `notifhub_test`,
  serta `npx prisma db seed`.

Deviasi dan catatan:

1. **E6 berubah.** Sebelumnya `platform_admin` bisa login di lane tenant lalu ditolak `403` saat
   `/admin/auth/me`. Sekarang login tenant menolak akun tanpa tenant (`403`), sesuai §7.1.
2. **Nomor e2e.** Suite sudah memakai E21–E29 untuk fitur template, jadi skenario platform
   bergeser ke E31–E37 dan idempotency mendapat nomor E30.
3. **`migrate dev` tidak tersedia** di shell non-interaktif. Migrasi dibuat dengan
   `prisma migrate diff` lalu diterapkan dengan `migrate deploy`; SQL hasil generate diedit untuk
   cast `'active'::"TenantStatus"`, kolom `updatedAt`, backfill, dan CHECK.
4. **Database test lama** berisi baris `platform_admin` manual dengan `tenantId` terisi, sehingga
   CHECK membuat `migrate deploy` gagal. Database test dibuat ulang (data uji, bukan data bisnis).
   Di environment lain, bersihkan baris semacam itu sebelum migrasi.
5. **Bootstrap API key** juga memanggil `ensureTenant`; tanpa itu `ApiKey` gagal FK pada database
   kosong.
6. **`tenant_id` di body** tetap deprecated dan tidak berubah; provisioning tenant baru ada di F3.
7. **`admin-api.md` D6 belum diubah.** `platform_admin` tetap ditolak di lane tenant; lane platform
   (auth) ditambahkan di F2 dan tidak mengubah kontrak `/admin/*`.

Belum dikerjakan (F3–F5): provisioning tenant, suspend enforcement, audit, `allowedOrigins`, dan
console platform.

### 19.2 F2 (2026-11-19)

Yang sudah berjalan:

- `AdminTokenService` menandatangani token tanpa klaim `tenant` untuk platform admin; `verify`
  mengembalikan `tenantId` opsional (`AdminTokenClaims`). `AdminJwtGuard` membangun principal
  tenant dan menolak token tanpa tenant.
- `PlatformAdminGuard` baru: token harus `platform_admin`, akun harus `active` dan masih
  `platform_admin` dengan `tenantId = NULL` di database (token yang sudah terbit tidak cukup).
- `src/platform/` (baru): `PlatformModule`, `PlatformAuthController`
  (`POST /platform/auth/login`, `GET /platform/auth/me`), `PlatformAuthService`, DTO profil
  platform (tanpa `tenantId`), dan decorator `CurrentPlatformAdmin`.
- Login platform memakai Throttler 5/menit/IP dan pesan error yang sama dengan lane tenant
  (`invalid_credentials`, `401`).
- Env opsional `PLATFORM_ADMIN_EMAIL` + `PLATFORM_ADMIN_PASSWORD_HASH` (harus berpasangan).
  Bootstrap membuat/memperbarui platform admin dari env; bila env kosong dan belum ada platform
  admin, startup hanya mencatat `platform.admin.bootstrap.missing`. Email yang sudah dipakai
  tenant admin membuat startup **gagal cepat**.
- Kontrak `/admin/auth/*` dan `AdminProfileDto` tidak berubah; SDK terbit tidak tersentuh.

Verifikasi:

- `npm run typecheck`; `npm run test:unit` (28 test, termasuk 6 test baru untuk klaim token dan
  guard); `npm run test:e2e` (31 test, E31 baru); `npm run ci`.
- E31 membuktikan: token platform tidak membawa `tenant`; `/platform/auth/me` `200`; token tenant
  di lane platform `403`; token platform di lane tenant `403`; password salah `401`; kredensial
  tenant admin di login platform `403`.

Catatan:

- E6 tidak lagi membuat baris `platform_admin` manual (bootstrap yang membuatnya), sehingga tidak
  ada bentrok email.
- `admin-api.md` D6 tetap historis; lane tenant masih menolak `platform_admin`, hanya saja akun
  platform sekarang punya jalan masuk sendiri lewat `/platform/auth/login`.

### 19.3 F3 (2026-11-19)

Yang sudah berjalan:

- API tenant: `GET/POST /platform/tenants`, `GET/PATCH /platform/tenants/:id`,
  `POST .../suspend`, `POST .../resume`, `DELETE .../:id` (hanya tenant kosong; `default`
  dilindungi), plus `GET/POST .../:id/admins` dan `PATCH .../:id/admins/:adminId`.
- Model `PlatformAuditEvent` (append-only, tanpa FK) + migrasi `20261119210000_platform_audit`;
  `GET /platform/audit` dengan filter `tenantId`, `action`, `from`, `to`, limit/offset.
- Suspend ditegakkan di tiga lane:
  - `ApiKeyGuard` membaca `tenant.status` pada query API key yang sama; `403 tenant_suspended`,
    dengan pengecualian `@AllowSuspendedTenant()` untuk `/metrics`;
  - `AdminJwtGuard` kini mengecek DB setiap request: akun aktif, role/tenant token cocok dengan
    akun, dan tenant aktif (`403 tenant_suspended`);
  - login admin tenant menolak tenant suspended (`403 tenant_suspended`);
  - `SubscriberJwtGuard` mengecek status tenant setelah verifikasi token (`403 tenant_suspended`);
  - webhook provider tetap diproses, job yang sudah antre tetap jalan (sesuai D8).
- `allowedOrigins` ditegakkan di `ApiKeyGuard`: daftar kosong = semua origin; `Origin` yang tidak
  cocok → `403 origin_not_allowed`; request tanpa `Origin` diizinkan.
- Tenant admin dibuat dengan password awal (bcrypt 10); menonaktifkan admin aktif terakhir
  ditolak `409 last_tenant_admin`; akun platform admin tidak bisa dikelola lewat rute ini (`404`).

Verifikasi:

- `npm run typecheck`; `npm run test:unit` (28 test); `npm run test:e2e` (**37 test**: E32–E37
  baru); `npm run ci`; `npm run docs:check`.
- E32 membuktikan provisioning + isolasi; E33 suspend/resume di tiga lane; E34 origin allowlist;
  E35 audit + filter; E36 aturan delete; E37 bootstrap idempoten.

Deviasi dan catatan:

1. **Audit bersifat best-effort.** Kegagalan menulis `PlatformAuditEvent` hanya di-log
   (`platform.audit.failed`) agar mutasi yang sudah terjadi tidak dilaporkan gagal. Bila kelak
   audit harus atomik, bungkus mutasi + audit dalam satu transaksi.
2. **Delete tenant** memakai pre-check hitungan di 14 tabel lalu fallback ke FK violation
   (`P2003 → 409 tenant_not_empty`), sehingga balapan dengan penulisan baru tetap aman.
3. **`E37` bukan restart proses**, melainkan memanggil ulang `AdminBootstrapService.onApplicationBootstrap()`
   dan memastikan jumlah tenant/admin tidak berubah.
4. **`/metrics`** tetap dapat diakses dengan API key milik tenant suspended (pengecualian sadar
   agar monitoring tidak ikut mati); endpoint bisnis tetap `403`.
5. **Snapshot tenant** (`adminCount`, `apiKeyCount`) memakai `_count`; jumlah notifikasi tidak
   diekspos di v1 sesuai Q7.

Belum dikerjakan: pembaruan dokumentasi akhir dan regresi penuh (F5).

### 19.4 F4 (2026-11-19)

Yang sudah berjalan (console React di `console/`):

- `/platform/login` memakai `POST /platform/auth/login`; session disimpan terpisah di
  `sessionStorage` (`notifhub.console.platform-session`) dengan profil platform tanpa `tenantId`.
  Login tenant **tidak** menautkan ke lane platform; `/platform/login` dibuka oleh operator yang
  mengetahui URL-nya (didokumentasikan), untuk mengurangi eksposur. Login platform tetap
  menautkan kembali ke login tenant.
- Rute `/platform/*` dilindungi `PlatformProtectedRoute` (butuh role `platform_admin`); rute tenant
  memakai `ProtectedRoute` yang mengarahkan platform admin ke `/platform/tenants`. Handler 401
  global membedakan jalur `/platform` (hapus session platform, arahkan ke `/platform/login`).
- Halaman:
  - `/platform/tenants`: daftar + filter status/pencarian + pagination, form buat tenant, aksi
    suspend (dengan konfirmasi) / resume, tautan detail.
  - `/platform/tenants/:id`: info & status tenant, ubah nama, suspend/resume, daftar admin tenant
    (tambah, reset password, aktif/nonaktif), dan zona hapus tenant (nonaktif bila masih ada data).
  - `/platform/audit`: filter tenant/aksi/rentang tanggal + pagination.
- Transport memakai `HttpTransport` dari `@notifhub/js` dengan `auth: false` untuk login; SDK
  terbit tidak diubah (pola yang sama dengan `console/src/lib/adminResend.ts`).
- Tidak ada tenant switcher/impersonation, sesuai §2.

Verifikasi:

- `npm run console:typecheck` dan `npm run console:build` lulus.
- Verifikasi manual (tanpa browser automation): backend dijalankan dengan
  `PLATFORM_ADMIN_EMAIL`/`PASSWORD_HASH`, lalu alur API dijalankan — login platform, list tenant,
  buat tenant `manual-check`, suspend, resume, hapus (204), dan audit menampilkan empat aksi.
  `vite preview` menyajikan `/` dan `/platform/tenants` dengan `200`.
- Backend/e2e tidak berubah di F4; suite E1–E37 tetap hijau dari F3.

Catatan:

1. **Tanpa browser automation.** Interaksi visual (klik dialog, validasi form) belum diotomasi;
   verifikasi UI masih manual, sama seperti batasan console yang sudah ada.
2. **Tidak ada rilis SDK.** `@notifhub/js` tetap `0.3.0`; pemindahan method platform ke SDK
   dijadwalkan pada rilis minor berikutnya.
3. **Bahasa UI** mengikuti console yang ada: label navigasi Inggris (Tenants/Audit), pesan bantuan
   dan konfirmasi Bahasa Indonesia.

### 19.5 F5 (2026-11-19)

Dokumentasi yang ditambahkan/diperbarui:

- `docs/usage/platform-admin.md` (baru): panduan operator platform — login/sesi, bootstrap akun,
  siklus tenant, admin tenant, efek suspend, audit, kode error, batasan v1.
- `docs/usage/README.md`: tabel peran + lane autentikasi menjadi **empat** lane (platform).
- `docs/getting-started/local-setup.md`: bagian "Verify the platform lane" (login, tenant,
  admin tenant, suspend/resume, audit, delete) + entri daftar isi.
- `docs/getting-started/troubleshooting.md`: baris `tenant_suspended`, `origin_not_allowed`, dan
  login platform `403`.
- `README.md`, `docs/README.md`, `docs/design/README.md`, `docs/architecture/overview.md`,
  `docs/architecture/project-brief.md`, `docs/design/admin-api.md`, `docs/design/react-and-console.md`:
  status, tautan, dan lane platform.
- **Tautan "Login platform admin" di halaman login tenant dihapus** setelah review: endpoint tetap
  publik (Swagger) dan nama rute ada di bundel, jadi ini bukan kontrol keamanan; tujuannya
  mengurangi eksposur/phishing. Lihat §12 dan §19.4.

Regresi penuh:

| Pemeriksaan | Hasil |
|---|---|
| `npm run ci` (typecheck, build, unit, e2e, migrate status) | lulus, 6 langkah (86s) |
| `npm run test:unit` / `test:e2e` | 28 / 37 test lulus |
| `npm run console:typecheck` + `console:build` | lulus |
| `npm run sdk:typecheck` + `sdk:test` | lulus, 23 test |
| `npm run react:typecheck` + `react:test` | lulus, 4 test |
| `npm run sdk:go:test` | lulus |
| `npm run docs:check` | 401 tautan/anchor di 36 file |
| `npm run openapi:export` + `git diff --exit-code openapi/notifhub.json` | tidak ada drift (3 path, 9 schema) |

Kandidat lanjutan (di luar v1): RBAC granular (`platform_readonly`), pengelolaan akun platform
admin lewat API/console, pemisahan console platform ke host terpisah, kuota/rate limit per tenant,
dan retensi `PlatformAuditEvent`.

### 19.6 UI platform (2026-11-19)

- UI tidak lagi memakai navbar Bootstrap mentah. `PlatformLayout` memakai design system console
  tenant (sidebar yang bisa diciutkan, topbar, lebar konten, kartu, tabel) dengan identitas
  platform: aksen teal `#0f766e`, brand mark `P`, sub-label `PLATFORM`, bagian navigasi `Manage`,
  dan crumb `Platform / <halaman>`.
- Login platform memakai kartu login yang sama dengan aksen teal; tautan dari login tenant tetap
  tidak ada (lihat §12).
- Form pembuatan admin/reset password memakai `autoComplete="off"`/`new-password` agar password
  manager tidak mengisi form tersebut.
- Verifikasi visual: `console:typecheck` dan `console:build` lulus; screenshot headless Edge
  (Chromium) diambil untuk `/platform/login`, `/platform/tenants`, `/platform/tenants/acme`, dan
  `/platform/audit` dengan session platform disuntikkan lewat CDP. Tidak ada browser automation
  yang ditambahkan ke repo.
- Tidak ada perubahan API maupun perilaku; ini murni presentasi.

