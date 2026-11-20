# Operasi console P2: export, resend all, audit, compose

Status: **P2a–P2c terimplementasi dan terverifikasi** (2026-11-20). Lihat §13–§15.
Basis: `docs/design/console-needs-analysis.md` §11.1, `docs/design/console-admin-hardening.md`,
`docs/design/admin-api.md`, `src/admin`, `src/ingest`, `prisma/schema.prisma`, dan `console/src`.

**Isi dokumen**

- [1. Latar belakang](#1-latar-belakang)
- [2. Ruang lingkup dan fase](#2-ruang-lingkup-dan-fase)
- [3. Export CSV](#3-export-csv)
- [4. Resend all](#4-resend-all)
- [5. Audit aksi admin tenant](#5-audit-aksi-admin-tenant)
- [6. Compose/send dari console](#6-composesend-dari-console)
- [7. Perubahan schema](#7-perubahan-schema)
- [8. Daftar file](#8-daftar-file)
- [9. Verifikasi](#9-verifikasi)
- [10. Keputusan](#10-keputusan)
- [11. Risiko dan batasan](#11-risiko-dan-batasan)
- [12. Pertanyaan persetujuan](#12-pertanyaan-persetujuan)
- [13. Catatan implementasi P2a](#13-catatan-implementasi-p2a)
- [14. Catatan implementasi P2b](#14-catatan-implementasi-p2b)
- [15. Catatan implementasi P2c](#15-catatan-implementasi-p2c)

---

## 1. Latar belakang

Hardening P1 menutup gap password, secret API key, search, dan CSP. Sisa gap operasional console
yang tercatat di `docs/design/console-needs-analysis.md` §11.1:

1. **Export CSV** — belum ada cara mengambil data notifikasi untuk analisis/laporan.
2. **Resend all** — hanya pasangan recipient/channel yang `failed` yang bisa dikirim ulang.
3. **Audit aksi admin tenant** — hanya log terstruktur; tidak ada jejak yang bisa dibaca operator.
4. **Compose/send** — admin masih bergantung pada consumer/API/curl untuk mengirim notifikasi baru.

Pekerjaan ini menutup keempatnya secara bertahap tanpa menambah dependency baru dan tanpa mengubah
kontrak ingest publik.

## 2. Ruang lingkup dan fase

| Fase | Isi | Schema | Risiko |
|---|---|---|---|
| **P2a** | Export CSV notifikasi + resend all | tidak | rendah |
| **P2b** | Tabel `AdminAuditEvent`, hook audit, API + halaman Audit | migrasi baru | sedang |
| **P2c** | Compose/send dari console | tidak | sedang–tinggi (operasi tulis) |

Urutan eksekusi: P2a → P2b → P2c. Setiap fase punya commit dan verifikasi sendiri; P2b/P2c tidak
dimulai sebelum fase sebelumnya hijau.

Tidak termasuk:

- Preview template saat compose, penjadwalan (`scheduled_at`), atau pengiriman massal dari file.
- Retensi/cleanup `AdminAuditEvent` di P2 (dicatat sebagai batasan; kandidat P3).
- RBAC granular; semua tenant admin yang aktif boleh melakukan aksi.
- Export biner (XLSX/PDF) atau streaming baris dalam jumlah tak terbatas.
- Browser automation permanen (tetap verifikasi manual/protokol).

## 3. Export CSV

### 3.1 Kontrak

```http
GET /api/v1/admin/notifications/export?status=&templateKey=&from=&to=&search=&limit=5000
Authorization: Bearer <admin JWT>
```

Response `200 application/json`:

```json
{
  "items": [
    {
      "id": "uuid",
      "createdAt": "2026-11-20T12:00:00.000Z",
      "templateKey": "order.shipped",
      "overallStatus": "sent",
      "targetType": "recipients",
      "priority": 3,
      "recipientCount": 10,
      "sentCount": 9,
      "failedCount": 1,
      "pendingCount": 0,
      "skippedCount": 0
    }
  ],
  "total": 1,
  "limit": 5000,
  "truncated": false
}
```

- Filter sama dengan `GET /admin/notifications`.
- `limit` default/max **5.000**; `total` adalah jumlah baris yang cocok, `truncated` true bila
  `total > items.length`.
- Tenant selalu dari JWT; tidak ada `tenant_id` di query.
- Ditolak `400` bila `limit` di luar 1–5.000.
- Route `export` didaftarkan **sebelum** `:id` agar tidak dianggap UUID.

### 3.2 CSV di console

Backend mengembalikan JSON (bukan streaming) agar tidak perlu mengubah `HttpTransport` SDK.
Console:

- memakai wrapper lokal `adminExport.ts` dengan `HttpTransport` (pola yang sama dengan
  `adminResend.ts`);
- membuat CSV di browser dari item;
- header: `id,created_at,template_key,status,target_type,priority,recipient_count,sent_count,failed_count,pending_count,skipped_count`;
- setiap cell di-escape: bungkus dengan kutip ganda, gandakan kutip di dalam, dan prefix `'` bila
  nilai diawali `=`, `+`, `-`, `@`, tab, atau CR (mitigasi CSV formula injection);
- unduh `notifhub-notifications-YYYYMMDD-HHmm.csv` (UTF-8 tanpa BOM);
- tombol **Export CSV** di header Notifications, memakai filter/search aktif, disabled saat
  memuat, error ditampilkan sebagai alert;
- bila `truncated`, tampilkan peringatan “hanya 5.000 baris pertama; persempit filter”.

### 3.3 Alternatif yang ditolak

- **Streaming CSV dari server:** lebih scalable, tetapi membutuhkan respons non-JSON dan
  penanganan transport baru di SDK/console; ditunda sampai ada kebutuhan volume besar.
- **Export di client dari list 20/100 baris:** tidak menjawab kebutuhan laporan.

## 4. Resend all

### 4.1 Kontrak

`POST /api/v1/admin/notifications/:id/resend` diperluas:

```json
{
  "mode": "all",
  "requestKey": "uuid"
}
```

- `mode`: `failed` (default) atau `all`.
- `failed`: hanya baris `failed` non-`sms` (perilaku sekarang).
- `all`: semua baris non-`sms` (termasuk `sent`, `failed`, `skipped`).
- Tetap membuat notification baru dengan `resendOfNotificationId`/`resendMode`, tanpa
  `BillingEvent` baru.
- `409` bila tidak ada baris yang memenuhi mode.
- `requestKey` yang sama untuk mode berbeda tetap `409` (key terikat pada original + requestKey).
- Response memuat `mode: "failed" | "all"`.

### 4.2 UI

- Tombol utama tetap **Kirim ulang yang gagal (N)**.
- Tombol sekunder **Kirim ulang semua (M)** dengan `ConfirmDialog`:
  - jumlah recipient/channel,
  - peringatan bahwa penerima yang sudah sukses akan menerima lagi,
  - peringatan template/preferensi/override (teks yang sama dengan failed-only).
- Setelah sukses: link ke notification baru, invalidate list/detail/dashboard.
- Mode `all` tidak tersedia bila tidak ada baris non-`sms`.

### 4.3 Verifikasi

- Notification dengan satu baris `sent` dan satu `failed`:
  - mode `failed` → hanya `failed`;
  - mode `all` → keduanya; `sms` tidak ikut;
  - replay `requestKey` tidak membuat notification baru;
  - tidak ada `BillingEvent` baru.
- Tenant lain → `404`.

## 5. Audit aksi admin tenant

### 5.1 Tabel

```prisma
model AdminAuditEvent {
  id           BigInt   @id @default(autoincrement())
  tenantId     String
  actorAdminId String
  actorEmail   String
  action       String
  targetType   String
  targetId     String
  metadata     Json?
  ip           String?
  requestId    String?
  occurredAt   DateTime @default(now()) @db.Timestamptz

  @@index([tenantId, occurredAt])
  @@index([tenantId, action, occurredAt])
  @@index([actorAdminId, occurredAt])
}
```

- Append-only; tanpa FK agar entri tetap terbaca setelah tenant/admin dihapus.
- Tidak pernah menyimpan password, hash, API key, token, atau isi pesan.
- `tenantId` wajib (selalu dari JWT).

### 5.2 Aksi yang dicatat (P2)

| Area | Action |
|---|---|
| Auth | `admin.password.changed` |
| API key | `admin.api_key.created`, `admin.api_key.revoked` |
| Template | `admin.template.created`, `updated`, `published`, `activated`, `cloned`, `rolled_back`, `deactivated` |
| Subscriber | `admin.subscriber.preferences_updated` |
| Topic | `admin.topic.membership_added`, `membership_replaced` |
| Notification | `admin.notification.resend`, `admin.notification.composed` |

Login/logout tidak dicatat di tabel ini (sudah ada log auth); export tidak dicatat agar tidak
membanjiri audit.

### 5.3 Penulisan

- `AdminAuditService.record()` best-effort: kegagalan insert dicatat ke log tetapi **tidak**
  menggagalkan mutasi (pola `PlatformAuditService`).
- Setiap service mutasi memanggil `record` setelah mutasi berhasil, dengan `actor` dari
  `AdminPrincipal`, `targetType/targetId`, metadata minimal (mis. nama key, versi template,
  channel), `ip`/`requestId` dari request context.
- Tidak memakai interceptor generik: menghindari kebocoran body/secret dan metadata yang tidak
  bermakna.

### 5.4 API dan UI

```http
GET /api/v1/admin/audit?action=&from=&to=&limit=50&offset=0
Authorization: Bearer <admin JWT>
```

- Response `{ items, total, limit, offset }`; item memuat waktu, actor email, action, target,
  metadata, IP (boleh null), requestId.
- Hanya event tenant dari JWT.
- Halaman `/audit`: tabel waktu/actor/action/target, filter action + rentang tanggal, pagination,
  `RefreshControl`; metadata JSON ditampilkan ringkas/expandable.
- Navigasi sidebar bagian **Operations**.

### 5.5 Batasan

- Belum ada retensi otomatis; tabel tumbuh. Kandidat P3: `ADMIN_AUDIT_RETENTION_DAYS` + job cleanup.
- Aksi yang tidak dicatat eksplisit tidak muncul; daftar di §5.2 adalah kontrak P2.
- Tidak ada export audit di P2.

## 6. Compose/send dari console

### 6.1 Kontrak

```http
POST /api/v1/admin/notifications
Authorization: Bearer <admin JWT>
Content-Type: application/json

{
  "requestKey": "uuid",
  "templateKey": "order.shipped",
  "recipients": ["user-1", "user-2"],
  "channels": ["inapp", "email"],
  "data": { "nama": "Budi" },
  "priority": "normal"
}
```

- `recipients` **atau** `topics` (salah satu/keduanya, seperti ingest); maksimum 1.000 recipient.
- `channels`: subset `inapp|email|whatsapp`, minimal satu, unik.
- `data`: objek JSON; batas payload mengikuti `INGEST_MAX_PAYLOAD_BYTES`.
- `priority`: `low|normal|high` (default normal).
- `requestKey` menjadi idempotency key; replay mengembalikan notification yang sama.
- Tenant selalu dari JWT; `tenant_id` di body ditolak/diabaikan (tidak diterima DTO).
- Response `202 { notification_id }`.
- Rate limit: 30 request/menit per admin/IP (throttle terpisah dari ingest).
- Audit `admin.notification.composed`; `BillingEvent` dibuat seperti notifikasi biasa (bukan
  resend).

### 6.2 Implementasi

- `ComposeNotificationDto` baru; validasi kelas.
- `AdminNotificationsComposeService` memanggil `IngestService.enqueue()` dengan DTO yang sudah
  dipetakan (`idempotency_key = requestKey`, tenant dari admin). `IngestModule` mengekspor
  `IngestService` (saat ini belum).
- `IngestService.enqueue` tetap satu-satunya jalur persist/queue; tidak ada duplikasi dispatch.
- `AdminModule` mengimpor `IngestModule`; tidak ada perubahan lane auth.

### 6.3 UI

- Route `/notifications/new` (di dalam `ProtectedRoute`), tombol **Kirim notifikasi** di halaman
  Notifications.
- Form:
  - pilih template aktif (list template aktif, maks 100) atau input key manual,
  - recipient IDs (textarea, pisahkan koma/baris baru) **atau** topics,
  - channel checkbox,
  - data JSON (textarea, validasi JSON saat submit),
  - priority select.
- Submit membuat `requestKey = crypto.randomUUID()`; tombol disabled saat pending; sukses
  menampilkan link ke detail notification baru; error `describeError`.
- Tidak ada preview template atau penjadwalan di P2.

### 6.4 Batasan

- Semua tenant admin dapat mengirim; belum ada RBAC/approval.
- Recipient harus sudah ada atau akan dibuat sesuai perilaku ingest; inline override recipient
  tidak disediakan di form (API tetap mendukung).
- Tidak ada template variable helper; data JSON diisi manual.

## 7. Perubahan schema

| Perubahan | Detail |
|---|---|
| Tabel baru | `AdminAuditEvent` (P2b) |
| Migrasi | `2026..._admin_audit_event` dengan CREATE TABLE + index |
| Backfill | Tidak ada; tabel mulai kosong |
| Rollback | Tabel additive; drop manual jika perlu |

Tidak ada perubahan pada `Notification`, `ApiKey`, atau template.

## 8. Daftar file

### P2a — export + resend all

| File | Perubahan |
|---|---|
| `src/admin/dto/export-notifications.dto.ts` (baru) | Query `limit` 1–5.000 |
| `src/admin/controllers/admin-notifications.controller.ts` | `GET /admin/notifications/export`, route sebelum `:id` |
| `src/admin/services/admin-notifications.service.ts` | `export()` dengan filter yang sama |
| `src/admin/dto/resend-notification.dto.ts` | `mode: 'failed' \| 'all'` |
| `src/admin/services/admin-notification-resend.service.ts` | Pemilihan baris untuk mode `all`, response |
| `console/src/lib/adminExport.ts` (baru) | Wrapper `HttpTransport` + builder CSV |
| `console/src/pages/NotificationsPage.tsx` | Tombol Export CSV |
| `console/src/components/ResendAllDialog.tsx` (baru) | Konfirmasi resend all |
| `console/src/pages/NotificationDetailPage.tsx` | Tombol resend all |
| `test/app.e2e-spec.ts` | E41 export, E42 resend all |

### P2b — audit

| File | Perubahan |
|---|---|
| `prisma/schema.prisma` | `AdminAuditEvent` |
| `prisma/migrations/<timestamp>_admin_audit_event/` | Tabel + index |
| `src/admin/services/admin-audit.service.ts` (baru) | Record + list, best-effort |
| `src/admin/controllers/admin-audit.controller.ts` (baru) | `GET /admin/audit` |
| `src/admin/dto/admin-audit.dto.ts` (baru) | Query/response |
| `src/admin/admin.module.ts` | Provider/controller |
| Service mutasi (API key, template, subscriber, topic, auth, resend, compose) | Panggil `record` |
| `console/src/pages/AuditPage.tsx` (baru), `App.tsx`, `AppLayout.tsx` | Halaman + nav |
| `console/src/lib/adminAudit.ts` (baru) | Wrapper/list |
| `test/app.e2e-spec.ts` | E43 audit + isolasi |

### P2c — compose

| File | Perubahan |
|---|---|
| `src/ingest/ingest.module.ts` | Ekspor `IngestService` |
| `src/admin/dto/compose-notification.dto.ts` (baru) | Validasi compose |
| `src/admin/services/admin-notification-compose.service.ts` (baru) | Panggil `IngestService.enqueue`, audit |
| `src/admin/controllers/admin-notifications.controller.ts` | `POST /admin/notifications` |
| `src/admin/admin.module.ts` | Import `IngestModule`, provider |
| `console/src/pages/ComposeNotificationPage.tsx` (baru) | Form |
| `console/src/lib/adminCompose.ts` (baru) | Wrapper |
| `console/src/App.tsx`, `NotificationsPage.tsx` | Route + tombol |
| `test/app.e2e-spec.ts` | E44 compose + idempotency + isolasi |

## 9. Verifikasi

- P2a: E41 memastikan export memakai filter, `limit` maksimum 5.000, tenant-scoped, dan
  `truncated` benar; E42 memastikan mode `all` mengirim semua non-`sms`, mode `failed` tetap,
  replay tidak menduplikasi, tanpa `BillingEvent` baru.
- P2b: E43 memastikan password/API key/template/resend tercatat, filter action/tenant bekerja,
  event tenant lain tidak terlihat, dan kegagalan audit tidak menggagalkan mutasi (unit test
  service bila memungkinkan).
- P2c: E44 memastikan compose `202`, idempotency, tenant isolation, audit, dan validasi
  recipients/channels; `BillingEvent` tercipta satu.
- Console: `console:typecheck`, `console:build`; unduh CSV di browser manual; form compose dan
  audit diuji protokol/HTTP.
- `npm run ci`, `npm run docs:check`.
- Tanpa dependency baru; tanpa browser automation permanen.

## 10. Keputusan

| # | Keputusan | Default |
|---|---|---|
| D1 | Export berupa JSON (maks 5.000 baris) + CSV dibuat di console | Ya |
| D2 | CSV di-escape dan diberi prefix `'` untuk cell berbahaya | Ya |
| D3 | Resend all = semua baris non-`sms`, konfirmasi eksplisit, tanpa BillingEvent baru | Ya |
| D4 | `AdminAuditEvent` append-only, tanpa FK, best-effort | Ya |
| D5 | Audit P2 mencatat action di §5.2; login/export tidak dicatat | Ya |
| D6 | Compose memakai `IngestService` (tenant dari JWT), `202`, throttle 30/menit, audit | Ya |
| D7 | Compose tanpa preview/penjadwalan/inline override di form | Ya |
| D8 | Eksekusi bertahap P2a → P2b → P2c; commit terpisah per fase | Ya |
| D9 | Tanpa dependency baru dan tanpa browser automation permanen | Ya |
| D10 | Endpoint baru memakai wrapper console sampai rilis SDK berikutnya | Ya |

## 11. Risiko dan batasan

1. **Audit eksplisit bisa terlewat** saat ada endpoint mutasi baru; daftar action harus diperbarui
   bersama endpoint. Interceptor generik ditolak karena risiko data sensitif.
2. **Export 5.000 baris** membatasi laporan besar; streaming ditunda.
3. **Resend all dapat menduplikasi pengiriman** ke penerima yang sudah sukses; wajib konfirmasi.
4. **Compose membuka jalur kirim baru**; rate limit dan audit wajib, tetapi belum ada RBAC.
5. **Audit tumbuh tanpa retensi** di P2.
6. **CSV formula injection** ditangani dengan prefix, bukan sanitasi tipe sel.
7. **Compose memakai template aktif saat diproses**; perubahan template setelah submit dapat
   mengubah hasil (sama seperti ingest).

## 12. Pertanyaan persetujuan

1. Setuju urutan **P2a → P2b → P2c** (D8)?
2. Setuju export JSON maks **5.000** baris + CSV di console (D1)?
3. Setuju **resend all** semua non-`sms` dengan konfirmasi dan tanpa BillingEvent (D3)?
4. Setuju tabel `AdminAuditEvent` dan cakupan action §5.2, tanpa retensi di P2 (D4–D5)?
5. Setuju compose memakai `IngestService`, `202`, throttle 30/menit, tanpa preview (D6–D7)?
6. Setuju tanpa dependency baru (D9)?

Setelah disetujui, implementasi dimulai dari P2a dan berhenti di commit/verifikasi fase tersebut
sebelum lanjut ke P2b.

## 13. Catatan implementasi P2a

P2a (export + resend all) selesai dan terverifikasi pada 2026-11-20; P2b juga selesai (§14); P2c
belum dikerjakan.

Yang sudah berjalan:

- `GET /api/v1/admin/notifications/export` mengembalikan JSON dengan filter yang sama seperti
  list, default/maksimum 5.000 baris, `total`, dan `truncated`; route didaftarkan sebelum `:id`.
- `AdminNotificationsService` memakai satu `buildWhere()` untuk list dan export.
- `POST /admin/notifications/:id/resend` menerima `mode: failed|all`; `all` memilih semua baris
  non-`sms` (termasuk `sent`/`skipped`), tetap membuat notification baru tanpa `BillingEvent`,
  dan idempotensi `requestKey` berlaku per mode.
- Console: tombol **Export CSV** (JSON → CSV di browser, escape kutip + prefix `'` untuk formula),
  notifikasi `truncated`, serta tombol/dialog **Kirim ulang semua** dengan konfirmasi eksplisit.
- Wrapper console `adminExport.ts` dan `adminResend.ts` memakai `HttpTransport`; tidak ada
  dependency baru.

Verifikasi:

| Pemeriksaan | Hasil |
|---|---|
| `npm run test:e2e` | **42** test lulus; E41 export (filter, limit 5.001 ditolak, truncated, tenant isolation), E42 resend all (non-SMS, failed-only tetap 1, replay idempoten, tanpa BillingEvent) |
| `npm run console:typecheck` / `console:build` | lulus |
| `npm run ci` | lulus 52 s: typecheck, build, 29 unit, 42 e2e, 13 migrasi, `Database schema is up to date!` |
| `npm run docs:check` | lulus |

Catatan:

1. Export dibatasi 5.000 baris dan dibuat di browser; streaming CSV ditunda.
2. Resend `all` menyertakan baris `skipped`; konfirmasi UI menjelaskan bahwa penerima yang sudah
   sukses akan menerima lagi.
3. Belum ada browser automation; unduh CSV diuji lewat build dan verifikasi protokol.
4. P2b (audit) dan P2c (compose) belum dimulai.

## 14. Catatan implementasi P2b

P2b (audit aksi admin tenant) selesai dan terverifikasi pada 2026-11-20; P2c belum.

Yang sudah berjalan:

- Tabel `AdminAuditEvent` (migrasi ke-14) append-only, tenant-scoped, tanpa FK; index tenant/waktu,
  tenant/action/waktu, actor/waktu.
- `AdminAuditService.record()` best-effort (gagal insert hanya dicatat ke log) dan `list()`
  tenant-scoped dengan filter action/rentang tanggal + pagination.
- `GET /api/v1/admin/audit` (guard tenant, throttle 120/menit).
- Hook audit di controller (actor dari JWT, IP/requestId dari middleware) untuk: password changed;
  API key created/revoked; template created/updated/deactivated/published/activated/cloned/
  rolled_back; subscriber preferences_updated; topic membership_added/replaced; notification
  resend. Metadata hanya berisi nama/versi/channel/mode/count — tanpa secret.
- Halaman `/audit` + navigasi **Operations**: filter action/tanggal, tabel waktu/actor/action/
  target/metadata, pagination, refresh.
- Wrapper console `adminAudit.ts` memakai `HttpTransport`.

Verifikasi:

| Pemeriksaan | Hasil |
|---|---|
| `npm run test:e2e` | **43** test lulus; E43 memastikan event API key (actor/target/metadata tanpa raw key), filter action, limit 101 ditolak, isolasi tenant, serta event resend/password |
| `npm run console:typecheck` / `console:build` | lulus |
| `npm run ci` | lulus 66 s: typecheck, build, 29 unit, 43 e2e, 14 migrasi, `Database schema is up to date!` |
| `npm run docs:check` | lulus |

Catatan:

1. Cakupan audit adalah daftar action §5.2; endpoint mutasi baru harus menambahkan hook eksplisit.
   Tidak ada interceptor generik.
2. Belum ada retensi/cleanup `AdminAuditEvent`; tabel tumbuh. Kandidat P3.
3. Login/logout dan export tidak dicatat; password/API key/template/preference/topic/resend ya.
4. Audit bersifat best-effort: kegagalan insert tidak menggagalkan mutasi (desain/log; E2E
   memastikan alur normal).

## 15. Catatan implementasi P2c

P2c (compose/send dari console) selesai dan terverifikasi pada 2026-11-20. P2 selesai.

Yang sudah berjalan:

- `POST /api/v1/admin/notifications` menerima `requestKey`, `templateKey`, `recipients`/`topics`,
  `channels`, `data`, dan `priority` (`low|normal|high`).
- `AdminNotificationComposeService` memetakan ke `NotifyDto` dan memanggil `IngestService.enqueue`
  (tenant dari JWT), sehingga idempotensi, fan-out, billing event, dan queue sama dengan ingest.
- Throttle 30/menit; audit `admin.notification.composed` dengan template/channel/jumlah target.
- Halaman `/notifications/new`: template aktif (datalist), recipients/topics, channel, data JSON,
  priority, tombol **Kirim notifikasi** di halaman Notifications.
- Wrapper console `adminCompose.ts` memakai `HttpTransport`.

Verifikasi:

| Pemeriksaan | Hasil |
|---|---|
| `npm run test:e2e` | **44** test lulus; E44 compose `202`, billing event 1, idempotent replay, audit, validasi recipients/channels, isolasi tenant (acme tidak terlihat dari admin default) |
| `npm run console:typecheck` / `console:build` | lulus |
| `npm run ci` | lulus 70 s: typecheck, build, 29 unit, 44 e2e, 14 migrasi, `Database schema is up to date!` |
| `npm run docs:check` | lulus |

Catatan:

1. Compose memakai template aktif saat worker memproses; perubahan template setelah submit dapat
   mengubah hasil (sama seperti ingest).
2. Belum ada preview/penjadwalan/inline override recipient di form; semua tenant admin boleh
   mengirim (belum ada RBAC/approval).
3. Idempotensi memakai `requestKey` UUID; replay mengembalikan notification yang sama.
4. P2 selesai; sisa P3 adalah test/browser automation dan pemindahan wrapper ke SDK terbit.
