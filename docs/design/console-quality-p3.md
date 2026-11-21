# Kualitas console P3: test, SDK, dan retensi audit

Status: **P3a–P3c terimplementasi dan terverifikasi** (2026-11-20). Lihat §11–§13.
Basis: `docs/design/console-operations-p2.md` §15, `docs/design/console-admin-hardening.md` §16,
`console/`, `packages/js-sdk/`, `src/cleanup/cleanup.service.ts`, dan `.github/workflows/ci.yml`.

**Isi dokumen**

- [1. Latar belakang](#1-latar-belakang)
- [2. Ruang lingkup dan fase](#2-ruang-lingkup-dan-fase)
- [3. Test console (P3a)](#3-test-console-p3a)
- [4. Konsolidasi SDK (P3b)](#4-konsolidasi-sdk-p3b)
- [5. Retensi audit admin (P3c)](#5-retensi-audit-admin-p3c)
- [6. Daftar file](#6-daftar-file)
- [7. Verifikasi](#7-verifikasi)
- [8. Keputusan](#8-keputusan)
- [9. Risiko dan batasan](#9-risiko-dan-batasan)
- [10. Pertanyaan persetujuan](#10-pertanyaan-persetujuan)
- [11. Catatan implementasi P3a](#11-catatan-implementasi-p3a)
- [12. Catatan implementasi P3b](#12-catatan-implementasi-p3b)
- [13. Catatan implementasi P3c](#13-catatan-implementasi-p3c)

---

## 1. Latar belakang

P1 dan P2 menambah banyak perilaku console (password, search, export, resend all, audit, compose)
tetapi belum ada test frontend otomatis. Selain itu, lima endpoint console memakai wrapper
`HttpTransport` lokal karena `@notifhub/js` terbit belum memilikinya, dan `AdminAuditEvent` tumbuh
tanpa retensi. P3 menutup tiga hal ini.

## 2. Ruang lingkup dan fase

| Fase | Isi | Dependency baru | Risiko |
|---|---|---|---|
| **P3a** | Test unit/komponen console (Vitest + jsdom + Testing Library) dan jalankan di CI | dev-only | rendah |
| **P3b** | Pindahkan wrapper P1/P2 ke `@notifhub/js`, pakai `adminClient` di console | tidak | sedang |
| **P3c** | Retensi `AdminAuditEvent` + job cleanup + test | tidak | rendah |

Tidak termasuk: Playwright/browser matrix, visual regression, publikasi npm otomatis, RBAC, dan
perubahan perilaku produk.

## 3. Test console (P3a)

### 3.1 Tooling

- **Vitest** + **jsdom** + **@testing-library/react** + **@testing-library/jest-dom** sebagai
  devDependency console.
- Tanpa Playwright: browser automation penuh menambah unduhan browser dan waktu CI; kebutuhan
  regresi utama (helper, dialog, session) bisa ditutup dengan jsdom.
- Konfigurasi terpisah `console/vitest.config.ts` (environment `jsdom`, setup file, plugin React)
  agar `vite.config.ts` build tidak berubah.
- Script console: `test` = `vitest run`; CI job `packages` menambahkan langkah
  `npm --prefix console run test` setelah typecheck.

### 3.2 Cakupan test

| File | Test |
|---|---|
| `console/src/lib/adminExport.test.ts` | CSV quoting, prefix formula (`=`, `+`, `-`, `@`), filename, empty rows |
| `console/src/lib/session.test.ts` | save/load/expiry/corrupt sessionStorage; kunci tenant |
| `console/src/lib/format.test.ts` | `describeError`, tanggal/relative time |
| `console/src/components/ResendDialog.test.tsx` | teks failed vs all, peringatan duplikasi, tombol disabled saat busy |
| `console/src/pages/AuditPage.test.tsx` (opsional) | render tabel + empty state dengan query client/provider |

Tidak menguji halaman yang membutuhkan jaringan nyata; itu tetap ditutup E2E backend.

### 3.3 CI

- Job `packages`: `npm --prefix console ci`; `console:typecheck`; `console:test`; `console:build`.
- Tanpa perubahan job backend/docker.

## 4. Konsolidasi SDK (P3b)

### 4.1 Metode yang dipindahkan

Tambahkan ke `NotifHubAdminClient` + tipe di `packages/js-sdk/src`:

| Metode | Menggantikan wrapper |
|---|---|
| `changePassword(currentPassword, newPassword)` | `console/src/lib/adminAccount.ts` |
| `resendNotification(id, { mode, requestKey })` | `console/src/lib/adminResend.ts` |
| `exportNotifications(query)` | `console/src/lib/adminExport.ts` bagian fetch |
| `listAudit(query)` | `console/src/lib/adminAudit.ts` |
| `composeNotification(input)` | `console/src/lib/adminCompose.ts` |

- `adminTemplates.ts` dan `platformClient.ts` tetap lokal pada P3 ini karena surface-nya besar dan
  belum stabil; dicatat sebagai lanjutan. **Lanjutan 2026-11-21:** keduanya sudah dipindahkan ke
  `NotifHubTemplatesClient` dan `NotifHubPlatformClient` di SDK; lihat
  `docs/design/console-sdk-consolidation.md`.
- Console mengganti import ke `adminClient` dan menghapus lima wrapper.
- `@notifhub/js` dinaikkan ke **0.3.1** di source dan package console tetap memakai workspace
  (`file:../packages/js-sdk`).
- Publikasi npm **tidak** dilakukan otomatis. Verifikasi `npm pack` + isi tarball; publish hanya
  jika kredensial npm tersedia dan disetujui terpisah.

### 4.2 Verifikasi

- `sdk:typecheck`, `sdk:test`, `sdk:build`.
- `console:typecheck`, `console:test`, `console:build`.
- Grep memastikan tidak ada import wrapper yang dihapus.

## 5. Retensi audit admin (P3c)

- Env baru `ADMIN_AUDIT_RETENTION_DAYS` (non-negative, default **730**; `0` menonaktifkan).
- Tambah ke `src/config/env.schema.ts`, `.env.example`, `.env.prod.example`, dan
  `docs/getting-started/configuration.md`.
- `CleanupService` mendapat method `runAdminAuditCleanup()`:
  - cron `45 3 * * *` UTC (setelah template telemetry),
  - hapus `AdminAuditEvent` dengan `occurredAt < now - days` dalam batch (mis. 1.000) sampai habis,
  - `0` → skip; log jumlah terhapus dan cutoff, tanpa metadata event,
  - flag `auditRunning` mencegah overlap.
- Test E45: buat event berumur >730 hari (atau set env test 1 hari + event 2 hari), panggil method
  cleanup, pastikan event lama terhapus dan event baru tetap ada; `0` tidak menghapus.
- Dokumentasi: `docs/design/console-operations-p2.md` §14 (catatan retensi), `production-readiness`.

## 6. Daftar file

| Area | File |
|---|---|
| Test console | `console/package.json`, `console/package-lock.json`, `console/vitest.config.ts`, `console/src/test/setup.ts`, `console/src/lib/*.test.ts`, `console/src/components/ResendDialog.test.tsx` |
| CI | `.github/workflows/ci.yml` (langkah `console:test`) |
| SDK | `packages/js-sdk/src/admin-client.ts`, `admin-types.ts`, `package.json`; hapus 5 wrapper console |
| Audit retention | `src/config/env.schema.ts`, `src/cleanup/cleanup.service.ts`, `.env.example`, `.env.prod.example`, `docs/getting-started/configuration.md`, `test/app.e2e-spec.ts`, `test/admin-audit.cleanup.unit-spec.ts` |
| Docs | `docs/design/console-quality-p3.md`, `docs/README.md`, `docs/design/README.md`, `docs/architecture/project-brief.md`, `docs/operations/production-readiness.md` |

## 7. Verifikasi

- `npm --prefix console run test` (semua test baru) dan `console:typecheck`/`console:build`.
- `npm run sdk:typecheck`, `sdk:test`, `sdk:build`.
- `npm run ci` (44+ e2e, termasuk E45 cleanup), `npm run docs:check`.
- CI YAML: langkah console test terdaftar; `js-yaml` parse.
- Tanpa perubahan kontrak HTTP publik; `openapi:export` tidak berubah.

## 8. Keputusan

| # | Keputusan | Default |
|---|---|---|
| D1 | Vitest + jsdom + Testing Library sebagai devDependency console | Ya |
| D2 | Tanpa Playwright/browser matrix pada P3 | Ya |
| D3 | Test fokus helper/dialog/session; halaman jaringan tetap E2E backend | Ya |
| D4 | Pindahkan 5 method P1/P2 ke SDK; wrapper template/platform tetap | Ya |
| D5 | Versi SDK source `0.3.1`; publish npm terpisah dan tidak otomatis | Ya |
| D6 | `ADMIN_AUDIT_RETENTION_DAYS` default 730, `0` menonaktifkan | Ya |
| D7 | Cleanup audit cron 03:45 UTC, batch, log count tanpa metadata | Ya |
| D8 | Eksekusi P3a → P3b → P3c, commit/verifikasi per fase | Ya |

## 9. Risiko dan batasan

1. **Dependency dev baru** menambah ukuran `node_modules` dan waktu CI; diterima karena test
   frontend tidak mungkin dijalankan tanpa runner/DOM.
2. **jsdom bukan browser nyata**; layout/CSS tidak diuji.
3. **SDK source berubah tanpa publikasi langsung**: konsumen npm tetap 0.3.0 sampai publish;
   console memakai workspace.
4. **Retensi menghapus audit**; default 730 hari dan `0` sebagai kill switch. Backup tetap
   tanggung jawab operator.
5. **P3 tidak menutup RBAC, billing, atau template P2.**

## 10. Pertanyaan persetujuan

1. Setuju menambah **Vitest + jsdom + Testing Library** sebagai devDependency console (D1–D3)?
2. Setuju memindahkan 5 method P1/P2 ke SDK source dan menunda publish npm (D4–D5)?
3. Setuju retensi audit default **730 hari** + cleanup 03:45 UTC (D6–D7)?
4. Setuju urutan **P3a → P3b → P3c** (D8)?

Setelah disetujui, implementasi dimulai dari P3a dan berhenti di commit/verifikasi fase tersebut
sebelum P3b.

## 11. Catatan implementasi P3a

P3a (test console) selesai dan terverifikasi pada 2026-11-20; P3b/P3c dikerjakan pada fase
berikutnya (lihat §12–§13).

Yang sudah berjalan:

- DevDependency console: `vitest 5.1.1`, `jsdom 31`, `@testing-library/react 16.3.3`,
  `@testing-library/dom`, `@testing-library/jest-dom`; tanpa Playwright.
- `console/vitest.config.ts` (environment jsdom, setup, plugin React) dan
  `console/src/test/setup.ts` (jest-dom matchers + cleanup).
- Script `test` (`vitest run`) dan `test:watch`.
- 4 file test / **18 test**: CSV export (formula/quotes/newline/filename), session storage
  (valid/expired/corrupt/clear), format helper, dialog resend (failed/all/busy/error/kosong).
- CI job `packages` menambahkan langkah **Console tests**.

Verifikasi:

| Pemeriksaan | Hasil |
|---|---|
| `npm --prefix console run test` | **18 test** lulus (4 file, ~3 detik) |
| `npm run console:typecheck` | lulus (termasuk file test) |
| `npm run console:build` | lulus |
| `npm run ci` | lulus 73 s; backend 44 e2e/29 unit; console 18 test dijalankan terpisah |
| `npm run docs:check` | lulus |

Catatan:

1. Test memakai jsdom, bukan browser nyata; layout/CSS tidak diuji.
2. Halaman yang membutuhkan jaringan tetap ditutup E2E backend; komponen dialog/helper diuji unit.
3. Dependency baru hanya dev; bundle produksi tidak berubah.
4. P3b (SDK) dan P3c (retensi audit) menyusul; lihat §12–§13.

## 12. Catatan implementasi P3b

P3b (konsolidasi SDK) selesai dan terverifikasi pada 2026-11-20; P3c menyusul pada fase
berikutnya (lihat §13).

Yang sudah berjalan:

- `NotifHubAdminClient` mendapat `changePassword`, `resendNotification`, `exportNotifications`,
  `listAudit`, dan `composeNotification`, dengan tipe `ResendMode`, `ExportNotificationRow`,
  `AdminAuditEvent`, `ComposeNotificationInput`, dan kawan-kawan diekspor dari paket.
- Console menghapus `adminAccount.ts`, `adminResend.ts`, `adminAudit.ts`, dan `adminCompose.ts`;
  `adminExport.ts` hanya menyisakan builder CSV/download dan memakai tipe SDK.
- Semua pemanggilan memakai `adminClient`; tidak ada wrapper `HttpTransport` untuk lima method ini.
- Versi source `@notifhub/js` menjadi **0.3.1**; package console tetap memakai workspace
  `file:../packages/js-sdk`. Publish npm belum dilakukan.

Verifikasi:

| Pemeriksaan | Hasil |
|---|---|
| `npm run sdk:typecheck` + `sdk:test` | lulus; **25** test (2 test baru untuk method admin) |
| `npm run sdk:build` | lulus; `dist/index.d.ts` memuat lima method |
| `npm pack --workspace @notifhub/js` | `notifhub-js-0.3.1.tgz` (8 file, 48.127 byte); method ada di `.d.ts` |
| `npm run console:typecheck` / `console:test` / `console:build` | lulus; 18 test console |
| `grep` wrapper yang dihapus | tidak ada import tersisa |
| `npm run ci` / `npm run docs:check` | `ci` lulus 59 s (44 e2e/29 unit); docs 491 tautan lulus |

Catatan:

1. **Belum publish npm pada saat P3b.** Registry saat itu masih `0.3.0`; konsumen npm baru mendapat
   lima method ini setelah rilis patch. **Realisasi 2026-11-21:** `0.3.1` sudah terbit; lihat
   `docs/sdk/npm-publishing.md` §12.
2. `adminTemplates.ts` dan `platformClient.ts` awalnya tetap lokal; keduanya dipindahkan ke SDK pada
   2026-11-21 (`docs/design/console-sdk-consolidation.md`) sehingga paket source `0.3.1` memuat
   surface template v2 dan platform.
3. Tipe export menambah `ExportNotificationsQuery` (termasuk `offset` dari `ListQuery`) meskipun
   endpoint export tidak memakai offset; nilai itu tidak dikirim oleh console.
4. Tidak ada perubahan kontrak HTTP; hanya pemindahan pemanggilan ke SDK.

## 13. Catatan implementasi P3c

P3c (retensi audit admin) selesai dan terverifikasi pada 2026-11-20.

Yang sudah berjalan:

- Env `ADMIN_AUDIT_RETENTION_DAYS` (integer ≥ 0, default **730**, `0` menonaktifkan) masuk
  `src/config/env.schema.ts`, `.env.example`, `.env.prod.example`, dan
  `docs/getting-started/configuration.md`.
- `CleanupService.runAdminAuditCleanup()` dijadwalkan cron `45 3 * * *` UTC (nama job
  `admin-audit-cleanup`) dengan flag `adminAuditRunning`; event dihapus per batch 1.000
  (`deleteMany` by id) sampai tidak ada lagi baris dengan `occurredAt < now - days`.
- Log terstruktur `admin.audit.cleanup` berisi `retention_days`, `cutoff` (`null` saat `0`), dan
  `deleted`; tidak ada metadata event, actor, atau target yang dicatat.
- E45 membuat event berumur 800 hari dan event baru, memastikan event lama terhapus, event baru
  tetap ada, dan pemanggilan kedua idempoten (`deleted: 0`).
- Unit test branch `0` memastikan tidak ada query/penghapusan dan log skip tetap ditulis.

Verifikasi:

| Pemeriksaan | Hasil |
|---|---|
| `npm run test:unit` | **30** test lulus (29 baseline + 1 test retensi `0`) |
| `npm run test:e2e` | **45** test lulus; E45 lulus |
| `npm run ci` | lulus 60 s: typecheck, build, 30 unit, 45 e2e, 14 migrasi, `Database schema is up to date!` |
| `npm run docs:check` | lulus (492 tautan/anchor, 41 file) |
| Perubahan schema/migrasi | tidak ada (tetap 14 migrasi) |

Catatan:

1. Retensi bersifat global (semua tenant) dan permanen; tidak ada soft delete untuk
   `AdminAuditEvent`. Backup/arsip sebelum retensi tetap tanggung jawab operator.
2. `0` adalah kill switch: event lama tetap tersimpan dan tabel dapat tumbuh tanpa batas.
3. Filter cleanup hanya memakai `occurredAt`; index yang ada berawalan `tenantId`
   (`[tenantId, occurredAt]`), sehingga pembersihan massal dapat memakai sequential scan pada tabel
   besar. Tidak ada migrasi index baru pada P3c untuk menjaga jumlah migrasi tetap 14.
4. Job berjalan 45 menit setelah template telemetry dan tidak membaca isi baris; aman untuk log
   produksi.
5. Tidak ada perubahan kontrak HTTP atau perilaku console; P3c hanya menambah lifecycle job.
