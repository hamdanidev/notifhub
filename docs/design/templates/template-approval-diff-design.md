# Approval maker-checker dan diff versi template

Status: **draf — menunggu persetujuan; belum diimplementasikan** (2026-11-22).
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
  Self-approval tidak diizinkan.
- Berlaku untuk **semua channel** (email, in-app, WhatsApp, SMS).
- Setelah disetujui, **maker dan approver** sama-sama boleh menekan publish.

## 2. Ruang lingkup

### Termasuk

1. Peran tenant baru `tenant_approver` dengan izin terbatas (review, approve/reject, publish,
   preview/test send, diff) tanpa izin mengubah template atau mengelola resource admin lain.
2. Tabel `TemplateApproval` per `(templateId, revision)` + status dan audit.
3. Gate publish di server: tidak ada publish tanpa approval valid untuk revisi terkini.
4. Endpoint submit/approve/reject/queue/read approvals dan endpoint diff.
5. UI console: tombol **Ajukan review**, halaman **Review** (antrean), panel **Setujui/Tolak**,
   halaman **Bandingkan versi** dengan diff field + block + render berdampingan.
6. Pembuatan akun approver lewat lane platform (role eksplisit) dan bootstrap dev opsional.
7. Perubahan guard/izin agar approver hanya dapat mengakses endpoint yang diizinkan.
8. Test unit, e2e baru, pembaruan e2e lama yang memanggil publish, test console, dokumentasi.

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
| D1 | Syarat publish | Tenant harus punya **≥1 `tenant_admin` aktif dan ≥1 `tenant_approver` aktif**; publish hanya bila revisi terkini punya approval `approved` dari approver yang berbeda dari pengaju |
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
| D12 | Pembuatan approver | Hanya lane platform (`POST /platform/tenants/:id/admins` dengan `role`); role immutable di v1; bootstrap opsional `APPROVER_EMAIL`/`APPROVER_PASSWORD_HASH` untuk tenant default |
| D13 | Diff | Field-level (LCS), block-level dari `builderData`, dan render side-by-side dari pipeline preview; tanpa dependency baru |
| D14 | Notifikasi approver | v1: badge jumlah pending + halaman antrean (polling 60 detik); email/in-app ditunda |
| D15 | Audit | `TemplateAuditAction` ditambah `submitted_for_review`, `approved`, `rejected`, `approval_reopened`; detail juga di `TemplateApproval` |
| D16 | SDK | Tambah tipe + method approval/diff ke `@notifhub/js` source (rilis minor berikutnya); publikasi npm terpisah |
| D17 | Retensi | `TemplateApproval` tanpa cleanup otomatis di v1 (baris kecil, bagian audit); evaluasi bersama retensi audit |

Alternatif yang ditolak:

| Opsi | Alasan |
|---|---|
| Menambah status template `pending_approval` | Menyentuh worker, query publish/activate, DTO, console, legacy; risiko regresi besar tanpa manfaat tambahan |
| Self-approval dengan flag audit | Bertentangan dengan keputusan “wajib dua admin” dan melemahkan kontrol |
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

1. `CREATE TYPE "TemplateApprovalStatus"`.
2. `ALTER TYPE "TemplateAuditAction" ADD VALUE ...` (empat nilai).
3. `CREATE TABLE "TemplateApproval"` + unique + index + FK cascade ke `NotificationTemplate`.
4. Tidak ada backfill dan tidak ada perubahan baris lama.

Jumlah migrasi menjadi **15** (dari 14). Rollback schema tidak diperlukan untuk rollback kode: kode
lama mengabaikan tabel dan nilai enum baru.

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
3. **Gate approval**:
   - approver aktif ada di tenant? jika tidak → `409 approver_unavailable`.
   - approval untuk `(templateId, revision)` ada? jika tidak → `409 approval_required`.
   - status approval: `pending` → `409 approval_pending`; `rejected` → `409 approval_rejected`.
   - `approved` tetapi `approval.revision !== existing.revision` → `409 approval_stale`
     (seharusnya tidak terjadi karena unique per revisi; tetap diperiksa).
   - pengaju = reviewer → `409 approval_self_forbidden` (pertahanan berlapis).
