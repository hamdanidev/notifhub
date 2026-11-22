# Dokumentasi NotifHub

Titik masuk dokumentasi untuk developer yang baru clone repo ini. Pilih jalur baca di bawah,
lalu ikuti tautannya; setiap dokumen bisa dibaca berdiri sendiri.

> Kontrak HTTP yang berlaku selalu `GET /api/docs-json` (Swagger), bukan dokumentasi ini. Bila
> dokumen dan kode berbeda, kode menang — bagian **Catatan implementasi** di setiap dokumen desain
> mencatat deviasi yang sudah diketahui.

## Jalur baca

| Saya ingin… | Baca berurutan |
|---|---|
| Menjalankan NotifHub di laptop | [local setup](getting-started/local-setup.md) → [configuration](getting-started/configuration.md) → [architecture overview](architecture/overview.md) |
| Memahami cara kerja sistem | [architecture overview](architecture/overview.md) → [project brief](architecture/project-brief.md) → [indeks desain](design/README.md) |
| Mengirim notifikasi dari aplikasi saya | [usage: konsep](usage/README.md) → [integration](usage/integration.md) → [admin API](design/admin-api.md) §5–§6 |
| Menampilkan in-app / preference center | [end-user](usage/end-user.md) → [in-app](design/in-app.md) → [preference center](design/preference-center.md) |
| Mengelola tenant lewat console / admin API | [admin dan operasi](usage/admin-and-operations.md) → [React dan console](design/react-and-console.md) |
| Mengelola tenant lintas tenant (provisioning, suspend, audit) | [platform admin](usage/platform-admin.md) → [desain multi-tenant](design/multi-tenant-platform-admin.md) |
| Deploy, CI, dan observability | [production readiness](operations/production-readiness.md) → [local setup: Docker smoke stack](getting-started/local-setup.md#run-the-docker-smoke-stack) |
| Deploy satu tenant (tanpa platform console) | [panduan single tenant](operations/single-tenant-deployment.md) → [production readiness](operations/production-readiness.md) |
| Mengubah template email | [sistem template](design/templates/template-system-design.md) → [block builder](design/templates/email-block-builder-design.md) → [impor HTML](design/templates/html-import-design.md) → [roadmap batasan](design/templates/template-limitations-roadmap.md) |
| Merilis SDK | [publikasi npm](sdk/npm-publishing.md) · [Go SDK](sdk/go-sdk.md) |
| Ada yang gagal | [troubleshooting](getting-started/troubleshooting.md) |

## Peta folder

| Folder | Isi | Pembaca utama |
|---|---|---|
| `getting-started/` | Menjalankan, mengonfigurasi, dan memecahkan masalah di lokal | Developer baru |
| `architecture/` | Gambaran komponen dan alur; brief kondisi proyek | Maintainer |
| `design/` | Dokumen desain per fitur: keputusan, kontrak, verifikasi, catatan implementasi | Maintainer |
| `usage/` | Panduan memakai API/SDK dari sisi konsumen | Integrator |
| `sdk/` | Desain dan proses rilis SDK (npm, Go) | Maintainer SDK |
| `operations/` | Test, image Docker, CI, dan kesiapan rilis | Operator |

Dokumen desain disusun per fitur dan **tidak** mengikuti nomor urut pekerjaan, jadi urutan
tanggal di dalamnya bukan urutan baca. Semua desain terindeks di [design/README.md](design/README.md).

## Daftar dokumen

### Getting started

| Dokumen | Isi |
|---|---|
| [local-setup.md](getting-started/local-setup.md) | Prasyarat, langkah menjalankan, test e2e, dan verifikasi manual per fitur (in-app/SSE, email, preferensi, webhook, admin API, console, WhatsApp, Go SDK, Docker) |
| [configuration.md](getting-started/configuration.md) | Referensi semua environment variable: default, aturan validasi, dan syarat per mode |
| [troubleshooting.md](getting-started/troubleshooting.md) | Gejala umum → penyebab → perbaikan, dari startup sampai kirim notifikasi |

### Architecture

| Dokumen | Isi |
|---|---|
| [overview.md](architecture/overview.md) | Komponen, alur satu notifikasi, tiga lane autentikasi, queue, model data, dan daftar route |
| [project-brief.md](architecture/project-brief.md) | Konteks proyek: stack, kapabilitas, perintah, batasan/deviasi yang diketahui, kandidat pekerjaan berikutnya |

### Design (dokumen desain per fitur)

| Dokumen | Isi | Status |
|---|---|---|
| [in-app.md](design/in-app.md) | Kanal in-app: worker, Redis Stream + Pub/Sub, kontrak catch-up/read, SSE, auth subscriber, `@notifhub/js` | terimplementasi |
| [email-and-preferences.md](design/email-and-preferences.md) | Provider abstraction + circuit breaker, kanal email SMTP, preferensi + quiet hours, Subscriber API | terimplementasi |
| [preference-center.md](design/preference-center.md) | Preference center end-user di lane subscriber, verifikasi JWT per tenant | terimplementasi |
| [webhooks.md](design/webhooks.md) | Webhook provider bertanda tangan HMAC, rollup `overallStatus`, cleanup retensi/idempotency | terimplementasi |
| [whatsapp.md](design/whatsapp.md) | Kanal WhatsApp Meta Cloud API: provider, worker, webhook Meta, stub lokal | terimplementasi |
| [whatsapp-waha-provider.md](design/whatsapp-waha-provider.md) | Provider WhatsApp WAHA (self-hosted, opsional): sendText, webhook HMAC-SHA512, pemetaan ack | terimplementasi; smoke kirim OK, `delivered`/`read` belum tertutup (WAHA 2026.10.1 tidak memancarkan ack live; §15.4) |
| [admin-api.md](design/admin-api.md) | API key, auth admin, topik, isolasi tenant, dan seluruh endpoint Admin API | terimplementasi |
| [react-and-console.md](design/react-and-console.md) | `NotifHubAdminClient`, `@notifhub/react`, dan console tenant admin | terimplementasi |
| [console-needs-analysis.md](design/console-needs-analysis.md) | Analisis gap console (refresh, re-send) dan rencana fasenya | Fase A+B selesai; Fase C sebagian; P1 hardening selesai |
| [console-admin-hardening.md](design/console-admin-hardening.md) | Hardening P1 console: ganti password + invalidasi token, secret API key, search notifikasi, CSP | terimplementasi dan terverifikasi |
| [console-operations-p2.md](design/console-operations-p2.md) | P2 console: export CSV, resend all, audit aksi admin tenant, compose/send | P2a–P2c selesai |
| [console-quality-p3.md](design/console-quality-p3.md) | P3 console: test Vitest/jsdom, konsolidasi SDK, retensi audit | P3a–P3c selesai |
| [console-sdk-consolidation.md](design/console-sdk-consolidation.md) | Lanjutan P3b: pindahkan client template v2 dan platform dari console ke `@notifhub/js` | selesai & terverifikasi (36 SDK test; `0.3.1` terbit 2026-11-21) |
| [console-login-experience.md](design/console-login-experience.md) | Redesain halaman login tenant/platform: split panel + signal map beranimasi, form 360 px, mark Hub | selesai & terverifikasi (23 console test; screenshot 1440/390) |
| [sample-in-app-design.md](design/sample-in-app-design.md) | Sample React 18 in-app: sesi, SSE, read receipt, preference center, middleware dev | terimplementasi (dev-only) |
| [templates/template-system-design.md](design/templates/template-system-design.md) | Sistem template v2: draft/publish/rollback/clone, versi, preview, test send, layout/theme/partial, sanitasi, pipeline render | terimplementasi |
| [templates/email-authoring-ui-design.md](design/templates/email-authoring-ui-design.md) | Form theme dan galeri layout untuk admin non-teknis | terimplementasi |
| [templates/email-block-builder-design.md](design/templates/email-block-builder-design.md) | Block builder body email dan model `builderData` | terimplementasi |
| [templates/html-import-design.md](design/templates/html-import-design.md) | Impor HTML ke Visual (subset kecil): pemetaan tag ke block, kebijakan CSS, keamanan, kontrak console | terimplementasi dan terverifikasi |
| [templates/template-approval-diff-design.md](design/templates/template-approval-diff-design.md) | Approval maker-checker dan diff versi: peran approver, gate publish, antrean review, diff field/block/render | draf; menunggu persetujuan |
| [templates/template-limitations-roadmap.md](design/templates/template-limitations-roadmap.md) | 13 batasan template, prioritas P0/P1/P2, migrasi, keamanan, regresi | P0, P1, sebagian P2 selesai |
| [templates/in-app-markdown-design.md](design/templates/in-app-markdown-design.md) | Markdown in-app subset aman: render server-side, kontrak `bodyHtml`, rilis SDK/React | selesai & terverifikasi (E47; js 0.4.0/react 0.3.0) |
| [multi-tenant-platform-admin.md](design/multi-tenant-platform-admin.md) | Entitas tenant, provisioning, platform admin, suspend, audit, isolasi antar tenant | terimplementasi penuh (F1–F5) |
| [platform-console-host-split.md](design/platform-console-host-split.md) | Pemisahan console platform ke host/origin sendiri: dua entry build, dua image, CORS, rollout | P1–P4 selesai (smoke stack); rollout produksi operasional |

Indeks desain yang lebih rinci (pertanyaan yang dijawab dan arah baca) ada di
[design/README.md](design/README.md).

### Usage (panduan pemakaian)

| Dokumen | Isi |
|---|---|
| [usage/README.md](usage/README.md) | Konsep, tiga lane autentikasi, konvensi API, batas yang perlu diketahui sejak awal |
| [usage/overview.md](usage/overview.md) | Model data singkat, siklus hidup notifikasi, quickstart 5 menit, glosarium |
| [usage/integration.md](usage/integration.md) | Kirim notifikasi, push-sync subscriber, topik, webhook provider, Go SDK |
| [usage/end-user.md](usage/end-user.md) | Token subscriber, catch-up, SSE, preference center, SDK JS/React |
| [usage/admin-and-operations.md](usage/admin-and-operations.md) | Login admin, API key, template, subscriber, topik, notifikasi, console, operasional |
| [usage/platform-admin.md](usage/platform-admin.md) | Login platform, provisioning tenant, admin tenant, suspend/resume, audit, batasan v1 |

### SDK

| Dokumen | Isi |
|---|---|
| [sdk/go-sdk.md](sdk/go-sdk.md) | OpenAPI publik, pipeline generasi, struktur module, error/retry, rilis Go SDK |
| [sdk/npm-publishing.md](sdk/npm-publishing.md) | Publikasi `@notifhub/js` dan `@notifhub/react`: manifest, versi, urutan rilis, verifikasi |

### Operations

| Dokumen | Isi |
|---|---|
| [operations/production-readiness.md](operations/production-readiness.md) | Arsitektur test e2e, skenario, image Docker, workflow CI, dan risiko rilis |
| [operations/single-tenant-deployment.md](operations/single-tenant-deployment.md) | Panduan deployment satu tenant: topologi, env minimum, compose, console statis, reverse proxy, backup, go-live |

## Sumber kebenaran

| Hal | Sumber |
|---|---|
| Kontrak HTTP | `GET /api/docs-json`; untuk konsumen SDK: `openapi/notifhub.json` |
| Skema database | `prisma/schema.prisma` dan `prisma/migrations/` |
| Environment variable | `.env.example`, `.env.prod.example`, dan `src/config/env.schema.ts` |
| Daftar perintah | `package.json` (`npm run …`) dan `.github/workflows/ci.yml` |
| Versi service, SDK, dan Go module | `package.json` (root, `packages/*`, `console/`) dan `README.md` |
| Perilaku runtime yang sudah diverifikasi | Suite e2e di `test/` dan bagian "Verifikasi" pada dokumen desain |

## Konvensi dokumentasi

1. **Bahasa.** Dokumen teknis dan panduan memakai Bahasa Indonesia; istilah teknis, nama field,
   dan kontrak HTTP tetap Bahasa Inggris. `README.md` di root ditulis Bahasa Inggris karena
   menjadi halaman muka repo, dan `getting-started/local-setup.md` masih Bahasa Inggris (dokumen
   lama, sengaja tidak diterjemahkan agar riwayat perintahnya tetap utuh).
2. **Struktur dokumen desain.** Diawali `Status:` dan `Basis:`, lalu bagian bernomor: ruang
   lingkup, alur/kontrak, daftar file, verifikasi, keputusan (`D1…Dn`), dan **Catatan
   implementasi**. Bagian terakhir adalah tempat deviasi dari rencana dicatat — baca itu lebih dulu
   bila Anda mencari perilaku yang sebenarnya.
3. **Tanggal** di dokumen desain adalah tanggal keputusan/implementasi, bukan tanggal terakhir
   file disentuh.
4. **Rujukan antar dokumen** memakai path relatif dari root repo, mis. `docs/design/in-app.md`,
   bukan nomor urut pekerjaan. Tautan Markdown dipakai bila pembaca perlu berpindah dokumen.
5. **Satu topik, satu dokumen.** Dokumen baru diletakkan di folder tematik yang sesuai, lalu
   ditambahkan ke tabel "Daftar dokumen" di halaman ini.
6. **Batasan dan roadmap** dirangkum di `architecture/project-brief.md` §6 dan
   `design/templates/template-limitations-roadmap.md`; hindari menyalin daftar panjangnya ke
   tempat lain — cukup tautkan.

## Menjaga dokumentasi tetap sehat

```bash
npm run docs:check     # memeriksa tautan relatif dan anchor heading di seluruh docs/
```

Pemeriksaan ini juga berjalan di CI. Saat memindahkan atau mengganti judul bagian, jalankan
perintah di atas dan perbaiki tautan yang rusak.

- Menambah dokumen desain: buat file di `docs/design/` (atau subfoldernya), tambahkan baris ke
  [design/README.md](design/README.md) dan tabel "Daftar dokumen" di halaman ini.
- Menambah environment variable: perbarui `src/config/env.schema.ts`, `.env.example`, dan
  [configuration.md](getting-started/configuration.md).
- Menambah endpoint: perbarui Swagger, `openapi/notifhub.json` (via `npm run openapi:export`), dan
  tabel route di [overview.md](architecture/overview.md#kontrak-http).
