# Indeks dokumen desain

Folder ini berisi **catatan desain per fitur**: masalah yang dipecahkan, keputusan yang diambil
(`D1…Dn`), kontrak yang dijanjikan, dan hasil verifikasinya. Dokumen-dokumen ini ditulis sebelum
implementasi dan diperbarui setelahnya pada bagian **Catatan implementasi**.

Cara membacanya:

1. Baca `Status:` di baris atas — itu menentukan apakah dokumen menggambarkan kode saat ini,
   sebagian, atau rencana.
2. Lompat ke bagian yang Anda butuhkan lewat daftar isi di setiap dokumen.
3. Untuk perilaku yang benar-benar berjalan, prioritaskan **Catatan implementasi** dan bagian
   **Verifikasi**; rencana di bagian awal bisa sudah bergeser.
4. Batasan yang masih terbuka dirangkum di
   [project-brief §6](../architecture/project-brief.md#6-batasan-dan-deviasi-yang-diketahui) dan
   [template-limitations-roadmap](templates/template-limitations-roadmap.md).

Legenda status: **terimplementasi** = ada di kode dan terverifikasi · **sebagian** = fase tertentu
selesai · **rencana** = belum dikerjakan.

## Peta dokumen

| Dokumen | Pertanyaan yang dijawab | Status | Bagian kunci |
|---|---|---|---|
| [in-app.md](in-app.md) | Bagaimana notifikasi in-app dikirim, disimpan, dan dialirkan ke browser lewat SSE? | terimplementasi | §3 kontrak HTTP, §4 auth subscriber, §5 Redis, §6 worker |
| [email-and-preferences.md](email-and-preferences.md) | Bagaimana email dikirim lewat provider abstraction, dan bagaimana preferensi/quiet hours ditegakkan? | terimplementasi | §3 circuit breaker, §5 preferensi, §6 Subscriber API |
| [preference-center.md](preference-center.md) | Bagaimana end-user mengubah preferensinya sendiri tanpa lane admin? | terimplementasi | §3 arsitektur, §5 endpoint, §6 JWT per tenant |
| [webhooks.md](webhooks.md) | Bagaimana callback provider diverifikasi, dicatat, dan menggulung status notifikasi? | terimplementasi | §2 signature, §3 rollup, §4 cleanup |
| [whatsapp.md](whatsapp.md) | Bagaimana kanal WhatsApp memakai Meta Cloud API, termasuk webhook-nya? | terimplementasi | §3 Cloud API, §4 worker, §5 webhook |
| [whatsapp-waha-provider.md](whatsapp-waha-provider.md) | Bagaimana menambahkan WAHA sebagai provider WhatsApp opsional tanpa mengubah default Meta? | terimplementasi; smoke WAHA nyata pending | §3 keputusan, §5 sendText, §6 webhook, §7 pemetaan status, §15 catatan |
| [admin-api.md](admin-api.md) | Bagaimana tiga lane auth dipisahkan, API key dikelola, tenant diisolasi, dan endpoint admin disusun? | terimplementasi | §2 lane auth, §3 ApiKey, §6 Admin API |
| [react-and-console.md](react-and-console.md) | Bagaimana `@notifhub/js` (admin client), `@notifhub/react`, dan console tenant admin dibangun? | terimplementasi | §2 auth frontend, §3 admin client, §4 React, §5 console |
| [console-needs-analysis.md](console-needs-analysis.md) | Gap operasional console apa yang perlu ditutup, dan fase mana yang sudah jalan? | Fase A+B selesai; Fase C sebagian; P1 hardening selesai | §1 ringkasan, §4 refresh, §5 re-send, §11.1 audit 2026-11-20 |
| [console-admin-hardening.md](console-admin-hardening.md) | Bagaimana menutup gap P1 console tenant: ganti password, invalidasi sesi, secret API key, search, CSP? | terimplementasi dan terverifikasi | §4 password, §5 tokenVersion, §7 search, §8 CSP, §16 catatan |
| [console-operations-p2.md](console-operations-p2.md) | Bagaimana menambahkan export CSV, resend all, audit aksi admin tenant, dan compose/send? | P2a–P2c selesai | §3 export, §4 resend, §5 audit, §6 compose, §13–§15 catatan |
| [console-quality-p3.md](console-quality-p3.md) | Bagaimana menutup test frontend, konsolidasi SDK, dan retensi audit console? | P3a–P3c selesai | §3 test, §4 SDK, §5 retensi, §11–§13 catatan |
| [sample-in-app-design.md](sample-in-app-design.md) | Bagaimana sample React 18 memakai SDK terbit untuk in-app, SSE, dan preference center? | terimplementasi (dev-only) | §4 arsitektur, §6 middleware dev, §15 hasil verifikasi |
| [templates/template-system-design.md](templates/template-system-design.md) | Bagaimana sistem template v2 bekerja: versi, draft/publish, render per channel, sanitasi? | terimplementasi | §1 keputusan, §5 D1–D12, §7 pipeline render, §18 catatan |
| [templates/email-authoring-ui-design.md](templates/email-authoring-ui-design.md) | Bagaimana admin non-teknis mengubah theme dan layout tanpa menulis JSON/HTML? | terimplementasi | §2 keputusan, §3 UX, §5 batasan |
| [templates/email-block-builder-design.md](templates/email-block-builder-design.md) | Bagaimana body email disusun dari block, dan bagaimana `builderData` divalidasi? | terimplementasi | §3 model data, §4 UX, §7 verifikasi |
| [templates/template-limitations-roadmap.md](templates/template-limitations-roadmap.md) | Batasan template mana yang paling berisiko, dan apa prioritas serta statusnya? | P0, P1, sebagian P2 selesai | §2 tabel batasan, §3 prioritas, §11–§14 hasil |
| [multi-tenant-platform-admin.md](multi-tenant-platform-admin.md) | Bagaimana tenant dikelola sebagai entitas: provisioning, platform admin, suspend, audit, dan isolasi antar tenant? | terimplementasi penuh (F1–F5) | §3 gap, §5 keputusan, §6 migrasi, §8 API, §19 catatan F1–F5 |
| [platform-console-host-split.md](platform-console-host-split.md) | Bagaimana memisahkan console platform ke host/origin sendiri tanpa memecah codebase, dan dampaknya ke build, Docker, CORS, serta rollout? | P1–P4 selesai (smoke stack); rollout produksi operasional | §4 opsi, §5 keputusan, §7 build, §8 deployment, §10 rollout, §18 catatan P1–P4 |

## Arah baca menurut pekerjaan

| Kalau Anda akan… | Baca |
|---|---|
| Menambah atau mengubah kanal | [in-app](in-app.md) → [email-and-preferences](email-and-preferences.md) → [whatsapp](whatsapp.md) → [whatsapp-waha-provider](whatsapp-waha-provider.md), lalu [webhooks](webhooks.md) untuk status |
| Menyentuh template atau render | [template-system-design](templates/template-system-design.md) → [block builder](templates/email-block-builder-design.md) → [limitations roadmap](templates/template-limitations-roadmap.md) |
| Menyentuh auth, tenant, atau endpoint admin | [admin-api](admin-api.md) → [preference-center](preference-center.md) §6 → [in-app](in-app.md) §4 |
| Menyentuh tenancy, provisioning, atau peran platform | [multi-tenant-platform-admin](multi-tenant-platform-admin.md) → [admin-api](admin-api.md) §2 |
| Menyentuh console atau SDK frontend | [react-and-console](react-and-console.md) → [console-needs-analysis](console-needs-analysis.md) → [sample-in-app-design](sample-in-app-design.md) |
| Mencari alasan sebuah keputusan | Cari `D<n>` di dokumen terkait; keputusan diberi nomor dan alasannya ditulis di tabel |

## Anatomi dokumen desain

Urutan bagian yang dipakai konsisten, walau tidak setiap dokumen memuat semuanya:

| Bagian | Isi |
|---|---|
| `Status:` / `Basis:` | Status implementasi dan dokumen/keputusan yang menjadi dasar |
| Ruang lingkup | Apa yang termasuk dan **tidak** termasuk |
| Alur data / kontrak | Diagram alur, endpoint, bentuk payload |
| Schema / konfigurasi | Perubahan Prisma, env, dependency |
| Daftar file | File yang disentuh, untuk memudahkan penelusuran |
| Verifikasi | Skenario end-to-end beserta hasil yang diharapkan |
| Keputusan `D<n>` | Keputusan bernomor + alasan + status persetujuan |
| Catatan implementasi | Deviasi dari rencana, bug yang ditemukan, bukti verifikasi |

## Menambah dokumen desain

1. Beri nama file sesuai fitur (`kebab-case.md`), bukan nomor urut.
2. Awali dengan `Status:` dan `Basis:`, lalu bagian bernomor dan daftar isi (lihat dokumen lain
   sebagai contoh).
3. Tambahkan baris ke tabel "Peta dokumen" di halaman ini dan ke tabel "Daftar dokumen" di
   [docs/README.md](../README.md).
4. Rujuk dokumen lain dengan path relatif dari root repo (`docs/design/...`) agar mudah dicari
   dari mana pun.