4. Validasi konten (HTML, variabel, builder) seperti sekarang.
5. Transaksi publish + audit `published` dengan `metadata.approvalId`.

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
| POST | `/templates/:id/publish` | keduanya | Gate approval lalu publish |

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

Error baru (HTTP `409`):

| Kode | Arti |
|---|---|
| `approver_unavailable` | Tenant belum punya approver aktif |
| `approval_required` | Belum ada pengajuan untuk revisi ini |
| `approval_pending` | Masih menunggu review |
| `approval_rejected` | Ditolak; ajukan ulang atau ubah draft |
| `approval_stale` | Approval milik revisi lain (draft berubah setelah review) |
| `approval_self_forbidden` | Pengaju dan penyetuju akun yang sama |

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
| Banner | Bila tenant belum punya approver: “Publish memerlukan akun approver. Minta operator platform menambahkan.” |
| Guard UI | Tombol write disembunyikan untuk approver; server tetap otoritatif (UI bukan pengaman) |

### 8.5 Perubahan lane platform

- `CreateTenantAdminDto`/`UpdateTenantAdminDto` menerima `role` opsional (`tenant_admin` |
  `tenant_approver`, default `tenant_admin` agar kompatibel).
- `PlatformTenantAdminsService.list` mengembalikan kedua peran (filter `role` opsional).
- `assertNotLastActiveAdmin` hanya berlaku untuk `tenant_admin`; approver boleh dinonaktifkan
  (konsekuensinya publish berhenti sampai approver baru dibuat).
- Console platform: kolom **Peran** di daftar admin dan pilihan peran saat menambah admin.
- Provisioning tenant tetap membuat satu `tenant_admin`; approver ditambahkan sebagai langkah
  kedua (langkah operator, terdokumentasi). Alasan: approver harus dibuat pihak platform agar
  independen dari admin tenant.

### 8.6 Bootstrap dan data dev

- Env opsional baru: `APPROVER_EMAIL`, `APPROVER_PASSWORD_HASH` (tenant default). Bila diisi,
  bootstrap membuat/menyinkronkan akun `tenant_approver` dengan pola `bootstrapPasswordHash` yang
  sama seperti admin. Bila kosong: warning saat startup bahwa publish template akan ditolak sampai
  approver dibuat.
- `.env.example` dan `.env.prod.example` ditambah komentar; hash dibuat dengan
  `npm run admin:hash-password`.
- Seed dev tidak membuat approver dengan password hard-coded; dokumentasi local setup menjelaskan
  cara mengisi env atau membuat approver lewat lane platform.

## 9. Kasus tepi dan kebijakan

| Kasus | Perilaku |
|---|---|
| Tenant hanya punya satu admin | Submit/publish `409 approver_unavailable`; UI menampilkan instruksi; tidak ada self-approval |
| Pengaju mencoba approve | `409 approval_self_forbidden` (role approver memang tidak bisa submit; cek tetap ada sebagai pertahanan) |
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
2. **Pemisahan tugas**: pengaju ≠ penyetuju; approver tidak punya izin tulis; role immutable.
3. **Tidak ada bypass**: publish gate dipakai di semua jalur publish; legacy PUT ditolak; tidak
   ada flag runtime yang mematikan gate.
4. **Tenant isolation**: semua query approval/diff memakai `tenantId` dari JWT; ID tenant lain →
   `404` (pola yang ada).
5. **Diff aman**: HTML hanya masuk `srcDoc` iframe `sandbox=""`; teks field dirender React tanpa
   `dangerouslySetInnerHTML`; pipeline preview sudah menyisipkan CSP dan sanitizer.
6. **Payload**: catatan maks 500 karakter; paginasi dibatasi; diff dibatasi ukuran/baris; rate limit
   submit/approve/diff (mis. 60/menit per admin) untuk mencegah abuse.
7. **Log**: tidak ada body template/catatan lengkap di log; hanya ID, versi, revisi, status, aktor.
8. **Audit**: setiap transisi approval menulis `TemplateAuditEvent`; `TemplateApproval` menyimpan
   jejak minimal (email aktor, waktu, status).
