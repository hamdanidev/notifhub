# Approval maker-checker dan diff versi template

Status: **terimplementasi dan terverifikasi** (2026-11-22). Lihat §17 untuk catatan implementasi, deviasi, dan bukti verifikasi.
Basis: `docs/design/templates/template-limitations-roadmap.md` D9/§14.4,
`docs/architecture/project-brief.md` §6–§7 butir 9, `docs/design/templates/template-system-design.md`
§6.4 (audit) dan §9 (Admin API), `docs/design/admin-api.md`, `docs/design/multi-tenant-platform-admin.md`,
`docs/design/console-sdk-consolidation.md`, `prisma/schema.prisma` (`AdminUser`, `TemplateAuditEvent`),
`src/auth/admin/admin-jwt.guard.ts`, `src/auth/admin/admin.types.ts`,
`src/admin/services/admin-templates.service.ts`, `src/platform/services/platform-tenant-admins.service.ts`,
dan `console/src/pages/TemplateFormPage.tsx`.

**Isi dokumen**

- [1. Latar belakang dan tujuan](#1-latar-belakang-dan-tujuan)
- [2. Ruang lingkup](#2-ruang-lingkup)
- [3. Keputusan desain](#3-keputusan-desain)
- [4. Model data dan migrasi](#4-model-data-dan-migrasi)
- [5. Alur status dan publish gate](#5-alur-status-dan-publish-gate)
- [6. Kontrak API](#6-kontrak-api)
- [7. Diff versi](#7-diff-versi)
- [8. Peran, izin, dan console](#8-peran-izin-dan-console)
- [9. Kasus tepi dan kebijakan](#9-kasus-tepi-dan-kebijakan)
- [10. Keamanan](#10-keamanan)
- [11. Dampak ke kode yang ada](#11-dampak-ke-kode-yang-ada)
- [12. Rencana test dan verifikasi](#12-rencana-test-dan-verifikasi)
- [13. Migrasi, rollout, dan kompatibilitas](#13-migrasi-rollout-dan-kompatibilitas)
- [14. Risiko dan batasan](#14-risiko-dan-batasan)
- [15. Daftar file yang direncanakan](#15-daftar-file-yang-direncanakan)
- [16. Pertanyaan persetujuan](#16-pertanyaan-persetujuan)
- [17. Catatan implementasi](#17-catatan-implementasi)

---

## 1. Latar belakang dan tujuan

Saat ini setiap `tenant_admin` dapat membuat draft dan langsung `POST /admin/templates/:id/publish`.
Audit (`TemplateAuditEvent`) mencatat aktor dan aksi, tetapi tidak mencegah satu orang mengubah dan
menerbitkan konten yang sama. Untuk template notifikasi, publish berarti worker dapat mengirim ke
semua penerima dan email tidak dapat ditarik kembali.

Tujuan fase ini:

1. **Pemisahan tugas**: perubahan template harus disetujui akun admin kedua dengan peran approver
   sebelum dapat dipublish.
2. **Review yang bermakna**: approver melihat **diff** (field, block Visual, dan render HTML
   berdampingan) sebelum menyetujui, bukan menyetujui buta.
3. **Bukti audit**: siapa mengajukan, siapa menyetujui/menolak, kapan, untuk revisi mana — semua
   tercatat dan dapat ditampilkan di riwayat template.
4. **Tidak ada bypass**: semua jalur yang membuat versi published (termasuk `PUT` legacy
   auto-publish) tunduk pada gate yang sama.
5. **Tanpa dependency baru** dan tanpa perubahan pada worker/render/published immutable.

Keputusan pengguna yang menjadi dasar (dijawab 2026-11-22):

- Wajib **dua admin**: satu akun admin biasa (maker) dan satu akun **approval** (checker).
  Self-approval dilarang pada mode default.
- Berlaku untuk **semua channel** (email, in-app, WhatsApp, SMS).
- Setelah disetujui, **maker dan approver** sama-sama boleh menekan publish.
- **Penyempurnaan:** self-approval tidak dijadikan perilaku tetap, melainkan **kebijakan per
  tenant** dengan default `two_person`; mode longgar `self_approval_allowed` hanya diaktifkan
  operator platform, wajib alasan, dan ditandai audit + warning UI. Deployment **single tenant**
  (tanpa lane platform) memakai env bootstrap untuk approver dan mode kebijakan (§8.7).

## 2. Ruang lingkup

### Termasuk

1. Peran tenant baru `tenant_approver` dengan izin terbatas (review, approve/reject, publish,
   preview/test send, diff) tanpa izin mengubah template atau mengelola resource admin lain.
2. Tabel `TemplateApproval` per `(templateId, revision)` + status dan audit.
3. Gate publish di server: tidak ada publish tanpa approval valid untuk revisi terkini.
4. Endpoint submit/approve/reject/queue/read approvals dan endpoint diff.
5. UI console: tombol **Ajukan review**, halaman **Review** (antrean), panel **Setujui/Tolak**,
   halaman **Bandingkan versi** dengan diff field + block + render berdampingan.
6. Pembuatan akun approver lewat lane platform (role eksplisit) dan bootstrap dev/single tenant
   lewat env `APPROVER_EMAIL`/`APPROVER_PASSWORD_HASH`.
7. Perubahan guard/izin agar approver hanya dapat mengakses endpoint yang diizinkan.
8. Kebijakan `Tenant.templateApprovalMode`: `two_person` (default) atau `self_approval_allowed`,
   diubah hanya oleh platform; di single tenant disinkronkan dari env `TEMPLATE_APPROVAL_MODE`.
9. Jalur single tenant tanpa lane platform: approver dari env, mode kebijakan dari env, dan
   publish self-approval satu langkah (alasan wajib) bila mode mengizinkan.
10. Test unit, e2e baru, pembaruan e2e lama yang memanggil publish, test console, dokumentasi.

### Tidak termasuk

1. Approval berlapis (dua tingkat checker), approval per channel, atau approval untuk aset
   layout/theme/partial.
2. RBAC granular berbasis permission matrix di database; v1 memakai peran tetap (hard-coded).
3. Penjadwalan publish, A/B test, atau approval untuk deaktivasi/aktivasi (lihat §9).
4. Notifikasi email/in-app ke approver (v1 hanya badge dan daftar antrean).
5. Diff pixel/gambar, Playwright, atau render client-side baru.
6. Perubahan provider, worker, sanitizer, atau `openapi/notifhub.json` konsumen.
7. Publikasi npm (`@notifhub/js` dinaikkan di source; publish menunggu persetujuan terpisah).

## 3. Keputusan desain

| # | Keputusan | Default |
|---|---|---|
| D1 | Kebijakan self-approval | Per tenant `templateApprovalMode`: `two_person` (default) atau `self_approval_allowed`. Mode `two_person` mewajibkan ≥1 `tenant_admin` + ≥1 `tenant_approver` aktif dan approval dari akun berbeda; mode longgar mengizinkan self-approval dengan alasan wajib, audit, dan warning UI. Tidak ada mode “approval off” |
| D2 | Cakupan | Gate yang sama untuk semua channel; tidak ada pengecualian channel |
| D3 | Siapa boleh publish | Maker (`tenant_admin`) dan approver (`tenant_approver`), selama approval valid |
| D4 | Model peran | `AdminUser.role` (sudah string) menerima nilai baru `tenant_approver`; izin v1 hard-coded per peran, bukan tabel permission |
| D5 | Status template | Tidak menambah nilai `TemplateStatus`; draft tetap `draft`, status review diturunkan dari `TemplateApproval` |
| D6 | Objek approval | `TemplateApproval` per `(templateId, revision)`; status `pending/approved/rejected`; reject dapat diajukan ulang pada revisi yang sama (baris yang sama, audited) |
| D7 | Gate | Cek approval sebelum validasi konten; error `409` dengan kode spesifik |
| D8 | Invalidasi | Revisi berubah ⇒ approval lama **stale** (tidak dihapus); publish 409 sampai review ulang |
| D9 | Jalur legacy | `PUT /admin/templates/:id` pada published **ditolak** `409 approval_required_draft`; auto-publish versi baru dihapus sebagai bypass |
| D10 | Aktivasi/deaktivasi | Tanpa approval (operasional, tetap diaudit); rollback/clone yang berujung publish tetap lewat review |
| D11 | Izin approver | Read template/versi/audit/test-sends, preview, test send, diff, approve/reject, publish approved; **tanpa** write template, aset, API key, subscriber, topik, notifikasi, compose/resend |
| D12 | Pembuatan approver | Lane platform untuk multi-tenant; env `APPROVER_EMAIL`/`APPROVER_PASSWORD_HASH` untuk tenant default/single tenant. Role immutable di v1 |
| D13 | Diff | Field-level (LCS), block-level dari `builderData`, dan render side-by-side dari pipeline preview; tanpa dependency baru |
| D14 | Notifikasi approver | v1: badge jumlah pending + halaman antrean (polling 60 detik); email/in-app ditunda |
| D15 | Audit | `TemplateAuditAction` ditambah `submitted_for_review`, `approved`, `rejected`, `approval_reopened`; detail juga di `TemplateApproval`, termasuk `selfApproved` |
| D16 | SDK | Tambah tipe + method approval/diff ke `@notifhub/js` source (rilis minor berikutnya); publikasi npm terpisah |
| D17 | Retensi | `TemplateApproval` tanpa cleanup otomatis di v1 (baris kecil, bagian audit); evaluasi bersama retensi audit |
| D18 | Mode single tenant | Tanpa lane platform: approver dari env dan mode kebijakan dari `TEMPLATE_APPROVAL_MODE` (default `two_person`), disinkronkan bootstrap hanya bila platform admin tidak dikonfigurasi |

Alternatif yang ditolak:

| Opsi | Alasan |
|---|---|
| Menambah status template `pending_approval` | Menyentuh worker, query publish/activate, DTO, console, legacy; risiko regresi besar tanpa manfaat tambahan |
| Self-approval sebagai perilaku tetap tanpa kebijakan tenant | Menjadikan “wajib dua admin” formalitas; tidak ada keputusan eksplisit per tenant, dan tidak ada jalan untuk deployment satu orang |
| Hanya flag audit tanpa gate | Audit bersifat detektif, bukan preventif; email sudah terkirim sebelum flag dibaca |
| Approval disimpan di `metadata` audit saja | Sulit di-query untuk antrean, rawan duplikat, tidak punya status |
| RBAC granular di v1 | Lebih besar dari kebutuhan; peran tetap sudah cukup untuk pemisahan tugas |
| Gate di console saja | Bisa dilewati lewat API/klien lain; gate harus di server |

## 4. Model data dan migrasi

### 4.1 Enum dan tabel baru

```prisma
enum TemplateApprovalStatus {
  pending
  approved
  rejected
}

enum TemplateApprovalMode {
  two_person
  self_approval_allowed
}

model Tenant {
  // ... kolom existing ...
  templateApprovalMode TemplateApprovalMode @default(two_person)
}

model TemplateApproval {
  id                 String                 @id @default(uuid())
  tenantId           String                 @default("default")
  templateId         String
  templateVersion    Int
  revision           Int
  status             TemplateApprovalStatus @default(pending)
  requestedByAdminId String
  requestedByEmail   String
  requestedNote      String?
  reviewedByAdminId  String?
  reviewedByEmail    String?
  reviewNote         String?
  selfApproved       Boolean                @default(false)
  selfApprovalReason String?
  requestedAt        DateTime               @default(now()) @db.Timestamptz
  reviewedAt         DateTime?              @db.Timestamptz
  createdAt          DateTime               @default(now()) @db.Timestamptz
  updatedAt          DateTime               @updatedAt @db.Timestamptz

  template NotificationTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@unique([templateId, revision])
  @@index([tenantId, status, requestedAt])
  @@index([tenantId, templateId, createdAt])
}
```

- `templateVersion` disimpan sebagai snapshot untuk ditampilkan; `revision` adalah kunci validasi.
- Tidak ada FK ke `AdminUser` (mengikuti pola audit: akun bisa dinonaktifkan/dipindah; jejak tetap).
- `NotificationTemplate` mendapat relasi `approvals TemplateApproval[]` (aditif).
- `selfApproved=true` menandai approval yang dibuat oleh orang yang sama (hanya sah pada mode
  `self_approval_allowed`); `selfApprovalReason` wajib diisi pada kasus itu.
- Tidak ada kolom baru pada `NotificationTemplate`, `Notification`, atau worker.

### 4.2 Perubahan enum audit

`TemplateAuditAction` ditambah:

```prisma
submitted_for_review
approved
rejected
approval_reopened
```

### 4.3 Migrasi

Satu migrasi aditif `prisma/migrations/<timestamp>_template_approval/`:

1. `CREATE TYPE "TemplateApprovalStatus"` dan `CREATE TYPE "TemplateApprovalMode"`.
2. `ALTER TYPE "TemplateAuditAction" ADD VALUE ...` (empat nilai).
3. `ALTER TABLE "Tenant" ADD COLUMN "templateApprovalMode" ... DEFAULT 'two_person'` (aditif,
   tenant lama otomatis strict).
4. `CREATE TABLE "TemplateApproval"` + unique + index + FK cascade ke `NotificationTemplate`.
5. Tidak ada backfill dan tidak ada perubahan baris lain.

Jumlah migrasi menjadi **15** (dari 14). Rollback schema tidak diperlukan untuk rollback kode: kode
lama mengabaikan tabel/kolom/nilai enum baru.

## 5. Alur status dan publish gate

Tidak ada status template baru; alur yang terlihat pengguna:

```
draft ──(publish)──► published
  │                       ▲
  │  Ajukan review        │
  ▼                       │
pending ──approve──► approved ──publish (maker/approver)──┘
  │
  └──reject──► rejected ──(edit ⇒ revisi baru / ajukan ulang)──► pending
```

Status approval disimpan terpisah; template draft dengan approval `pending` ditampilkan sebagai
“Menunggu review” di console, dan draft dengan approval `approved` untuk revisi terkini sebagai
“Disetujui, siap publish”.

### 5.1 Urutan pemeriksaan publish

`AdminTemplatesService.publish` (dan semua jalur publish) menjalankan urutan:

1. Resolusi template tenant-scoped (404 bila bukan milik tenant).
2. Status harus `draft` dan `revision` harus sama dengan `expectedRevision` (409 seperti sekarang).
3. **Gate approval** (bercabang menurut `Tenant.templateApprovalMode`):
   - mode `two_person`: approver aktif ada di tenant? jika tidak → `409 approver_unavailable`;
     approval untuk `(templateId, revision)` harus ada dan `approved`; `pending` →
     `409 approval_pending`; `rejected` → `409 approval_rejected`; tidak ada → `409
     approval_required`; `approved` dengan revisi berbeda → `409 approval_stale`; pengaju =
     reviewer → `409 approval_self_forbidden`.
   - mode `self_approval_allowed`: publish menerima `selfApprovalReason` (≥ 20 karakter) bila
     belum ada approval; server membuat `TemplateApproval` **approved** dengan `selfApproved=true`
     dalam transaksi yang sama (lihat §5.4). Jika approval `approved` sudah ada (dari review biasa),
     alur normal dipakai; alasan tidak wajib.
4. Validasi konten (HTML, variabel, builder) seperti sekarang.
5. Transaksi publish + audit `published` dengan `metadata.approvalId` dan `selfApproved`.

Alasan gate sebelum validasi: menghemat render/validasi untuk permintaan yang pasti ditolak, dan
pesan error lebih actionable.

### 5.2 Pembatalan otomatis (stale)

Setiap perubahan konten draft menaikkan `revision` (perilaku sekarang). Approval terikat pada
`revision`, sehingga edit setelah approve otomatis membatalkan penerbitan. Approval lama **tidak
dihapus**; API menandainya `stale: true` bila revisi tidak lagi cocok. Ini menjaga jejak audit dan
memudahkan UI menjelaskan “perubahan setelah disetujui”.

### 5.3 Jalur publish lain

| Jalur | Perlakuan |
|---|---|
| `POST /:id/publish` | Gate approval (§5.1) |
| `PUT /:id` pada draft | Tidak publish; hanya update + `revision+1` |
| `PUT /:id` pada published (legacy auto-publish) | **Ditolak** `409 approval_required_draft`; klien harus membuat draft (`POST`/clone), mengajukan review, lalu publish |
| `POST /:id/activate` | Tanpa approval (mengaktifkan versi published yang sudah ada); audit `activated` |
| `DELETE /:id` (deaktivasi) | Tanpa approval; audit `deactivated` |
| `POST /:id/rollback` | Membuat draft baru; publish tetap butuh review |
| `POST /:id/clone` | Membuat draft baru; publish tetap butuh review |
| `template-test-send` | Bukan publish; tidak digerbang (audited, rate limited) |

### 5.4 Mode `self_approval_allowed` (satu langkah)

Untuk tenant longgar (termasuk single tenant satu orang), publisher tidak perlu melewati dua
langkah submit/approve yang formalitas. Alih-alih:

1. `POST /:id/publish` dengan body `{ expectedRevision, selfApprovalReason, note? }`.
2. Server memeriksa mode tenant = `self_approval_allowed`, alasan ≥ 20 karakter, dan belum ada
   approval untuk revisi tersebut.
3. Dalam transaksi yang sama: buat `TemplateApproval` `approved`, `selfApproved=true`,
   `selfApprovalReason`, `requestedByAdminId = reviewedByAdminId = admin`, `requestedAt =
   reviewedAt = now`, lalu publish.
4. Audit `approved` (`metadata.selfApproval=true`, alasan disimpan di `TemplateApproval`, **tidak**
   di log) dan `published` (`metadata.approvalId`, `selfApproved=true`).

Jika approval `approved` sudah ada (review normal oleh akun kedua), publish memakai jalur biasa dan
`selfApprovalReason` tidak diperlukan. Jika `selfApprovalReason` dikirim pada mode `two_person` →
`400 self_approval_not_allowed`. Jika mode longgar tetapi alasan kosong/terlalu pendek →
`400 self_approval_reason_required`.

Self-approval **tidak menimpa** approval yang sudah ada untuk revisi tersebut:

| Approval revisi | Perilaku publish |
|---|---|
| tidak ada | self-approval satu langkah (alasan wajib) |
| `pending` | `409 approval_pending` (tunggu review atau minta approver menolak) |
| `approved` | publish normal (tanpa alasan) |
| `rejected` | `409 approval_rejected`; edit revisi baru atau ajukan ulang untuk review |

Dengan begitu penolakan reviewer tidak bisa “diakali” oleh orang yang sama pada revisi yang sama.

## 6. Kontrak API

Semua endpoint di bawah `/api/v1/admin`, tenant dari JWT, error memakai envelope yang ada
(`details.code`).

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| POST | `/templates/:id/submit-review` | `tenant_admin` | Ajukan revisi terkini untuk direview; body `{ expectedRevision, note? }` |
| GET | `/templates/:id/approvals` | keduanya | Riwayat approval template (paginasi) |
| POST | `/template-approvals/:id/approve` | `tenant_approver` | Setujui; body `{ note? }`; pengaju ≠ penyetuju |
| POST | `/template-approvals/:id/reject` | `tenant_approver` | Tolak; body `{ note }` wajib |
| GET | `/template-approvals` | keduanya | Antrean; filter `status`, `templateId`, paginasi |
| GET | `/templates/:id/diff` | keduanya | Diff dua versi; query `fromVersion`, `toVersion` |
| POST | `/templates/:id/publish` | keduanya | Gate approval lalu publish; body `{ expectedRevision, note?, selfApprovalReason? }` |

### 6.1 Submit review

```http
POST /api/v1/admin/templates/:id/submit-review
{ "expectedRevision": 3, "note": "Ganti CTA promo" }
```

Respons `201`:

```json
{
  "id": "approval-uuid",
  "templateId": "template-uuid",
  "templateVersion": 4,
  "revision": 3,
  "status": "pending",
  "requestedBy": { "adminId": "…", "email": "admin@example.com" },
  "requestedAt": "2026-11-22T09:00:00.000Z",
  "reviewedBy": null,
  "stale": false
}
```

Aturan:

- Template harus `draft`; `expectedRevision` harus cocok (409 bila berubah).
- Harus ada minimal satu approver aktif di tenant; jika tidak → `409 approver_unavailable`.
- Bila sudah ada approval `pending` untuk revisi yang sama → `409 approval_exists` (idempoten
  dengan `requestKey` opsional di fase berikut).
- Bila approval `rejected` pada revisi yang sama → boleh diajukan ulang: baris yang sama kembali
  `pending`, `reviewedBy` dikosongkan, audit `approval_reopened`.
- Pada mode `self_approval_allowed`, submit tetap tersedia untuk review normal tetapi **tidak
  wajib**; publisher dapat memakai jalur self-approval satu langkah (§5.4).

### 6.2 Approve / reject

```http
POST /api/v1/admin/template-approvals/:id/approve
{ "note": "Link dan diskon sesuai brief" }
```

Aturan:

- Hanya `tenant_approver`; approver nonaktif/tenant lain → `403`/`404`.
- Approval harus `pending`; jika sudah `approved`/`rejected` → `409 approval_not_pending`.
- Template harus masih `draft` dan `template.revision === approval.revision`, jika tidak →
  `409 approval_revision_mismatch`.
- `requestedByAdminId !== reviewerAdminId`; jika sama → `409 approval_self_forbidden`.
- Reject mewajibkan `note` 1–500 karakter.
- Respons memuat approval + status template; audit `approved`/`rejected`.

### 6.3 Publish dengan gate

Body:

```http
POST /api/v1/admin/templates/:id/publish
{ "expectedRevision": 3, "note": "Promo akhir bulan", "selfApprovalReason": "Perbaikan typo mendesak, approver tidak tersedia" }
```

`selfApprovalReason` hanya dipakai pada mode `self_approval_allowed` dan diabaikan bila approval
`approved` dari reviewer lain sudah ada.

Error baru (HTTP `409` kecuali disebut lain):

| Kode | Arti |
|---|---|
| `approver_unavailable` | Tenant belum punya approver aktif (mode `two_person`) |
| `approval_required` | Belum ada pengajuan untuk revisi ini |
| `approval_pending` | Masih menunggu review |
| `approval_rejected` | Ditolak; ajukan ulang atau ubah draft |
| `approval_stale` | Approval milik revisi lain (draft berubah setelah review) |
| `approval_self_forbidden` | Pengaju dan penyetuju akun yang sama pada mode `two_person` |
| `self_approval_not_allowed` | `selfApprovalReason` dikirim pada mode `two_person` (`400`) |
| `self_approval_reason_required` | Mode longgar tanpa alasan atau alasan < 20 karakter (`400`) |

Contoh respons:

```json
{
  "statusCode": 409,
  "message": "Template belum disetujui untuk revisi 3; ajukan review lalu minta approver menyetujui.",
  "error": "Conflict",
  "details": {
    "code": "approval_required",
    "templateId": "…",
    "revision": 3,
    "latestApproval": null
  },
  "path": "/api/v1/admin/templates/…/publish"
}
```

### 6.4 Antrean approval

`GET /admin/template-approvals?status=pending&limit=20&offset=0` mengembalikan item:

```json
{
  "items": [
    {
      "id": "approval-uuid",
      "templateId": "template-uuid",
      "templateKey": "order.shipped",
      "templateVersion": 4,
      "revision": 3,
      "channel": "email",
      "locale": "id",
      "status": "pending",
      "requestedBy": { "adminId": "…", "email": "admin@example.com" },
      "requestedAt": "…",
      "stale": false,
      "subjectPreview": "Pesanan {{order.number}} dikirim"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

- `tenant_admin` melihat antrean tenant-nya (read-only, untuk memantau).
- Approver melihat dan dapat bertindak.
- `stale` dihitung: `template.revision !== approval.revision`; item stale tetap tampil sampai
  admin mengajukan ulang atau membuangnya dari antrean (lihat pertanyaan §16 butir 6).

## 7. Diff versi

### 7.1 Kontrak

`GET /api/v1/admin/templates/:id/diff?fromVersion=2&toVersion=3`

- Kedua versi harus milik tenant yang sama dan satu grup `(key, channel, locale)`; jika tidak →
  `400 diff_group_mismatch`.
- Versi tidak ditemukan → `404 diff_version_not_found`.
- Jika `fromVersion`/`toVersion` tidak diberikan, default: versi sebelumnya (terhadap
  `toVersion`).

```json
{
  "templateId": "template-uuid",
  "key": "order.shipped",
  "channel": "email",
  "locale": "id",
  "from": {
    "id": "…",
    "version": 2,
    "revision": 5,
    "status": "published",
    "updatedAt": "…",
    "builderAvailable": true
  },
  "to": { "id": "…", "version": 3, "revision": 0, "status": "draft", "updatedAt": "…", "builderAvailable": true },
  "fields": [
    {
      "field": "subject",
      "changed": true,
      "mode": "word",
      "hunks": [
        { "type": "equal", "value": "Pesanan " },
        { "type": "removed", "value": "dikirim" },
        { "type": "added", "value": "tiba" }
      ]
    },
    {
      "field": "body",
      "changed": true,
      "mode": "line",
      "addedLines": 3,
      "removedLines": 1,
      "truncated": false
    }
  ],
  "blocks": {
    "available": true,
    "added": 1,
    "removed": 0,
    "changed": [{ "index": 2, "type": "button", "fields": ["label", "url"] }]
  },
  "rendered": {
    "from": { "html": "<!doctype html>…", "text": "…", "bytes": 18422 },
    "to": { "html": "<!doctype html>…", "text": "…", "bytes": 18601 }
  },
  "truncated": false
}
```

### 7.2 Algoritma dan batas

| Bagian | Cara | Batas |
|---|---|---|
| Subject/preheader | Word-level LCS | 255/200 karakter |
| Body | Line-level LCS; baris panjang dipecah per 500 karakter | Maks 4.000 baris per versi, 500 hunk |
| Block Visual | Bandingkan `builderData.blocks` per posisi/`id`; klasifikasi added/removed/changed + nama field | Maks 200 block (batas schema) |
| Render | Dua render memakai pipeline preview yang ada (layout/theme/partial versi masing-masing) dengan sample data versi target | HTML ≤ 256 KB per versi |
| Respons | — | Dipotong pada 1 MB; `truncated=true` + pesan |

Tanpa dependency baru: LCS/word-diff ditulis sebagai fungsi murni di server (±150 baris) dan diuji
unit. Jika nanti butuh diff yang lebih kaya (mis. intra-line highlight), evaluasi dependency
terpisah.

### 7.3 UI

- Halaman `/templates/:id/compare?fromVersion=2&toVersion=3`.
- Atas: ringkasan (“3 field berubah, 1 block ditambahkan”).
- Tab **Field**: hunk teks (ditambah hijau, dihapus merah), tombol “salin versi lama/baru”.
- Tab **Block**: daftar block lama vs baru + field yang berubah; jika salah satu versi tanpa
  `builderData`, tampilkan “versi ini dibuat di mode HTML”.
- Tab **Render**: dua iframe `sandbox=""` berdampingan (desktop 600 px / mobile 375 px).
- Semua teks di-render oleh React (tanpa `dangerouslySetInnerHTML`); HTML hanya masuk `srcDoc`
  iframe sandbox.

## 8. Peran, izin, dan console

### 8.1 Peran

| Peran | Deskripsi |
|---|---|
| `tenant_admin` | Maker: buat/edit/clone/rollback draft, aset, API key, subscriber, topik, notifikasi; ajukan review; publish bila disetujui |
| `tenant_approver` | Checker: baca template/versi/audit/test-sends, preview, test send, diff, approve/reject, publish bila disetujui; tidak dapat mengubah konten atau mengelola resource lain |
| `platform_admin` | Lane platform; membuat/mengelola admin tenant termasuk approver; tidak publish template tenant |

Role disimpan di `AdminUser.role` (sudah ada). Role **immutable** di v1: perubahan peran = buat akun
baru + nonaktifkan akun lama (audited), mencegah eskalasi diri.

### 8.2 Matriks izin endpoint (v1)

| Endpoint | `tenant_admin` | `tenant_approver` |
|---|---|---|
| auth me/change-password | ya | ya |
| GET templates/versions/audit/test-sends | ya | ya |
| preview (inline/saved), diff | ya | ya |
| test send | ya | ya (audited, rate limited) |
| submit review | ya | tidak |
| list approvals/queue | ya (read) | ya |
| approve/reject | tidak | ya |
| publish | ya (bila approved) | ya (bila approved) |
| create/update/delete/clone/rollback template | ya | tidak |
| aset template (layout/theme/partial/image) | ya | tidak |
| API key, subscriber, topik, notifikasi, resend, compose, audit admin | ya | tidak |
| lane platform | tidak | tidak |

### 8.3 Penegakan di server

1. `AdminJwtGuard` diperluas menerima `tenant_admin` **dan** `tenant_approver`, tetap memvalidasi
   akun aktif, tenant aktif, `tokenVersion`, dan kecocokan tenant.
2. Dekorator baru `@AdminRoles(...)` + `AdminRolesGuard` global yang membaca metadata rute.
   **Default tanpa dekorator = `tenant_admin`**, sehingga approver otomatis ditolak (`403
   role_not_permitted`) di semua controller lama tanpa perlu menyentuh satu per satu.
3. Rute yang boleh diakses approver diberi `@AdminRoles('tenant_admin', 'tenant_approver')`; rute
   approve/reject `@AdminRoles('tenant_approver')`.
4. `AdminAuthService.login/me/changePassword` menerima kedua peran (login approver harus berhasil;
   saat ini guard menolak).
5. Response `me`/login tetap memuat `role` (SDK sudah `string`), console memakainya untuk navigasi.

### 8.4 Console

| Area | Perubahan |
|---|---|
| Sesi/rute | `ProtectedRoute` menerima `tenant_admin`/`tenant_approver`; sesi menyimpan role |
| Navigasi | `tenant_admin`: menu sekarang + **Review** (antrean); `tenant_approver`: **Template** (read-only), **Review**, **Akun** |
| Template editor | Maker: tombol **Ajukan review** (draft tersimpan, belum ada approval valid) + status approval; approver: mode read-only + tombol **Setujui/Tolak** + tautan diff; **Publish** aktif hanya jika approval valid |
| Halaman `/reviews` | Daftar antrean (filter status), cuplikan subject, pengaju, waktu, tautan diff, aksi approve/reject; badge jumlah pending di sidebar (polling 60 detik) |
| Halaman compare | Diff field/block/render (§7.3) |
| Mode & badge | Pengaturan tenant menampilkan mode approval read-only; daftar/riwayat template menampilkan badge **Self-approved**; dialog publish pada mode longgar meminta alasan dan menampilkan warning “melewati review akun kedua” |
| Banner | Bila tenant belum punya approver: “Publish memerlukan akun approver. Minta operator platform menambahkan.” Di single tenant: “Set `APPROVER_EMAIL`/`APPROVER_PASSWORD_HASH`, atau aktifkan `TEMPLATE_APPROVAL_MODE=self_approval_allowed`.” |
| Guard UI | Tombol write disembunyikan untuk approver; server tetap otoritatif (UI bukan pengaman) |

### 8.5 Perubahan lane platform

- `CreateTenantAdminDto`/`UpdateTenantAdminDto` menerima `role` opsional (`tenant_admin` |
  `tenant_approver`, default `tenant_admin` agar kompatibel).
- `PlatformTenantAdminsService.list` mengembalikan kedua peran (filter `role` opsional).
- `assertNotLastActiveAdmin` hanya berlaku untuk `tenant_admin`; approver boleh dinonaktifkan
  (konsekuensinya publish berhenti sampai approver baru dibuat).
- `PATCH /platform/tenants/:id` menerima `templateApprovalMode` (`two_person` |
  `self_approval_allowed`); perubahan diaudit (`tenant.updated`, metadata `from`/`to`) dan hanya
  tersedia di lane platform. Menurunkan kembali ke `two_person` sebaiknya disertai pengingat UI
  untuk memastikan approver aktif tersedia.
- Console platform: kolom **Peran** di daftar admin, pilihan peran saat menambah admin, dan
  pengaturan **Mode approval template** di detail tenant (dengan teks peringatan saat melonggarkan).
- Provisioning tenant tetap membuat satu `tenant_admin`; approver ditambahkan sebagai langkah
  kedua (langkah operator, terdokumentasi). Alasan: approver harus dibuat pihak platform agar
  independen dari admin tenant.

### 8.6 Bootstrap dan data dev

- Env baru:
  - `APPROVER_EMAIL`, `APPROVER_PASSWORD_HASH` (opsional): membuat/menyinkronkan akun
    `tenant_approver` untuk tenant `DEFAULT_TENANT_ID`, memakai pola `bootstrapPasswordHash` yang
    sama seperti admin.
  - `TEMPLATE_APPROVAL_MODE` (`two_person` default, `self_approval_allowed`): mode kebijakan tenant
    default.
- **Precedence**:
  - Bila lane platform aktif (`PLATFORM_ADMIN_EMAIL`/hash diisi atau ada akun platform aktif):
    `Tenant.templateApprovalMode` adalah sumber kebenaran; env mode **diabaikan** dan startup
    mencatat warning bila env diisi, agar tidak menimpa keputusan operator platform.
  - Bila lane platform tidak aktif (single tenant/dev): bootstrap menyinkronkan
    `Tenant.templateApprovalMode` tenant default dari env; perubahan env berlaku setelah restart
    dan dicatat di log terstruktur (`tenant.approval_mode.bootstrap`). Mode tidak mengubah baris
    tenant lain.
- Bila approver env kosong dan mode `two_person`: warning startup
  `template.approval.approver_missing` dengan instruksi (isi env atau longgarkan mode).
- Email approver bentrok dengan admin/platform admin → gagal cepat saat startup (pola yang ada).
- `.env.example` dan `.env.prod.example` ditambah komentar; hash dibuat dengan
  `npm run admin:hash-password`.
- Seed dev tidak membuat approver dengan password hard-coded; dokumentasi local setup menjelaskan
  env atau lane platform.

### 8.7 Mode single tenant

Deployment single tenant (lihat `docs/operations/single-tenant-deployment.md`) menjalankan satu
tenant `default`, **tanpa akun platform**, dan memblokir `/api/v1/platform/*` di reverse proxy.
Artinya jalur “operator platform menambah approver” **tidak tersedia**, sehingga desain ini
menambahkan dua jalur env:

| Kebutuhan | Jalur single tenant |
|---|---|
| Akun approver | `APPROVER_EMAIL` + `APPROVER_PASSWORD_HASH`; bootstrap membuat/menyinkronkan `tenant_approver` |
| Mode kebijakan | `TEMPLATE_APPROVAL_MODE` (`two_person` default; `self_approval_allowed` untuk operasi satu orang) |
| Perubahan mode setelah go-live | ubah env + restart; tercatat di log; tidak ada UI tenant untuk mengubahnya (read-only) |
| Publish dua orang | admin membuat draft + ajukan review; approver login lalu approve; salah satu publish |
| Publish satu orang | mode `self_approval_allowed`; publish satu langkah dengan alasan wajib (audit + badge) |

Konsekuensi yang harus didokumentasikan di panduan single tenant:

1. Mode default `two_person` **mewajibkan dua akun**; kalimat lama “satu akun admin biasanya cukup”
   tidak berlaku untuk publish template.
2. Tanpa `APPROVER_*` dan tanpa mode longgar, publish template ditolak `409 approver_unavailable`
   (draft/preview/test send tetap jalan).
3. Operator yang tidak ingin dua akun harus memilih `self_approval_allowed` secara sadar, dengan
   konsekuensi setiap publish self-approval tercatat dan diberi badge.
4. Tidak ada cara mengubah mode dari console tenant (mencegah admin melonggarkan kontrolnya
   sendiri).
5. Upgrade ke multi-tenant nanti: mode tersimpan di baris tenant; env mode berhenti berlaku saat
   platform admin dikonfigurasi, dan operator platform dapat mengubahnya per tenant.

## 9. Kasus tepi dan kebijakan

| Kasus | Perilaku |
|---|---|
| Tenant hanya punya satu admin, mode `two_person` | Submit/publish `409 approver_unavailable`; UI menampilkan instruksi (tambah approver atau longgarkan mode) |
| Tenant satu admin, mode `self_approval_allowed` | Publish satu langkah dengan `selfApprovalReason` ≥ 20 karakter; approval `selfApproved=true`; badge + warning UI |
| Mode longgar tetapi maker tetap minta review akun kedua | Diizinkan: submit/approve normal; publish memakai approval reviewer (bukan self) |
| Pengaju mencoba approve di mode `two_person` | `409 approval_self_forbidden` (role approver memang tidak bisa submit; cek tetap ada sebagai pertahanan) |
| `selfApprovalReason` dikirim pada mode `two_person` | `400 self_approval_not_allowed` |
| Mode longgar tanpa alasan | `400 self_approval_reason_required` |
| Single tenant tanpa `APPROVER_*` dan mode default | Publish `409 approver_unavailable`; draft/preview/test send tetap jalan; startup warning |
| Approver menonaktifkan akunnya / dinonaktifkan platform | Approval pending tetap ada; publish tetap butuh approval `approved`, jadi tidak bisa diselesaikan sampai approver aktif/baru |
| Draft diedit setelah disetujui | `revision+1`; approval lama `stale`; publish `409 approval_stale`; ajukan ulang |
| Approver reject tanpa catatan | Ditolak validasi `400 review_note_required` |
| Ajukan ulang setelah reject | Baris approval yang sama kembali `pending` (audit `approval_reopened`); `reviewNote` dipertahankan, `reviewedBy` dikosongkan |
| Publish dua kali | Publish kedua `409 only drafts can be published` (perilaku sekarang) |
| Approval untuk template non-draft | `409 only drafts can be reviewed` |
| Approver mengakses endpoint admin lain | `403 role_not_permitted` (default guard) |
| Approver mengakses tenant lain | `404`/`403` sesuai guard tenant-scoped |
| Tenant suspended | Semua lane `403 tenant_suspended` (perilaku sekarang) |
| Approver melakukan test send | Diizinkan, audited, rate limit seperti sekarang |
| Deaktivasi/aktivasi template | Tanpa approval; audited; alasan: operasional dan tidak mengubah konten |
| Rollback ke versi lama | Membuat draft baru; publish tetap butuh review (reviewer melihat diff) |
| `PUT` legacy pada published | `409 approval_required_draft`; tidak ada auto-publish |
| Klien API lama yang memanggil publish | `409` dengan pesan jelas; perlu membuat approval lebih dulu |
| Dua approver menyetujui bersamaan | Satu menang; yang kedua `409 approval_not_pending` |
| Approval kadaluarsa | Tidak ada TTL di v1; stale hanya karena revisi berubah |

## 10. Keamanan

1. **Otorisasi server-side**: gate dan izin diperiksa dari `AdminUser` di DB setiap request (pola
   guard sekarang), bukan dari klaim JWT saja.
2. **Pemisahan tugas**: pada mode `two_person`, pengaju ≠ penyetuju; approver tidak punya izin
   tulis; role immutable. Pada mode `self_approval_allowed`, pemisahan tugas dilepas secara
   eksplisit oleh platform, tetapi tetap wajib alasan dan tercatat (`selfApproved`) — bukan
   perilaku diam-diam.
3. **Tidak ada bypass**: publish gate dipakai di semua jalur publish; legacy PUT ditolak; tidak
   ada flag runtime yang mematikan gate. Satu-satunya pelonggaran adalah kebijakan tenant yang
   eksplisit, audited, dan hanya dapat diubah di luar lane tenant (platform atau env deployment).
4. **Tenant isolation**: semua query approval/diff memakai `tenantId` dari JWT; ID tenant lain →
   `404` (pola yang ada).
5. **Diff aman**: HTML hanya masuk `srcDoc` iframe `sandbox=""`; teks field dirender React tanpa
   `dangerouslySetInnerHTML`; pipeline preview sudah menyisipkan CSP dan sanitizer.
6. **Payload**: catatan dan alasan maks 500 karakter; paginasi dibatasi; diff dibatasi ukuran/baris;
   rate limit submit/approve/diff (mis. 60/menit per admin) untuk mencegah abuse.
7. **Log**: tidak ada body template/catatan/alasan lengkap di log; hanya ID, versi, revisi, status,
   aktor, `selfApproved` (boolean).
8. **Audit**: setiap transisi approval menulis `TemplateAuditEvent`; `TemplateApproval` menyimpan
   jejak minimal (email aktor, waktu, status, alasan self-approval).
9. **Break-glass**: multi-tenant — operator platform menambah/mengaktifkan approver (audited di
   `PlatformAuditEvent`); single tenant — mengisi env approver atau mengubah env mode lalu restart
   (tercatat di log deployment). Tidak ada “super admin publish” di lane tenant dan tidak ada
   endpoint tenant untuk melonggarkan kebijakan.

## 11. Dampak ke kode yang ada

| Area | Perubahan |
|---|---|
| Schema | Enum `TemplateApprovalStatus` + `TemplateApprovalMode`, kolom `Tenant.templateApprovalMode` (default `two_person`), tabel `TemplateApproval` + `selfApproved`/`selfApprovalReason`, 4 nilai `TemplateAuditAction`, relasi di `NotificationTemplate`; migrasi ke-15 |
| Auth | `admin.types.ts` konstanta role approver; `AdminJwtGuard` menerima dua peran; `AdminRolesGuard` + `@AdminRoles`; `AdminAuthService` menerima approver |
| Template publish | Gate di `publish`; `updatePublishedViaNewVersion` menolak; ekstraksi helper `assertPublishApproval` |
| Approval service | Modul/controller/service baru untuk submit/list/approve/reject/queue |
| Diff | Service diff murni + endpoint baca di controller template; render lewat `AdminTemplatePreviewService` |
| Platform | DTO/role + `templateApprovalMode` di update tenant, service, controller, console platform (kolom peran, form peran, pengaturan mode + warning) |
| Bootstrap | Env `APPROVER_EMAIL`/`APPROVER_PASSWORD_HASH`, `TEMPLATE_APPROVAL_MODE`, precedence single tenant vs platform, warning approver hilang |
| Config/deploy | `.env.example`, `.env.prod.example`, `configuration.md`, panduan single tenant (env + checklist + batasan dua akun) |
| Console | Sesi/role, ProtectedRoute, navigasi, TemplateFormPage, halaman Review + Compare, tes |
| SDK | `admin-types.ts` (status/approval/diff types), `templates-client.ts` (submit/list/approve/reject/diff) di source; versi minor berikutnya |
| Dokumentasi | `admin-api.md`, `multi-tenant-platform-admin.md`, `template-system-design.md` (§9/§18), `project-brief` §6–§7, roadmap §14.4, `configuration.md`, README indeks |

Tidak berubah: worker, renderer, sanitizer, provider, `openapi/notifhub.json` konsumen, Go module,
tiga lane auth (hanya penambahan peran di lane tenant), dan perilaku published immutable.

## 12. Rencana test dan verifikasi

### 12.1 Unit test baru

1. **Policy approval** (`template.approval.policy.unit-spec.ts`): syarat approver aktif, revisi
   cocok, status transition, stale, reject note wajib, cabang mode `two_person` vs
   `self_approval_allowed` (alasan wajib, `selfApproved`, `400` saat mode strict).
2. **Diff** (`template.diff.unit-spec.ts`): LCS baris (added/removed/equal), word diff, block diff
   (added/removed/changed), truncation, versi tanpa `builderData`.
3. **Guard/roles** (`admin-roles.unit-spec.ts`): default deny untuk approver, rute yang diizinkan,
   role tidak dikenal.
4. **Bootstrap mode** (`admin-bootstrap.mode.unit-spec.ts`): env mode diterapkan saat platform admin
   tidak ada, diabaikan saat platform aktif, approver env idempoten, bentrok email gagal cepat.

### 12.2 E2E baru (E48–E57)

| ID | Skenario | Ekspektasi |
|---|---|---|
| E48 | Maker submit → approver approve → maker publish (email) | 201/200/200; `TemplateApproval` approved; audit submitted/approved/published; worker mengirim |
| E49 | Publish tanpa approval; publish setelah draft diedit | `409 approval_required`; edit → `409 approval_stale` |
| E50 | Self-approval & izin silang pada mode `two_person` | Approver tidak bisa submit (403); maker tidak bisa approve (403); approve oleh akun pengaju ditolak; `selfApprovalReason` → `400 self_approval_not_allowed` |
| E51 | Isolasi peran approver | Approver bisa list/preview/diff/test send; create/update/delete template, aset, API key, subscriber → 403 |
| E52 | Tenant tanpa approver | Submit/publish `409 approver_unavailable`; setelah platform menambah approver, alur E48 berhasil |
| E53 | Legacy PUT pada published | `409 approval_required_draft`; `activate`/deactivate tetap 200 |
| E54 | Diff dua versi | Field/block/rendered terisi; versi beda grup `400`; tenant lain `404` |
| E55 | Semua channel | Approval + publish untuk in-app (dan WhatsApp teks) tunduk gate yang sama |
| E56 | Konkurensi | Approve kedua `409 approval_not_pending`; approve saat revisi berubah `409 approval_revision_mismatch` |
| E57 | Mode `self_approval_allowed` | Publish tanpa alasan `400 self_approval_reason_required`; dengan alasan sukses; `TemplateApproval.selfApproved=true`; audit memuat `selfApproval`; badge tampil |
| E58 | Single tenant dari env | Bootstrap membuat approver dari `APPROVER_*`; `TEMPLATE_APPROVAL_MODE` diterapkan ke tenant `default`; publish dua akun berhasil; env mode diabaikan saat platform admin aktif (warning) |

### 12.3 E2E lama yang harus diperbarui

Semua test yang memanggil publish harus memakai helper `submitAndApprove(templateId)` memakai akun
approver: E12, E13, E14, E19 (berubah menjadi skenario 409), E20, E26, E28, dan varian E15/E16 yang
memerlukan template published. Jumlah e2e menjadi **47 + 11 = 58**.

### 12.4 Console

- Test `ProtectedRoute`/navigasi per peran.
- Test halaman Review: tampilan antrean, tombol approve/reject, catatan wajib.
- Test halaman Compare: hunk field, ringkasan block, iframe `sandbox`.
- Test editor: tombol **Ajukan review** hanya untuk maker; **Publish** nonaktif tanpa approval.
- `console:typecheck`/`build`; verifikasi UI manual dua akun (tanpa Playwright).

### 12.5 Verifikasi manual end-to-end

1. Siapkan dua akun: admin dan approver (env bootstrap atau lane platform).
2. Admin membuat draft, mengubah subject/body, **Ajukan review**.
3. Approver login → Review → bandingkan versi (field/block/render) → setujui.
4. Admin publish → worker mengirim; cek DB `TemplateApproval`, audit, dan `publishedByAdminId`.
5. Edit draft setelah disetujui → publish 409; ajukan ulang.
6. Reject dengan catatan → perbaiki → ajukan ulang → setujui → publish.
7. Tenant tanpa approver (mode `two_person`) → pesan 409 dan banner console.
8. Approver mencoba edit template/API key → 403 dan tombol tidak tampil.
9. Single tenant: isi `APPROVER_EMAIL`/`APPROVER_PASSWORD_HASH` → restart → approver bisa login dan
   approve; lalu ubah `TEMPLATE_APPROVAL_MODE=self_approval_allowed` → publish satu langkah dengan
   alasan, cek badge/audit.
10. Cek log tidak memuat body/catatan/alasan lengkap.

### 12.6 Regresi wajib

`npm run ci` (target: unit bertambah, e2e 58, migrasi 15), `console:test/typecheck/build`,
`sdk:typecheck/test`, `react:test`, `docs:check`, dan GitHub Actions hijau.

## 13. Migrasi, rollout, dan kompatibilitas

### 13.1 Urutan rollout

1. Masuk fase persetujuan dokumen ini (keputusan §16).
2. Migrasi aditif (tabel + enum + kolom mode) → deploy backend.
3. Multi-tenant: operator platform menambahkan approver untuk setiap tenant yang akan publish dan
   memilih mode approval. Single tenant: isi `APPROVER_EMAIL`/`APPROVER_PASSWORD_HASH` dan
   `TEMPLATE_APPROVAL_MODE`, lalu restart.
4. Deploy console baru bersamaan (console lama akan menampilkan error 409 tanpa panduan).
5. Verifikasi E48–E58 + manual; umumkan perubahan operasional dan konsekuensi dua akun.

### 13.2 Dampak operasional (disengaja)

- Tenant dengan satu admin pada mode `two_person` **tidak dapat publish** sampai approver dibuat
  (platform untuk multi-tenant, env untuk single tenant); draft/preview/test send tetap bisa.
  Tenant dapat memilih mode longgar secara eksplisit dengan konsekuensi audit + badge.
- `PUT` legacy pada published tidak lagi auto-publish. Ini menghapus satu-satunya bypass; klien lama harus
  membuat draft. Perubahan ini perlu dicatat di release note.
- Approver dibuat di luar lane tenant (platform atau env deployment); admin tenant tidak dapat
  membuat checker-nya sendiri (mencegah kolusi).

### 13.3 Kompatibilitas

| Kombinasi | Perilaku |
|---|---|
| Backend baru + DB baru | Gate aktif |
| Backend lama + DB baru | Tabel/enum diabaikan; auto-publish lama kembali (rollback kode aman, kontrol hilang) |
| Console lama + backend baru | Publish 409 tanpa panduan UI; deploy bersamaan |
| Console baru + backend lama | Tombol review memanggil endpoint 404; halaman menampilkan error; deploy bersamaan |
| SDK lama | Tidak memanggil endpoint baru; perilaku publish tetap subject ke gate server |
| Token lama | Role `tenant_admin` tetap valid; token approver baru dibuat saat login |

### 13.4 Versi

- Root `0.11.0` → `0.12.0` (rilis), console `0.2.0` → `0.3.0`, `@notifhub/js` source → `0.5.0`
  (**tidak dipublish** di task ini), Go module tidak berubah.
- Perubahan perilaku publish = minor (bukan patch) karena ada breaking behavior pada jalur legacy.

## 14. Risiko dan batasan

| Risiko | Mitigasi |
|---|---|
| Operasional terhenti karena belum ada approver | Pre-flight 409 dengan pesan jelas, banner console, langkah provisioning terdokumentasi |
| Single tenant terkunci karena lane platform dimatikan | Jalur env `APPROVER_*` + `TEMPLATE_APPROVAL_MODE` terdokumentasi; warning startup; pilihan mode longgar eksplisit |
| Mode longgar disalahgunakan sebagai “approval off” | Tidak ada mode off; alasan wajib, audit `selfApproved`, badge permanen, dan hanya platform/env yang bisa mengubah |
| Approval fatigue / “klik setuju” tanpa membaca | Diff wajib ditampilkan sebelum aksi; catatan reject wajib; audit aktor |
| Test e2e lama banyak berubah | Helper `submitAndApprove`; perbarui bertahap dan jalankan penuh |
| Role baru membuka akses tak sengaja | Default guard `tenant_admin`; hanya rute yang didekorasi yang terbuka; unit test matriks izin |
| Diff besar memperlambat/membengkakkan respons | Batas baris/ukuran + `truncated`; rate limit |
| Approver dinonaktifkan saat ada antrean | Antrean tetap; platform menambah approver baru; tidak ada publish selama approval belum sah |
| Klien API lama memakai `PUT` published | 409 dengan panduan; dokumentasi + release note |
| Kolusi admin + approver | Di luar kendali teknis; audit + kebijakan organisasi; role immutable dan approver dibuat platform |
| Approval tabel tumbuh | Baris kecil; evaluasi retensi bersama audit (D17) |

Batasan yang diakui:

- Bukan RBAC granular; izin melekat pada dua peran tetap.
- Tidak ada approval berlapis atau approval untuk aset.
- Tidak ada notifikasi push/email ke approver di v1.
- Diff bukan pixel-diff; tampilan final tetap bergantung email client.
- Tidak ada “break-glass publish” di lane tenant. Multi-tenant: operator platform menambah
  approver; single tenant: env. Pelonggaran permanen hanya lewat mode `self_approval_allowed`.

## 15. Daftar file yang direncanakan

### Baru

| File | Isi |
|---|---|
| `prisma/migrations/<ts>_template_approval/migration.sql` | Enum mode/status, kolom `Tenant.templateApprovalMode`, tabel, index, FK, nilai audit baru |
| `src/templates/template.approval.ts` | Tipe + policy murni (mode, self-approval, stale, transisi) |
| `src/admin/services/admin-template-approvals.service.ts` | Submit/list/approve/reject/queue |
| `src/admin/controllers/admin-template-approvals.controller.ts` | Endpoint approval + antrean |
| `src/templates/template.diff.ts` | LCS baris/word + block diff |
| `src/auth/admin/admin-roles.guard.ts` + decorator | Penegakan peran default-deny |
| `test/template.approval.policy.unit-spec.ts`, `test/template.diff.unit-spec.ts`, `test/admin-roles.unit-spec.ts`, `test/admin-bootstrap.mode.unit-spec.ts` | Unit test |
| `console/src/pages/TemplateReviewPage.tsx`, `TemplateComparePage.tsx`, `components/ApprovalPanel.tsx`, `components/DiffView.tsx` | UI review + diff |
| `console/src/pages/TemplateReviewPage.test.tsx`, `TemplateComparePage.test.tsx` | Test console |
| `docs/design/templates/template-approval-diff-design.md` | Dokumen ini |

### Diubah

| File | Perubahan |
|---|---|
| `prisma/schema.prisma` | Model/enum/relasi baru |
| `src/auth/admin/admin.types.ts`, `admin-jwt.guard.ts`, `admin-auth.service.ts` | Peran approver |
| `src/admin/services/admin-templates.service.ts` | Gate publish, tolak legacy auto-publish, endpoint diff |
| `src/admin/controllers/admin-templates.controller.ts` | `submit-review`, `diff`, dekorasi peran |
| `src/platform/dto/tenant.dto.ts`, `platform-tenant-admins.service.ts`, `platform-tenants.service.ts`, controller | Role approver + `templateApprovalMode` |
| `src/auth/admin/admin-bootstrap.service.ts` | Env approver + env mode dengan precedence single tenant |
| `console/src/pages/PlatformTenantPage` (detail tenant) | Pengaturan mode + warning |
| `console/src/lib/session.ts`, `auth/ProtectedRoute.tsx`, `layout/AppLayout.tsx`, `pages/TemplateFormPage.tsx`, `App`/router | Role, navigasi, tombol review/diff, badge self-approved |
| `packages/js-sdk/src/admin-types.ts`, `templates-client.ts`, test | Tipe + method approval/diff |
| `docs/...` | Dokumentasi status dan kontrak |

## 16. Pertanyaan persetujuan

Sudah diputuskan pengguna: dua admin sebagai default (D1), semua channel (D2), maker dan approver
boleh publish setelah disetujui (D3), dan self-approval **tidak** menjadi perilaku tetap melainkan
kebijakan per tenant dengan default strict. Sisanya mohon dikonfirmasi:

1. **Jalur legacy**: setuju `PUT` pada published ditolak `409 approval_required_draft` (tidak ada
   auto-publish) (D9)?
2. **Pembuatan approver**: lane platform untuk multi-tenant dan env `APPROVER_*` untuk single
   tenant (D12/D18), bukan admin tenant? Ini mencegah admin membuat checker-nya sendiri.
3. **Approver read-only**: approver tidak boleh membuat/mengedit draft, hanya review + publish (D11)?
4. **Aktivasi/deaktivasi**: tanpa approval (D10)?
5. **Notifikasi**: v1 badge + antrean saja, email/in-app ditunda (D14)?
6. **Approval stale**: tetap tampil di antrean sampai diajukan ulang, atau otomatis disembunyikan?
   (default: tetap tampil dengan badge **stale**)
7. **Nama peran**: `tenant_approver` (default) atau `template_reviewer`?
8. **Test send oleh approver**: diizinkan (default) atau preview saja?
9. **Nilai audit baru**: empat nilai `submitted_for_review`, `approved`, `rejected`,
   `approval_reopened` (D15) — ada nilai lain yang diperlukan?
10. **Diff**: field + block + render berdampingan (D13) atau field-level saja di fase pertama?
11. **SDK**: method approval/diff ditambahkan ke source `@notifhub/js` (rilis `0.5.0`, publish
    terpisah) (D16)?
12. **Retensi approval**: tanpa cleanup di v1 (D17) atau ikut retensi 730 hari?
13. **Mode default**: `two_person` sebagai default untuk semua tenant, dan `self_approval_allowed`
    hanya bisa diaktifkan platform/env (D1)?
14. **Self-approval satu langkah**: pada mode longgar, publish langsung membuat approval
    `selfApproved` (bukan submit+approve dua langkah) — setuju (§5.4)?
15. **Syarat self-approval**: alasan wajib ≥ 20 karakter, badge **Self-approved** permanen di daftar
    dan riwayat, audit `selfApproval=true` — cukup?
16. **Single tenant**: env `APPROVER_*` + `TEMPLATE_APPROVAL_MODE`, dan env mode **diabaikan** saat
    platform admin aktif (D18) — setuju?

Semua pertanyaan di atas disetujui dengan default yang direkomendasikan; hasil implementasi dan
deviasinya dicatat di §17.

## 17. Catatan implementasi

Status: **terimplementasi dan terverifikasi** pada 2026-11-22 (default yang disetujui: dua admin,
semua channel, maker/approver boleh publish, kebijakan self-approval per tenant, single tenant via
env).

### 17.1 Yang diterapkan

| Area | Perubahan |
|---|---|
| Schema | `TemplateApprovalMode` + `Tenant.templateApprovalMode`, `TemplateApprovalStatus` + `TemplateApproval`, 4 nilai `TemplateAuditAction`, relasi `NotificationTemplate.approvals`; dua migrasi (tabel/enum/kolom + perluasan check constraint role) |
| Auth | `tenant_approver` di `admin.types.ts`; `AdminJwtGuard` menerima dua role dan membaca `@AdminRoles` (default `tenant_admin`); login/me/change-password menerima approver; `templateApprovalMode` dikirim di profil |
| Approval | `AdminTemplateApprovalsService` + controller: submit/approve/reject/list/queue; publish gate `approval_required`, `approval_pending`, `approval_rejected`, `approval_stale`, `approval_self_forbidden`, `approver_unavailable`, `self_approval_*`; audit `submitted_for_review`/`approved`/`rejected`/`approval_reopened` |
| Publish | Gate dijalankan sebelum validasi konten; self-approval satu langkah membuat approval `selfApproved=true` di transaksi publish; `PUT` published ditolak `409 approval_required_draft`; activate/deactivate tetap tanpa approval |
| Diff | `template.diff.ts` (LCS baris/word, block diff, batas) + `AdminTemplateDiffService` + `GET /admin/templates/:id/diff` dengan render dua versi dari pipeline preview |
| Platform | Role approver saat membuat admin tenant (default `tenant_admin`), kolom peran, `PATCH /platform/tenants/:id` menerima `templateApprovalMode` + audit `tenant.approval_mode.changed` |
| Bootstrap | `APPROVER_EMAIL`/`APPROVER_PASSWORD_HASH` (tenant default) dan `TEMPLATE_APPROVAL_MODE`; env mode diabaikan saat platform admin aktif; warning `template.approval.approver_missing` |
| SDK source | Tipe approval/diff + `submitReview`, `listTemplateApprovals`, `queueApprovals`, `approveApproval`, `rejectApproval`, `diffTemplate`, `publishTemplate(..., selfApprovalReason)` |
| Console | Sesi/route menerima approver; nav terpisah; halaman `/reviews` dan `/templates/:id/compare`; panel approval di editor; dialog publish meminta alasan pada mode longgar; badge self-approved |
| Test | Unit policy + diff; e2e E48–E57; helper submit/approve; test lama memakai helper; test env membuat approver dari env |

### 17.2 Deviasi dan keputusan tambahan

1. **Dua migrasi, bukan satu.** Check constraint lama `AdminUser_role_tenant_check` hanya
   mengizinkan `tenant_admin`/`platform_admin`, sehingga role approver ditolak database. Migrasi
   kedua (`20261122130000_template_approver_role_check`) memperluas constraint tanpa mengubah data.
   Total migrasi menjadi **16**.
2. **E2E E53 tidak dibuat terpisah**: legacy `PUT` pada published sudah diuji oleh E19 yang diubah
   menjadi skenario `409 approval_required_draft`. E58 (single tenant dari env) tidak dibuat sebagai
   e2e karena env dibaca saat proses start; jalur bootstrap approver terverifikasi karena seluruh
   e2e memakai approver yang dibuat dari `APPROVER_EMAIL`/`APPROVER_PASSWORD_HASH`.
3. **Token approver di e2e ditandatangani langsung** dengan `ADMIN_JWT_SECRET` (bukan login HTTP)
   agar tidak menabrak rate limit login 5/menit saat suite berjalan.
4. **Self-approval satu langkah** tidak melalui submit/approve terpisah; approval `selfApproved`
   dibuat dalam transaksi publish. Approval `pending`/`rejected` yang sudah ada tidak bisa
   ditimpa, sesuai §5.4.
5. **Deteksi stale** juga mencari approval `approved` terakhir pada baris template yang sama bila
   revisi saat ini belum punya approval, sehingga edit setelah review menghasilkan
   `approval_stale`, bukan `approval_required`.
6. **UI console baru belum punya unit test khusus**; verifikasinya lewat `console:typecheck`,
   `console:build`, dan e2e backend. Interaksi browser tetap manual (batasan repo, tanpa
   Playwright).
7. **Versi paket tidak dinaikkan** di task ini: `@notifhub/js` tetap `0.4.0` (source bertambah),
   console `0.2.0`, root `0.11.0`. Rilis/publikasi npm menunggu persetujuan terpisah.
8. **Console tidak menampilkan mode approval di halaman Akun**; mode hanya ditampilkan di platform
  console dan dipakai untuk prompt publish di tenant. Ini cukup untuk v1.

### 17.3 Bukti verifikasi

| Pemeriksaan | Hasil |
|---|---|
| `npm run ci` | lulus **217 s**: typecheck, build, **85 unit**, **56 e2e**, **16 migrasi** |
| `npm --prefix console run test` | **55 test** lulus (10 file) |
| `npm run console:typecheck` / `console:build` | lulus; tenant ±1.017 KB (setelah minify), platform 505,74 KB |
| `npm run sdk:typecheck` / `sdk:test` | lulus; 36 test |
| `npm run react:test` | 5 test lulus |
| `npm run docs:check` | lulus (lihat laporan akhir) |
| E2E approval | E48 submit/approve/publish + publish oleh approver; E49 tanpa approval + stale; E50 pemisahan peran; E51 izin approver; E52 tenant tanpa approver → platform menambah approver; E54 diff + isolasi tenant; E55 in-app; E56 approve ganda; E57 mode longgar + audit |
| E19 legacy | `PUT` published `409 approval_required_draft`, tidak ada versi baru, baris lama utuh |

### 17.4 Batasan yang tersisa

- RBAC masih dua peran tetap; belum ada permission granular atau approval berlapis.
- Tidak ada notifikasi email/in-app ke approver; hanya badge/antrean di console.
- Approval tidak berlaku untuk aset layout/theme/partial dan tidak untuk deaktivasi/aktivasi.
- Tidak ada break-glass publish di lane tenant; pelonggaran hanya lewat platform (multi-tenant)
  atau env (single tenant).
- Console halaman review/compare belum diuji dengan browser automation; verifikasi UI manual.
- SDK source berubah tetapi belum dirilis; konsumen npm belum mendapat method approval/diff.
