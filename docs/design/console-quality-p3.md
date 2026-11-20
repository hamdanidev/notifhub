# Kualitas console P3: test, SDK, dan retensi audit

Status: **draf desain, menunggu persetujuan** (2026-11-20). Belum ada implementasi.
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
  belum stabil; dicatat sebagai lanjutan.
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
| Audit retention | `src/config/env.schema.ts`, `src/cleanup/cleanup.service.ts`, `.env.example`, `.env.prod.example`, `docs/getting-started/configuration.md`, `test/app.e2e-spec.ts` |
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