9. **Break-glass**: jalur darurat satu-satunya adalah operator platform menambah/mengaktifkan
   approver (audited di `PlatformAuditEvent`), bukan bypass publish. Tidak ada “super admin
   publish” di lane tenant.

## 11. Dampak ke kode yang ada

| Area | Perubahan |
|---|---|
| Schema | Enum `TemplateApprovalStatus`, tabel `TemplateApproval`, 4 nilai `TemplateAuditAction`, relasi di `NotificationTemplate`; migrasi ke-15 |
| Auth | `admin.types.ts` konstanta role approver; `AdminJwtGuard` menerima dua peran; `AdminRolesGuard` + `@AdminRoles`; `AdminAuthService` menerima approver |
| Template publish | Gate di `publish`; `updatePublishedViaNewVersion` menolak; ekstraksi helper `assertPublishApproval` |
| Approval service | Modul/controller/service baru untuk submit/list/approve/reject/queue |
| Diff | Service diff murni + endpoint baca di controller template; render lewat `AdminTemplatePreviewService` |
| Platform | DTO/role, service, controller, console platform (kolom + form peran) |
| Bootstrap | Env approver opsional + warning |
| Console | Sesi/role, ProtectedRoute, navigasi, TemplateFormPage, halaman Review + Compare, tes |
| SDK | `admin-types.ts` (status/approval/diff types), `templates-client.ts` (submit/list/approve/reject/diff) di source; versi minor berikutnya |
| Dokumentasi | `admin-api.md`, `multi-tenant-platform-admin.md`, `template-system-design.md` (§9/§18), `project-brief` §6–§7, roadmap §14.4, `configuration.md`, README indeks |

Tidak berubah: worker, renderer, sanitizer, provider, `openapi/notifhub.json` konsumen, Go module,
tiga lane auth (hanya penambahan peran di lane tenant), dan perilaku published immutable.

## 12. Rencana test dan verifikasi

### 12.1 Unit test baru

1. **Policy approval** (`template.approval.policy.unit-spec.ts`): syarat approver aktif, revisi
   cocok, self-approval, status transition, stale, reject note wajib.
2. **Diff** (`template.diff.unit-spec.ts`): LCS baris (added/removed/equal), word diff, block diff
   (added/removed/changed), truncation, versi tanpa `builderData`.
3. **Guard/roles** (`admin-roles.unit-spec.ts`): default deny untuk approver, rute yang diizinkan,
   role tidak dikenal.

### 12.2 E2E baru (E48–E56)

| ID | Skenario | Ekspektasi |
|---|---|---|
| E48 | Maker submit → approver approve → maker publish (email) | 201/200/200; `TemplateApproval` approved; audit submitted/approved/published; worker mengirim |
| E49 | Publish tanpa approval; publish setelah draft diedit | `409 approval_required`; edit → `409 approval_stale` |
| E50 | Self-approval & izin silang | Approver tidak bisa submit (403); maker tidak bisa approve (403); approve oleh akun pengaju ditolak |
| E51 | Isolasi peran approver | Approver bisa list/preview/diff/test send; create/update/delete template, aset, API key, subscriber → 403 |
| E52 | Tenant tanpa approver | Submit/publish `409 approver_unavailable`; setelah platform menambah approver, alur E48 berhasil |
| E53 | Legacy PUT pada published | `409 approval_required_draft`; `activate`/deactivate tetap 200 |
| E54 | Diff dua versi | Field/block/rendered terisi; versi beda grup `400`; tenant lain `404` |
| E55 | Semua channel | Approval + publish untuk in-app (dan WhatsApp teks) tunduk gate yang sama |
| E56 | Konkurensi | Approve kedua `409 approval_not_pending`; approve saat revisi berubah `409 approval_revision_mismatch` |

### 12.3 E2E lama yang harus diperbarui

Semua test yang memanggil publish harus memakai helper `submitAndApprove(templateId)` memakai akun
approver: E12, E13, E14, E19 (berubah menjadi skenario 409), E20, E26, E28, dan varian E15/E16 yang
memerlukan template published. Jumlah e2e menjadi **47 + 9 = 56**.

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
7. Tenant tanpa approver → pesan 409 dan banner console.
8. Approver mencoba edit template/API key → 403 dan tombol tidak tampil.
9. Cek log tidak memuat body/catatan lengkap.

### 12.6 Regresi wajib

`npm run ci` (target: unit bertambah, e2e 56, migrasi 15), `console:test/typecheck/build`,
`sdk:typecheck/test`, `react:test`, `docs:check`, dan GitHub Actions hijau.

## 13. Migrasi, rollout, dan kompatibilitas

### 13.1 Urutan rollout

1. Masuk fase persetujuan dokumen ini (keputusan §16).
2. Migrasi aditif (tabel + enum) → deploy backend.
3. Operator platform menambahkan approver untuk setiap tenant yang akan publish, atau mengisi
   `APPROVER_EMAIL`/`APPROVER_PASSWORD_HASH` untuk tenant default.
4. Deploy console baru bersamaan (console lama akan menampilkan error 409 tanpa panduan).
5. Verifikasi E48–E56 + manual; umumkan perubahan operasional.

### 13.2 Dampak operasional (disengaja)

- Tenant dengan satu admin **tidak dapat publish** sampai approver dibuat. Ini konsekuensi langsung
  dari keputusan “wajib dua admin”; draft/preview/test send tetap bisa.
- `PUT` legacy pada published tidak lagi auto-publish. Ini menghapus satu-satunya bypass; klien lama harus
  membuat draft. Perubahan ini perlu dicatat di release note.
- Approver harus dibuat oleh operator platform; admin tenant tidak dapat membuat checker-nya
  sendiri (mencegah kolusi).

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
- Tidak ada break-glass publish; satu-satunya jalur darurat adalah menambah approver.

## 15. Daftar file yang direncanakan

### Baru

| File | Isi |
|---|---|
| `prisma/migrations/<ts>_template_approval/migration.sql` | Enum, tabel, index, FK, nilai audit baru |
| `src/templates/template.approval.ts` | Tipe + policy murni (self-approval, stale, transisi) |
| `src/admin/services/admin-template-approvals.service.ts` | Submit/list/approve/reject/queue |
| `src/admin/controllers/admin-template-approvals.controller.ts` | Endpoint approval + antrean |
| `src/templates/template.diff.ts` | LCS baris/word + block diff |
| `src/auth/admin/admin-roles.guard.ts` + decorator | Penegakan peran default-deny |
| `test/template.approval.policy.unit-spec.ts`, `test/template.diff.unit-spec.ts`, `test/admin-roles.unit-spec.ts` | Unit test |
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
| `src/platform/dto/tenant.dto.ts`, `platform-tenant-admins.service.ts`, controller | Role approver |
| `src/auth/admin/admin-bootstrap.service.ts` | Env approver opsional |
| `console/src/lib/session.ts`, `auth/ProtectedRoute.tsx`, `layout/AppLayout.tsx`, `pages/TemplateFormPage.tsx`, `App`/router | Role, navigasi, tombol review/diff |
| `packages/js-sdk/src/admin-types.ts`, `templates-client.ts`, test | Tipe + method approval/diff |
| `docs/...` | Dokumentasi status dan kontrak |

## 16. Pertanyaan persetujuan

Sudah diputuskan pengguna: wajib dua admin (D1), semua channel (D2), maker dan approver boleh
publish setelah disetujui (D3). Sisanya mohon dikonfirmasi:

1. **Jalur legacy**: setuju `PUT` pada published ditolak `409 approval_required_draft` (tidak ada
   auto-publish) (D9)?
2. **Pembuatan approver**: hanya lewat lane platform (D12), bukan admin tenant? Ini mencegah admin
   membuat checker-nya sendiri, tetapi menambah langkah operator.
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

Setelah disetujui, urutan implementasi: schema + migrasi → policy + guard/role → approval service +
gate publish → diff service/endpoint → platform role → console UI → SDK source → test e2e +
perbaikan test lama → dokumentasi dan verifikasi end-to-end.

## 17. Catatan implementasi

Belum diimplementasikan. Setelah disetujui, bagian ini diisi perubahan aktual, deviasi, bukti
verifikasi (status code, isi DB, test), dan batasan yang tersisa.
