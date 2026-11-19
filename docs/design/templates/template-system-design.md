# Desain sistem template NotifHub

Status: **terimplementasi dan terverifikasi** pada 2026-11-16. Lihat §18 untuk catatan implementasi,
deviasi, dan bukti verifikasi. Desain awal disetujui sebelum implementasi.

Tanggal: 2026-11-16
Basis: commit `c8b2eaf`, `docs/architecture/project-brief.md`, `docs/design/admin-api.md`, `docs/design/react-and-console.md`,
`docs/design/email-and-preferences.md`, `docs/design/in-app.md`, `docs/design/whatsapp.md`, serta kode template/worker/
console yang ada. Ringkasan keputusan ada di §1; detail ada di §5–§15.

**Isi dokumen**

- [1. Ringkasan keputusan](#1-ringkasan-keputusan)
- [2. Kondisi saat ini dan gap](#2-kondisi-saat-ini-dan-gap)
- [3. Prinsip desain](#3-prinsip-desain)
- [4. Opsi desain authoring dan trade-off](#4-opsi-desain-authoring-dan-trade-off)
- [5. Keputusan D1–D12](#5-keputusan-d1d12)
- [6. Perubahan schema dan model data](#6-perubahan-schema-dan-model-data)
- [7. Pipeline render dan perilaku worker](#7-pipeline-render-dan-perilaku-worker)
- [8. Perilaku per channel](#8-perilaku-per-channel)
- [9. Perubahan Admin API](#9-perubahan-admin-api)
- [10. Perubahan console](#10-perubahan-console)
- [11. Keamanan dan sanitasi (rinci)](#11-keamanan-dan-sanitasi-rinci)
- [12. Localization dan RTL](#12-localization-dan-rtl)
- [13. Migrasi dan kompatibilitas ke belakang](#13-migrasi-dan-kompatibilitas-ke-belakang)
- [14. Fase MVP dan fase lanjutan](#14-fase-mvp-dan-fase-lanjutan)
- [15. Rencana verifikasi end-to-end dan regresi](#15-rencana-verifikasi-end-to-end-dan-regresi)
- [16. Risiko dan pertanyaan terbuka](#16-risiko-dan-pertanyaan-terbuka)
- [17. Definition of done (setelah persetujuan)](#17-definition-of-done-setelah-persetujuan)
- [18. Catatan implementasi dan verifikasi](#18-catatan-implementasi-dan-verifikasi)

---

## 1. Ringkasan keputusan

| # | Keputusan | Default yang direkomendasikan |
|---|---|---|
| D1 | Model authoring | **Hybrid Handlebars-aset**: body HTML Handlebars + layout/theme/partial terpisah dan versioned. Bukan block builder, bukan MJML di MVP. |
| D2 | Penyimpanan & migrasi | `NotificationTemplate` tetap menjadi baris versi; tambah `status`, `format`, `direction`, `strictVariables`, `variables`, `sampleData`, `preheader`, referensi aset, `revision`. Tabel aset append-only. Migrasi aditif + backfill, tanpa mengubah baris lama secara destruktif. |
| D3 | Batas channel | Email = `html`; in-app = `text` (markdown ditunda sampai SDK rilis); WhatsApp = `text`; SMS = `text` dan di luar cakupan. Validasi format wajib per channel. |
| D4 | Styling/tema/partial | Layout email table-based + inline CSS + media query; theme berupa token JSON; partial versioned. **Tanpa dependency baru** di MVP (tanpa MJML/juice/CodeMirror). |
| D5 | Variabel | Schema JSON + sample data; validasi required/optional/tipe; escaping sadar-channel; helper whitelist; template baru dari console default strict, create API lama non-strict. |
| D6 | Versi | `draft`/`published`; published immutable; worker memilih published aktif versi tertinggi; clone/rollback membuat draft versi baru; `PUT` lama dipertahankan sebagai jalur kompatibilitas yang otomatis membuat versi published baru. |
| D7 | Preview & test send | Preview server-side (tanpa persistensi) + iframe sandbox; test send hanya email/WhatsApp, memakai versi tersimpan, melewati preferensi, dibatasi rate limit, dan diaudit. In-app test send tidak didukung di MVP. |
| D8 | Sanitasi/keamanan | Validasi HTML/CSS/URL saat publish, Handlebars terisolasi + helper whitelist, preview `sandbox=""` + `no-referrer`, tanpa fetch aset server-side, isolasi tenant di semua query. |
| D9 | Admin API & SDK | Endpoint admin baru bersifat aditif; console memakai `HttpTransport` yang sudah diekspor `@notifhub/js` 0.3.0. Tidak ada perubahan versi paket npm terbit. |
| D10 | UX console | Editor dua panel, tab konten/variabel/aset/pengaturan, sidebar variabel + sample data, preview desktop/mobile, dialog publish/test send, riwayat versi/audit, guard unsaved changes. Tanpa block builder. |
| D11 | Fase MVP | Schema + renderer + versi + aset + variabel + preview/test send + keamanan + console + test. Block builder, MJML, markdown in-app, Meta template, dan plain-text alternatif ditunda. |
| D12 | Test & kompatibilitas | Unit renderer/validator, E2E alur template + regresi E1–E11, typecheck/build console/SDK, verifikasi manual UI tanpa Playwright; baris lama tetap terkirim dan API lama tetap 2xx untuk input valid (input tidak aman dapat 422). |

---

## 2. Kondisi saat ini dan gap

### 2.1 Fakta implementasi saat ini

| Area | Kondisi |
|---|---|
| Schema | `NotificationTemplate`: `tenantId`, `key`, `channel`, `locale`, `subject?`, `body`, `version`, `active`, `fallbackProvider?`, `fallbackChannel?`. Unik `(tenantId, key, channel, locale, version)`. Tidak ada status/draft, format, aset, schema variabel, atau audit. |
| Resolusi | `TemplateService.resolve` memilih `active=true` dengan `version` tertinggi; locale kandidat = locale diminta lalu `DEFAULT_LOCALE`. Tidak ada normalisasi BCP-47 atau fallback bahasa. |
| Render | `Handlebars.compile` global, escaping default; `{{{var}}}` untuk HTML mentah; variabel hilang menjadi string kosong; cache delegate per `id + updatedAt + field`. |
| Worker email | Render `subject` + `body`, lalu `EmailProvider` mengirim `html: input.body`. Tidak ada layout/theme/preheader. |
| Worker in-app | Body dirender lalu dipublikasikan sebagai string. `@notifhub/react` menampilkan body sebagai teks (bukan HTML). |
| Worker WhatsApp | Body dirender lalu dikirim sebagai `type: "text"`. Belum ada approved-template Meta. |
| Admin API | CRUD template sederhana: list/create/get/update (partial)/delete (soft delete `active=false`). Tidak ada publish, clone, rollback, preview, test send, aset, atau audit. |
| Console | `TemplatesPage` hanya tabel + filter channel; `TemplateFormPage` textarea body, tanpa preview/test send/variabel; key/channel/locale/version dikunci saat edit. |
| Payload | Body parser global dibatasi `INGEST_MAX_PAYLOAD_BYTES` (default 65.536 byte). HTML email yang wajar bisa melewati batas ini. |
| SDK | `@notifhub/js` 0.3.0 sudah mengekspor `HttpTransport`; `NotifHubAdminClient` belum punya method template baru. Console sudah memakai pola wrapper `HttpTransport` untuk resend. |

### 2.2 Gap yang harus ditutup

1. **Authoring** hanya textarea; tidak ada layout, komponen, tema, preheader, atau starter yang
   aman untuk email.
2. **Tidak ada pemisahan format per channel**; semua body diperlakukan sebagai string Handlebars
   dengan escaping HTML, termasuk in-app/WhatsApp yang sebenarnya teks.
3. **Tidak ada draft/publish**; edit langsung mengubah baris yang sedang dipakai worker.
4. **Tidak ada validasi** sintaks Handlebars, variabel, ukuran, atau keamanan HTML sebelum kirim.
5. **Tidak ada schema variabel/sample data**; variabel hilang diam-diam menjadi string kosong.
6. **Tidak ada preview server-side**; admin tidak bisa melihat hasil nyata sebelum publish.
7. **Tidak ada test send** ke penerima tertentu dengan pembatasan dan audit.
8. **Tidak ada aset reusable**; header/footer/theme harus diduplikasi di setiap body.
9. **Tidak ada versi historis/rollback/clone/audit**; tidak ada jejak siapa mengubah apa.
10. **Tidak ada dukungan RTL/dark mode/responsive** yang terstruktur; layout email bergantung pada
    HTML yang ditulis ulang setiap template.
11. **Batas kepercayaan admin tidak ditegakkan**; body bisa memuat `<script>`, event handler, atau
    URL berbahaya, dan preview (bila nanti dibuat) berisiko XSS.
12. **Batas payload** 64 KB menghambat template HTML yang kaya dan preview inline.

---

## 3. Prinsip desain

1. **Channel tidak dipaksa sama.** Email adalah dokumen HTML; in-app dan WhatsApp adalah teks.
   Model data boleh berbagi baris, tetapi format, validasi, dan jalur render berbeda.
2. **Published immutable, draft bebas.** Editor boleh menyimpan draft yang belum valid; publish
   adalah gerbang kualitas dan keamanan.
3. **Reproducible.** Aset (layout/theme/partial) immutable per versi; template published menunjuk
   ID aset tertentu, sehingga perubahan aset tidak mengubah email yang sudah dipublish.
4. **Aman secara default.** Escaping, helper whitelist, validasi URL/HTML, sandbox preview, dan
   isolasi tenant.
5. **Backward compatible.** Baris lama tetap dikirim dengan hasil yang sama; API lama tetap
   merespons 2xx; migrasi aditif dan bisa di-rollback di level kode.
6. **Tanpa dependency baru di MVP.** Handlebars, zod, class-validator, React/Vite/Bootstrap sudah
   cukup. Dependency berat (MJML/juice/CodeMirror) dibahas sebagai fase lanjutan.
7. **Admin adalah pengguna tepercaya, tetapi input-nya tetap tidak tepercaya** untuk XSS/SSRF.
8. **Tenant-scoped di semua lapis.** Tidak ada ID aset/template dari tenant lain yang boleh
   di-resolve, termasuk lewat preview/test send.

---

## 4. Opsi desain authoring dan trade-off

### Opsi A — Raw Handlebars + layout/partial/theme terpisah

Admin menulis HTML Handlebars; layout menyediakan kerangka email; partial menyediakan header/
footer/CTA; theme menyediakan token warna/tipografi. Console menyediakan starter snippet, preview,
dan validasi.

- **Kelebihan:** fleksibel maksimal, cocok untuk transaksional/promo/dua kolom; tidak mengunci
  desain; memakai dependency yang sudah ada (`handlebars`); migrasi ringan; admin yang paham HTML
  bisa langsung produktif.
- **Kekurangan:** kualitas email bergantung pada disiplin admin (tabel, inline CSS); tidak ada
  jaminan visual seperti MJML; rawan HTML tidak konsisten; membutuhkan validator dan starter yang
  baik.
- **Cocok untuk:** tim kecil/menengah, template sedikit tetapi bervariasi, tahap proyek sekarang.

### Opsi B — MJML/HTML + inline CSS otomatis

Admin menulis MJML (atau HTML) dan compiler menghasilkan HTML email responsive; CSS di-inline
dengan `juice` atau sejenis.

- **Kelebihan:** hasil email paling konsisten lintas client; responsive/dark mode lebih mudah;
  authoring level komponen.
- **Kekurangan:** menambah dependency besar (MJML + toolchain), build/render server-side lebih
  berat; admin harus mempelajari MJML; preview/test send harus memakai compiler yang sama;
  integrasi dengan Handlebars dan layout/partial menjadi kompleks; migrasi template lama tidak
  trivial; risiko supply-chain dan ukuran image backend.
- **Keputusan:** **tidak untuk MVP.** Evaluasi ulang jika kebutuhan visual sudah melampaui
  kemampuan layout table-based dan admin sudah terbukti kesulitan.

### Opsi C — Structured blocks/JSON (block builder)

Template disimpan sebagai array block (`heading`, `text`, `image`, `button`, `columns`, ...), lalu
renderer menghasilkan HTML per channel.

- **Kelebihan:** UX paling ramah non-teknis; validasi dan tema terjamin; konsistensi tinggi;
  bisa menghasilkan email dan teks dari satu definisi.
- **Kekurangan:** scope besar (schema block, renderer, editor drag-and-drop, migrasi, versi
  schema block); membatasi kreativitas desain; email client tetap butuh renderer HTML yang rumit;
  perubahan schema block adalah masalah kompatibilitas jangka panjang; bertentangan dengan
  batasan "desain dulu, dependency minimal, tahap proyek sekarang".
- **Keputusan:** **ditunda**; bukan MVP. Jika nanti dibutuhkan, bangun di atas kontrak template
  yang sama, bukan mengganti model data.

### Opsi D — Hybrid (rekomendasi)

**Hybrid Handlebars-aset**: body tetap HTML Handlebars, tetapi layout/theme/partial adalah aset
tenant-scoped yang versioned; console menambahkan starter snippet, variable schema, preview, dan
publish gate. Ini adalah Opsi A yang distrukturkan, bukan block builder.

- **Kelebihan:** fleksibel; reuse tanpa duplikasi; published reproducible; bisa berevolusi ke
  snippet/block tanpa migrasi besar; tidak menambah dependency; selaras dengan Handlebars yang
  sudah dipakai worker.
- **Kekurangan:** kualitas email tetap bergantung pada layout/starter; validator HTML/CSS tidak
  bisa sempurna tanpa parser; admin perlu memahami HTML untuk kustomisasi mendalam.
- **Keputusan:** **dipakai (D1).**

### Perbandingan ringkas

| Dimensi | A Raw + aset | B MJML | C Block JSON | D Hybrid (dipilih) |
|---|---|---|---|---|
| Fleksibilitas desain | Tinggi | Tinggi | Sedang | Tinggi |
| Ramah non-teknis | Rendah | Sedang | Tinggi | Sedang |
| Konsistensi email client | Rendah–sedang | Tinggi | Tinggi | Sedang–tinggi (starter + validator) |
| Dependency baru | Tidak | Berat | Tidak (tetapi renderer besar) | Tidak |
| Effort MVP | Sedang | Tinggi | Sangat tinggi | Sedang |
| Migrasi data lama | Mudah | Sulit | Sulit | Mudah |
| Risiko keamanan | Sedang (perlu validator) | Sedang | Rendah–sedang | Sedang (validator + sandbox) |
| Reuse layout/theme/partial | Ya | Ya | Ya (block) | Ya |
| Reproducibility | Ya (aset immutable) | Ya | Ya | Ya (aset immutable) |

---

## 5. Keputusan D1–D12

### D1 — Model authoring

**Default: Hybrid Handlebars-aset.**

- Email: `body` adalah fragmen/konten HTML Handlebars; `layout` adalah dokumen email lengkap
  dengan placeholder `{{{body}}}`; `theme` adalah token JSON; `partial` adalah fragmen HTML
  reusable yang direferensikan eksplisit oleh template.
- In-app/WhatsApp/SMS: `body` adalah teks Handlebars; tidak ada layout/theme/partial.
- Console menyediakan **starter snippet** statis (header, footer, CTA, divider, spacer, image,
  satu/dua kolom, preheader) yang disisipkan ke editor. Snippet bukan schema block; ia hanya
  potongan HTML/teks dengan inline style yang sudah diuji.
- Tidak ada drag-and-drop/block builder di MVP.

**Konsekuensi:** admin tetap menulis HTML untuk kustomisasi; kualitas dijaga oleh starter,
validator, preview, dan review publish. Jika nanti dibutuhkan block builder, ia dapat menghasilkan
HTML Handlebars yang sama, sehingga model data tidak perlu diganti.

### D2 — Penyimpanan dan migrasi schema

**Default: baris template tetap menjadi versi; aset dipisah dan append-only.**

- `NotificationTemplate` menyimpan konten versi (subject/preheader/body/format/variabel/sample).
- `TemplateLayout`, `TemplateTheme`, `TemplatePartial` menyimpan aset immutable per versi.
  Perubahan aset = baris versi baru, bukan update.
- `TemplatePartialLink` menghubungkan satu versi template ke versi partial tertentu.
- `TemplateAuditEvent` menyimpan audit perubahan.
- `TemplateTestSend` menyimpan audit test send (recipient disamarkan).
- Tidak ada kolom `blocksJson`, tidak ada tabel `TemplateDraft` terpisah; draft adalah baris
  `NotificationTemplate` dengan `status='draft'`.
- Migrasi bersifat aditif; tidak ada drop/rename kolom lama. Backfill mengisi `status`,
  `format`, `publishedAt`, `strictVariables`, dan `revision`.

**Konsekuensi:** jumlah baris aset bertambah setiap edit aset; UI harus menampilkan versi dan
mencegah kebingungan. Tidak ada penghapusan aset di MVP; penghapusan/retensi dibahas fase 2.

### D3 — Cakupan channel dan format body

**Default: format eksplisit per channel, divalidasi ketat untuk template baru.**

| Channel | Format yang diterima | Subject | Preheader/layout/theme/partial | Catatan |
|---|---|---|---|---|
| `email` | `html` | Wajib saat publish (baris lama boleh `null`) | Ya | Body fragmen HTML; layout yang membungkus |
| `inapp` | `text` | Opsional (saat ini dipakai SSE) | Tidak | HTML ditolak; markdown ditunda |
| `whatsapp` | `text` | Tidak boleh diisi untuk template baru | Tidak | Teks polos; batas 4.096 karakter setelah render |
| `sms` | `text` | Tidak boleh diisi | Tidak | Di luar cakupan worker; validasi tetap disiapkan |

- Baris lama: format diinferensi (`email` → `html`, lainnya → `text`), sehingga tetap terkirim.
- In-app **tidak** boleh HTML karena `@notifhub/react` merender body sebagai teks; mengirim HTML
  akan tampil sebagai tag. Markdown juga ditunda karena SDK terbit belum punya renderer markdown.
- WhatsApp bukan Meta approved-template; tetap `type: "text"`. Pemetaan template Meta ditunda.
- `format` bukan sekadar metadata: ia menentukan escaping (HTML vs teks) dan validasi.

### D4 — Styling, tema, partial, dan dependency

**Default: layout table-based + inline CSS + media query; theme token JSON; tanpa dependency baru.**

- Layout email yang disediakan starter wajib memakai tabel, `role="presentation"`, lebar maksimum
  600 px, gambar fluid, dan inline style untuk styling dasar. Media query di `<style>` hanya untuk
  responsive dan dark mode; ini kompatibel dengan client yang mendukung `<style>` dan gagal secara
  anggun di yang tidak. Layout tetap opsional secara schema (body lama tanpa layout tetap sah),
  tetapi template email baru tanpa layout mendapat warning karena preheader/theme tidak diterapkan.
- Theme token: `brand.primary`, `brand.onPrimary`, `brand.background`, `brand.surface`,
  `text.primary`, `text.muted`, `font.family`, `font.sizeBase`, `font.sizeHeading`, `spacing.*`,
  `radius.*`, `button.*`. Token dirender ke inline style lewat Handlebars, mis.
  `style="background:{{theme.brand.primary}}"`.
- Partial direferensikan eksplisit (`partialIds`), bukan semua partial tenant, agar tidak ada
  benturan nama dan hasil deterministik.
- **Tidak menambah** `mjml`, `juice`, `html-to-text`, `dompurify`, `jsdom`, atau CodeMirror di MVP.
- Starter snippet disimpan sebagai konstanta TypeScript di console (bukan DB), sehingga tidak
  menambah tabel/API.
- Fase 2 dapat mempertimbangkan `juice` (inline CSS otomatis) atau `mjml` hanya dengan persetujuan
  tertulis di desain lanjutan.

**Dark mode:** layout menyediakan `@media (prefers-color-scheme: dark)` dengan `!important` dan
varian `[data-ogsc]` untuk Outlook.com. Karena dukungan client tidak seragam, dark mode adalah
"best effort" dan tidak dijanjikan identik di semua client. Preview console menyediakan latar
terang/gelap untuk memeriksa kontras, bukan emulasi penuh dark mode client.

### D5 — Variable schema, sample data, dan validasi

**Default: schema JSON + sample data; strict per template; escaping sadar-channel.**

Bentuk `variables` (disimpan sebagai JSON):

```json
{
  "version": 1,
  "variables": [
    {
      "key": "customer.name",
      "type": "string",
      "required": true,
      "description": "Nama penerima",
      "example": "Budi",
      "pii": true
    },
    {
      "key": "order.total",
      "type": "number",
      "required": true,
      "example": 125000,
      "default": 0
    },
    {
      "key": "cta.url",
      "type": "url",
      "required": true,
      "example": "https://example.com/orders/1"
    }
  ]
}
```

- Tipe: `string`, `number`, `boolean`, `date`, `url`, `email`, `array`. Array hanya untuk blok
  `{{#each}}`; tipe item tidak divalidasi mendalam di MVP.
- Key: `^[a-zA-Z_][a-zA-Z0-9_.]{0,63}$`, maksimum 100 variabel, unik. Titik berarti path nested
  (`customer.name`); sample data memakai objek nested.
- `sampleData` adalah objek JSON yang harus memenuhi semua variabel `required` dan tipe. Nilai
  sample tidak pernah dicatat ke log.
- **Publish gate:** schema valid, sample data memenuhi required/tipe, render dengan sample data
  berhasil, dan semua referensi Handlebars yang tidak dideklarasikan dilaporkan sebagai warning.
- **Runtime:**
  - `strictVariables=true` (default console untuk template baru): variabel required yang hilang
    atau tipe salah → `TemplateRenderError('template_variable_missing')`; worker membungkusnya
    sebagai `UnrecoverableError` sehingga tidak retry 5x, recipient `failed`, `lastError` jelas.
  - `strictVariables=false` (default baris lama dan create API lama): gunakan `default` bila ada,
    jika tidak string kosong; catat `template.variable_missing` (nama variabel saja) dan increment
    metrik. Ini mempertahankan perilaku lama.
- **Escaping sadar-channel:**
  - Email (`html`): `{{var}}` di-escape HTML; `{{{var}}}` mentah. Console memberi peringatan saat
    `{{{ }}}` dipakai untuk variabel yang ditandai `pii`/tidak tepercaya.
  - In-app/WhatsApp/SMS (`text`): **tanpa HTML escaping** (`noEscape`), karena output bukan HTML.
    Ini memperbaiki perilaku lama yang mengubah `&`/`'` menjadi entitas HTML di pesan teks. Baris
    lama ikut membaik; dicatat sebagai koreksi yang disengaja di §13.
- **Helper whitelist:** `if`, `unless`, `each`, `with`, `lookup` (bawaan Handlebars), ditambah
  `formatDate`, `currency`, `uppercase`, `lowercase`, `trim`, `urlencode`, `default`, `eq`, `ne`,
  `gt`, `lt`, `and`, `or`, `not`. Tidak ada helper yang mengeksekusi kode, membaca file, mengakses
  jaringan, atau mencetak objek mentah.
- Handlebars dibuat dengan `Handlebars.create()`, `allowProtoPropertiesByDefault=false`,
  `allowProtoMethodsByDefault=false`; tidak ada helper kustom dari input admin.

### D6 — Draft/publish/versioning/rollback/clone

**Default: `draft`/`published`, published immutable, worker memilih published aktif tertinggi.**

Status dan transisi:

| Aksi | Dari | Ke | Efek |
|---|---|---|---|
| Create | — | `draft` (console) / `published` (API lama) | Draft: `active=false`; jika `version` tidak dikirim, pakai `MAX(version)+1` untuk `(key, channel, locale)`. Published: `active=true`, `publishedAt`, audit, dan versi published lain untuk grup yang sama di-set `active=false`. |
| Update draft | `draft` | `draft` | Update in-place, `revision+1`, audit `draft_updated`. |
| Publish | `draft` | `published` | Validasi penuh; `active=true`; versi published lain untuk `(key, channel, locale)` yang sama di-set `active=false`; audit. |
| Update published (API lama) | `published` | `published` versi baru | **Tidak mengubah baris published**. Buat baris versi `version+1`, salin konten/aset, terapkan perubahan, publish otomatis, aktifkan, nonaktifkan versi lama; audit `published` dengan `metadata.legacyPut=true`. |
| Deactivate | `published` | `published` (`active=false`) | Tidak dipakai worker; audit `deactivated`. |
| Update metadata published | `published` | `published` (baris sama) | Hanya `active`/fallback; tidak mengubah konten/render; audit `updated`. |
| Activate | `published` (`active=false`) | `published` (`active=true`) | Hanya bila versi ini adalah published tertinggi untuk key/channel/locale; jika bukan, 409 dan arahkan ke rollback. |
| Clone | `published`/`draft` | `draft` baru | Versi baru untuk key/locale target, salin konten/aset/variabel/sample; audit `cloned`. |
| Rollback | `published` sumber | `draft` baru | Salin versi sumber ke draft versi baru; publish terpisah; audit `rolled_back`. |

Publish gate untuk draft baru mewajibkan subject email non-kosong. Jalur legacy (create tanpa
`status` dan auto-publish dari `PUT`) tetap memvalidasi sintaks/keamanan/ukuran, tetapi subject
kosong menjadi **warning** agar template lama yang memang tanpa subject tetap bisa dibuat/diedit
lewat API lama dan tidak patah. Draft baru dari console tetap wajib subject saat publish.

- **Worker:** `where tenantId, key, channel, locale in candidates, active=true, status='published'`
  lalu `orderBy version desc`. Draft (`active=false`) tidak pernah terpilih.
- **Immutable published:** setiap perubahan konten pada published selalu menghasilkan baris baru.
  Baris lama tidak pernah di-`UPDATE` untuk konten.
- **API lama (`PUT /admin/templates/:id`)**: perubahan konten pada published memakai jalur
  kompatibilitas "auto-publish versi baru" di atas. Ini mempertahankan ekspektasi 200 dan langsung
  live, tetapi tetap tidak memutasi baris published. Console baru tidak memakai jalur ini; ia
  memakai `PUT` draft + `POST publish`. Jalur lama ditandai deprecated dan dihapus pada major
  Admin API berikutnya.
- **Create API lama** tanpa `status` tetap `published` dan `active=true`; console baru selalu
  mengirim `status='draft'`.
- **Concurrency:** setiap baris punya `revision` (integer). Update/publish dari console mengirim
  `expectedRevision`; mismatch → `409 template_conflict` dengan revision terkini. Klien lama yang
  tidak mengirim `expectedRevision` tetap dilayani (tanpa cek optimistik) sampai deprecated.
- **Clone:** channel harus sama di MVP (mencegah body HTML menjadi body WhatsApp); key/locale
  boleh berbeda. Versi dihitung `MAX(version)+1` untuk target, dalam transaksi, retry pada
  `P2002`.
- **Rollback:** membuat draft baru dari snapshot versi lama (bukan mengaktifkan baris lama), lalu
  publish. Ini menjaga urutan versi monoton dan audit yang jelas.
- **Audit:** `TemplateAuditEvent` immutable; aksi `created`, `draft_updated`, `updated`, `published`,
  `deactivated`, `activated`, `cloned`, `rolled_back`, `test_sent`. Metadata tidak menyimpan body
  penuh; hanya daftar field yang berubah, versi sumber, dan catatan.
- **Resolusi saat kirim:** template di-resolve saat worker memproses job, bukan saat ingest. Job
  yang masih pending saat publish akan memakai versi baru. Ini perilaku saat ini dan
  didokumentasikan sebagai batasan; snapshot versi per notifikasi tidak ditambahkan di MVP.

### D7 — Preview dan test send

**Default: preview server-side tanpa persistensi; test send terbatas dan diaudit.**

Preview:

- `POST /admin/templates/preview` untuk konten yang belum disimpan (body/layout/theme/partial
  inline atau ID), dan `POST /admin/templates/:id/preview` untuk versi tersimpan.
- Render memakai pipeline yang sama dengan worker (satu sumber kebenaran), dengan sample data
  yang bisa di-override.
- Respons berisi `subject`, `preheader`, `html` (dokumen preview aman untuk email), `text`
  (untuk channel teks), `errors`, `warnings`, `missingVariables`, `resolved`
  (`layout/theme/partials/locale/direction`), `bytes`, `renderMs`.
- Preview **tidak** membuat notifikasi, tidak mengirim, dan tidak menulis tabel audit (hanya log
  terstruktur) karena volume preview tinggi; publish/test send yang diaudit. Ini keputusan
  eksplisit; jika kebutuhan compliance mengharuskan audit preview, tambahkan event terpisah
  dengan retensi pendek.
- Preview selalu merender best-effort: variabel required yang belum diisi memakai default/string
  kosong dan dilaporkan di `missingVariables` sebagai error; strict sebenarnya baru ditegakkan
  saat publish/test send. Ini memudahkan admin melihat layout sambil melengkapi sample data.
- Preview tetap boleh merender draft yang belum valid (selama sintaks Handlebars valid) dengan
  daftar error/warning; publish tetap diblokir.

Test send:

- Hanya untuk `email` dan `whatsapp`; `inapp`/`sms` → `400 test_send_unsupported_channel`
  (gunakan preview).
- Hanya template **tersimpan** (draft atau published). Draft harus lolos validasi penuh sebelum
  dikirim. Test send tidak menerima body inline.
- `recipient` eksplisit (email atau nomor E.164), bukan lookup subscriber; tidak membaca
  preferensi/quiet hours dan tidak membuat `Notification`/`BillingEvent`.
- Memakai `ProviderExecutor` dan provider yang sama; mode `development`/`staging`/`production`
  berlaku (log-only/catch-all/alamat asli). Perbedaan mode ditampilkan di UI sebelum kirim.
- Rate limit: 10 per jam per admin dan 30 per hari per tenant (dihitung dari `TemplateTestSend`).
  Melebihi → `429` dengan `details.retryAfterSeconds`.
- Audit `TemplateTestSend` menyimpan channel, versi, recipient **disamarkan**, hash, status,
  provider, providerMessageId, error code, dan admin. Tidak menyimpan body atau alamat lengkap.
- Opsional `requestKey` untuk idempotensi klik ganda; replay mengembalikan hasil yang sama.

### D8 — Sanitasi dan keamanan preview

**Default: validasi saat publish + sandbox preview + Handlebars terisolasi.**

- **Handlebars:** environment terisolasi, helper whitelist, akses properti prototipe dimatikan,
  dynamic partial hanya dari registry, tidak ada `eval`/`Function`/akses modul.
- **Validator HTML/CSS** (saat publish, test send, dan preview sebagai warning/error):
  - Tolak `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<input>`, `<button>`,
    `<base>`, `<svg>`, `<math>`, `<link>`, meta refresh.
  - Tolak atribut `on*` dan URL dengan skema `javascript:`, `vbscript:`, `data:` (kecuali
    `data:image/*` bila nanti disetujui; MVP: tidak ada), `file:`.
  - Tolak CSS `expression(`, `behavior:`, `-moz-binding`, `@import`, dan `url(javascript:...)`.
  - URL yang diizinkan: `http`, `https`, `mailto`, `tel`, dan anchor `#`. Untuk `img src`:
    `http`/`https` (MVP tidak memakai data URI).
  - Decode entitas HTML pada atribut URL sebelum pemeriksaan skema untuk menutup bypass dasar;
    validator regex bukan parser penuh, sehingga sandbox tetap menjadi pertahanan utama.
- **Token theme divalidasi**, bukan CSS bebas: warna hex/rgb(a), font stack allowlist, panjang
  `px`/`rem`/`em`, dan nilai tidak boleh mengandung `;`, `{`, `}`, `<`, `>`, `"`, atau `url(`.
  Theme tidak menerima CSS mentah di MVP.
- **Sanitasi output runtime:** setelah layout dirender, seluruh HTML email/preview melewati
  pembersih yang sama (tag/atribut/URL/CSS) untuk menangkap data dinamis yang masuk lewat
  `{{{ }}}`. Pelanggaran dihapus, dicatat `template.output_sanitized` (tanpa nilai data), dan
  dihitung di metrik. Ini adalah lapisan kedua setelah validasi statis publish; untuk data yang
  sangat sensitif, template sebaiknya tetap memakai `{{ }}`.
- **Preview:** iframe `sandbox=""` (tanpa `allow-scripts`, tanpa `allow-same-origin`, tanpa
  form/popup), `referrerpolicy="no-referrer"`, `title`, `srcDoc` dari server. Server juga
  menyisipkan CSP meta bila memungkinkan:
  `default-src 'none'; img-src https: http:; style-src 'unsafe-inline'; font-src data:;
  connect-src 'none'; script-src 'none'; form-action 'none'; base-uri 'none'`.
  Untuk layout yang berupa dokumen penuh, CSP disisipkan setelah `<head>`; bila tidak ada `<head>`,
  sandbox tetap menjadi kontrol utama. Ini didokumentasikan sebagai batasan.
- **Tidak ada fetch aset server-side** saat render/preview; gambar hanya dimuat oleh browser di
  dalam iframe. Tidak ada SSRF dari template.
- **Test send:** validasi recipient, tolak CR/LF pada subject (header injection), batasi rate,
  audit, dan jangan pernah mengembalikan konfigurasi SMTP/WhatsApp.
- **Logging:** tidak ada body, sample data, alamat lengkap, atau secret di log. Hanya ID, versi,
  channel, kode error, dan nama variabel yang hilang.
- **Tenant isolation:** semua query template/aset/test send memakai `tenantId` dari JWT admin.
  ID aset dari tenant lain → `404` (bukan `403` agar tidak membocorkan keberadaan). Preview/test
  send tidak menerima `tenantId` dari body.

### D9 — Perubahan Admin API dan pemanggilan dari console

**Default: endpoint aditif; console memakai wrapper `HttpTransport`; SDK terbit tidak diubah.**

- Semua endpoint baru di bawah `/api/v1/admin`, memakai `AdminJwtGuard`, tenant dari JWT.
- Endpoint lama tetap ada; field respons baru bersifat aditif.
- `@notifhub/js` 0.3.0 dan `@notifhub/react` 0.2.0 **tidak diubah**. Console menambahkan modul
  lokal `console/src/lib/adminTemplates.ts` dan tipe lokal, memakai `HttpTransport` yang sudah
  diekspor (pola yang sama dengan `adminResend.ts`). Saat rilis SDK berikutnya, method dipindahkan
  ke `NotifHubAdminClient`.
- OpenAPI konsumen (`openapi/notifhub.json`) tidak berubah karena hanya memuat endpoint consumer.
  Swagger admin diperbarui.
- Body parser admin dinaikkan khusus: middleware JSON 1 MB untuk path `/api/v1/admin`, sementara
  parser global tetap `INGEST_MAX_PAYLOAD_BYTES` (64 KB) untuk ingest. Ini mempertahankan batas
  ingest lama dan mengizinkan template HTML yang wajar.
- Error validasi memakai `details.code` + `details.errors[]` (aditif pada bentuk error yang ada);
  pesan lama tetap kompatibel.

### D10 — UX editor console

**Default: editor dua panel dengan tab, preview sandbox, dan workflow publish.**

- Rute:
  - `/templates` — tabel dengan status (draft/published), versi, format, channel, locale, aktif,
    updated; filter status/channel/locale; aksi edit/clone/publish/deactivate.
  - `/templates/new` — buat draft.
  - `/templates/:id/edit` — editor draft/published (published dibuka read-only dengan tombol
    "Buat draft dari versi ini").
  - `/templates/assets` — manajer layout/theme/partial (tab), daftar versi, buat versi baru.
  - Riwayat versi/audit sebagai drawer/halaman `/templates/:id/history`.
- Editor:
  - Header: status, versi, dirty indicator, tombol Simpan draft, Preview, Test kirim, Publish,
    Clone, Riwayat.
  - Panel kiri: tab **Konten** (subject/preheader/body atau body teks), **Variabel** (tabel schema
    + JSON sample), **Aset** (layout/theme/partial), **Pengaturan** (fallback, strict, direction,
    locale).
  - Panel kanan: preview iframe desktop 600 px / mobile 375 px, tombol refresh, indikator render,
    daftar error/warning, resolusi aset/locale/direction, ukuran HTML.
  - Sidebar variabel: input per variabel dari schema; tombol "Isi dari contoh"; editor JSON sample
    dengan validasi zod; preview memakai nilai tersebut.
  - Channel-specific: email menampilkan subject/preheader/HTML/layout/theme; in-app/WhatsApp hanya
    body teks + counter karakter; field yang tidak relevan disembunyikan, bukan disabled.
  - Snippet menu menyisipkan starter HTML/teks di posisi kursor.
- Unsaved changes: dirty tracking; `beforeunload`; guard navigasi internal memakai `useBlocker`
  (memerlukan migrasi router ke `createBrowserRouter`, tanpa dependency baru); dialog konfirmasi.
- Publish dialog: checklist validasi, versi aset, locale/direction, catatan publish; server tetap
  memvalidasi ulang.
- Test send dialog: recipient, peringatan mode runtime, konfirmasi, hasil/error/rate limit.
- Riwayat: timeline versi + audit; tombol rollback membuat draft baru (bukan langsung live) dan
  menjelaskan konsekuensinya.
- Aksesibilitas: label eksplisit, `aria-describedby` untuk error, `aria-live` untuk hasil preview,
  fokus ke error summary setelah submit, status tidak hanya warna, target sentuh memadai.
- Tanpa CodeMirror di MVP: textarea monospace + snippet + preview. Fase 2 evaluasi CodeMirror.
- Tanpa block builder/drag-and-drop.

### D11 — Fase MVP dan yang ditunda

**MVP (satu siklus implementasi, setelah `setuju`):**

1. Migrasi schema + backfill + seed aman.
2. Renderer baru: resolusi published, locale/BCP-47 + RTL, escaping sadar-channel, helper
   whitelist, layout/theme/partial, validasi variabel, error taxonomy.
3. Admin API: draft/publish/clone/rollback/activate, versi, audit, aset, preview, test send.
4. Validator HTML/CSS/URL + sandbox preview + batas payload admin.
5. Console: list status, editor dua panel, variabel, preview, publish/test send, riwayat, aset,
   unsaved guard.
6. Test unit + E2E + regresi + dokumentasi.

**Ditunda (fase 2/3):**

- Block builder/drag-and-drop dan renderer block JSON.
- MJML/compiler atau CSS inliner (`juice`).
- Markdown in-app (menunggu rilis SDK yang mendukung render markdown).
- Meta approved WhatsApp template, media/attachment, pesan interaktif.
- Plain-text alternative otomatis untuk email.
- Diff visual/HTML antar versi, approval maker-checker, penjadwalan publish.
- Penghapusan/retensi aset dan audit, template import/export.
- CodeMirror/syntax highlighting, i18n UI console.
- Per-tenant sender identity, A/B test, analytics template.
- Browser automation (Playwright) — tetap tidak dipakai tanpa persetujuan terpisah.

### D12 — Strategi test/verifikasi dan backward compatibility

**Default: unit + E2E + regresi + manual UI; published packages tidak berubah.**

- Unit: escape HTML vs teks, helper whitelist, variable validator, safety scanner, sanitizer output
  data dinamis, locale candidates/RTL, layout composition, version selection, aset immutability.
- E2E baru (E12–E15): lifecycle draft/publish/clone/rollback; preview/test send; tenant isolation;
  legacy send/API compatibility. E1–E11 tetap lulus.
- Console: `typecheck` + `build`; verifikasi UI manual (tanpa Playwright).
- SDK: `sdk:test`, `sdk:typecheck`; perubahan hanya di console, bukan paket terbit.
- Backward compatibility: baris lama terkirim dengan output setara (golden test), API lama tetap
  2xx, SDK lama tetap bisa list/get/create/update/deactivate.
- Rollback: migrasi aditif; kode lama dapat berjalan di schema baru (kolom/tabel baru diabaikan),
  sehingga rollback deployment aman. Draft yang dibuat saat versi baru tidak terlihat oleh kode
  lama, tetapi published tetap terkirim.
- Detail rencana ada di §15.

---

## 6. Perubahan schema dan model data

### 6.1 Enum baru

```prisma
enum TemplateStatus {
  draft
  published
}

enum TemplateFormat {
  text
  html
  markdown // dicadangkan; ditolak API sampai SDK mendukung
}

enum TemplateDirection {
  auto
  ltr
  rtl
}

enum TemplateAuditAction {
  created
  draft_updated
  updated
  published
  deactivated
  activated
  cloned
  rolled_back
  test_sent
}
```

### 6.2 `NotificationTemplate` (perluasan)

```prisma
model NotificationTemplate {
  id               String   @id @default(uuid())
  tenantId         String   @default("default")
  key              String
  channel          Channel
  locale           String   @default("id")
  subject          String?
  preheader        String?  // email
  body             String
  format           TemplateFormat @default(text)
  direction        TemplateDirection @default(auto)
  version          Int      @default(1)
  revision         Int      @default(0)
  status           TemplateStatus @default(published)
  active           Boolean  @default(true)
  strictVariables  Boolean  @default(false)
  variables        Json?
  sampleData       Json?
  layoutId         String?
  layout           TemplateLayout? @relation(fields: [layoutId], references: [id])
  themeId          String?
  theme            TemplateTheme? @relation(fields: [themeId], references: [id])
  fallbackProvider String?
  fallbackChannel  Channel?
  publishedAt      DateTime? @db.Timestamptz
  publishedByAdminId String?
  createdAt        DateTime @default(now()) @db.Timestamptz
  updatedAt        DateTime @updatedAt @db.Timestamptz

  partials     TemplatePartialLink[]
  auditEvents  TemplateAuditEvent[]
  testSends    TemplateTestSend[]

  @@unique([tenantId, key, channel, locale, version])
  @@index([tenantId, key, channel, locale, active, status])
  @@index([tenantId, status, updatedAt])
  @@index([layoutId])
  @@index([themeId])
}
```

Catatan:
- `publishedAt`/`publishedByAdminId` `null` untuk draft.
- `active` tetap dipertahankan untuk kompatibilitas dan deaktivasi; worker mensyaratkan
  `active=true` **dan** `status=published`.
- `variables` dan `sampleData` divalidasi di service (zod), bukan constraint DB.
- `format` default `text`; service menginferensi `email → html` untuk create lama tanpa `format`.

### 6.3 Aset versioned

```prisma
model TemplateLayout {
  id              String   @id @default(uuid())
  tenantId        String   @default("default")
  key             String
  version         Int
  name            String
  content         String
  createdByAdminId String?
  createdAt       DateTime @default(now()) @db.Timestamptz

  templates NotificationTemplate[]

  @@unique([tenantId, key, version])
  @@index([tenantId, key, version])
}

model TemplateTheme {
  id              String   @id @default(uuid())
  tenantId        String   @default("default")
  key             String
  version         Int
  name            String
  tokens          Json
  createdByAdminId String?
  createdAt       DateTime @default(now()) @db.Timestamptz

  templates NotificationTemplate[]

  @@unique([tenantId, key, version])
  @@index([tenantId, key, version])
}

model TemplatePartial {
  id              String   @id @default(uuid())
  tenantId        String   @default("default")
  key             String
  version         Int
  name            String
  content         String
  createdByAdminId String?
  createdAt       DateTime @default(now()) @db.Timestamptz

  links TemplatePartialLink[]

  @@unique([tenantId, key, version])
  @@index([tenantId, key, version])
}

model TemplatePartialLink {
  templateId String
  partialId  String
  template   NotificationTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  partial    TemplatePartial    @relation(fields: [partialId], references: [id])

  @@id([templateId, partialId])
  @@index([partialId])
}
```

- Aset **append-only**: `POST` dengan `key` yang sama membuat `version = MAX(version)+1`.
- Key aset: `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$` (tanpa titik, agar tidak bentrok dengan sintaks
  partial Handlebars); nama tampilan maksimum 120 karakter.
- Tidak ada `PUT`/`DELETE` aset di MVP. Perubahan = versi baru; template published tetap menunjuk
  versi lama.
- `TemplatePartialLink` memungkinkan template memilih versi partial tertentu. Service menolak
  partial ganda dengan `key` sama dalam satu template dan partial milik tenant lain.
- Layout/theme hanya boleh direferensikan channel `email`; service memvalidasi.

### 6.4 Audit dan test send

```prisma
model TemplateAuditEvent {
  id             BigInt   @id @default(autoincrement())
  tenantId       String   @default("default")
  templateId     String
  templateVersion Int
  action         TemplateAuditAction
  actorAdminId   String?
  actorEmail     String?
  note           String?
  metadata       Json?
  createdAt      DateTime @default(now()) @db.Timestamptz

  template NotificationTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@index([tenantId, templateId, createdAt])
  @@index([tenantId, createdAt])
}

model TemplateTestSend {
  id                String   @id @default(uuid())
  tenantId          String   @default("default")
  templateId        String
  templateVersion   Int
  channel           Channel
  recipientMasked   String
  recipientHash     String
  requestKey        String?
  status            String   // sent | simulated | failed
  providerName      String?
  providerMessageId String?
  errorCode         String?
  errorMessage      String?
  requestedByAdminId String?
  createdAt         DateTime @default(now()) @db.Timestamptz

  template NotificationTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@unique([tenantId, requestKey])
  @@index([tenantId, createdAt])
  @@index([templateId, createdAt])
  @@index([requestedByAdminId, createdAt])
}
```

- Audit/test send tidak menyimpan body, sample data, atau recipient lengkap.
- `requestKey` opsional; replay dengan key sama mengembalikan baris yang sama (idempotensi UI).
- Retensi audit/test send: MVP tanpa cleanup; fase 2 menambahkan job retensi (mis. 180 hari untuk
  test send) dengan keputusan terpisah.

### 6.5 Migrasi dan backfill

Langkah migrasi (satu migrasi Prisma, aditif):

1. Buat enum baru.
2. Tambah kolom `NotificationTemplate` dengan default:
   - `status='published'` (semua baris lama dianggap published),
   - `format='text'`,
   - `direction='auto'`,
   - `revision=0`,
   - `strictVariables=false`,
   - `preheader=null`, `variables=null`, `sampleData=null`, `layoutId=null`, `themeId=null`,
     `publishedAt=null`, `publishedByAdminId=null`.
3. Backfill:
   ```sql
   UPDATE "NotificationTemplate"
   SET "format" = 'html'
   WHERE "channel" = 'email';

   UPDATE "NotificationTemplate"
   SET "publishedAt" = "updatedAt"
   WHERE "status" = 'published' AND "publishedAt" IS NULL;
   ```
4. Buat tabel `TemplateLayout`, `TemplateTheme`, `TemplatePartial`, `TemplatePartialLink`,
   `TemplateAuditEvent`, `TemplateTestSend` + index/unique.
5. Tidak ada perubahan pada `Notification`, `NotificationRecipient`, `DeliveryAttempt`,
   `DeliveryEvent`, `BillingEvent`.

Rollback migrasi:
- Karena aditif, rollback kode cukup; kolom/tabel baru diabaikan kode lama.
- Jika perlu rollback schema, drop tabel baru lalu drop kolom baru. Data template published lama
  tetap utuh. Draft yang dibuat setelah migrasi akan hilang jika kolom `status`/aset di-drop;
  ekspor draft terlebih dahulu bila rollback dilakukan setelah ada data baru.

---

## 7. Pipeline render dan perilaku worker

### 7.1 Resolusi

`TemplateService.resolve(tenantId, key, channel, locale)`:

1. Bangun kandidat locale: locale diminta apa adanya, locale diminta yang dinormalisasi BCP-47
   (`id-id` → `id-ID`), language part (`id-ID` → `id`), lalu `DEFAULT_LOCALE` (apa adanya dan
   dinormalisasi); dedupe, maksimum 5 kandidat. Ini menjaga baris lama yang tersimpan dengan case
   berbeda tetap ditemukan.
2. Query per kandidat (mempertahankan prioritas): `tenantId`, `key`, `channel`, `locale`,
   `active=true`, `status='published'`, `orderBy version desc`.
3. `include` relasi `layout`, `theme`, `partials.partial` agar render tidak perlu query tambahan.
4. Tidak ditemukan → `null` (worker `UnrecoverableError('template_not_found')`, perilaku lama).

`resolveMany` untuk catch-up in-app memakai `include` yang sama dan memilih locale rank + versi
tertinggi seperti sekarang.

### 7.2 Validasi data runtime

Sebelum render:

- Muat schema variabel.
- Untuk setiap variabel `required`: cek path ada dan bukan `null`/`undefined`; validasi tipe
  dasar.
- `strictVariables=true`: kumpulkan semua pelanggaran; jika ada → `TemplateRenderError` dengan
  `code='template_variable_missing'` dan `variables=[nama]` (tanpa nilai).
- `strictVariables=false`: isi nilai hilang dengan `default` atau string kosong; log
  `template.variable_missing` + metric; lanjut render.
- `date`: terima ISO-8601 string/Date; `number`: number atau string numerik; `boolean`: boolean
  atau `"true"/"false"`; `url`/`email`: validasi format; `array`: array.

### 7.3 Kompilasi dan rendering

- Buat environment `Handlebars.create()` per template revision (cache), daftarkan helper
  whitelist dan partial dari `TemplatePartialLink` (nama = `partial.key`).
- Kompilasi:
  - Email: `subject` dan `preheader` dirender sebagai **nilai teks mentah** (`noEscape`);
    layout menampilkannya dengan `{{subject}}`/`{{preheader}}` agar di-escape tepat satu kali.
    `body` (fragmen) dirender dengan escaping HTML; `layout` (dokumen lengkap) memuat
    `{{{body}}}` tepat satu kali. Subject untuk header email dibersihkan dari CR/LF dan karakter
    kontrol. Context layout:
    `{ ...data, body, subject, preheader, locale, lang, dir, isRtl, theme }`.
  - Teks: `subject`/`body` dengan `noEscape: true`; helper tetap tersedia. Ini berlaku untuk
    in-app/WhatsApp/SMS dan subject email, karena output-nya bukan HTML.
- Cache compiled delegate:
  - Key `template:<id>:<revision>:<field>` dan `layout:<layoutId>` dan `partial:<partialId>`.
  - Karena baris immutable, cache tidak perlu invalidasi kecuali restart; batas 500 entri,
    clear saat penuh (pola yang ada).
- Output:
  - Email: `body = layout ? render(layout, { body: render(body) }) : render(body)`.
  - `subject`/`preheader` final; subject dibersihkan dari CR/LF dan karakter kontrol header.
  - Teks: `body` final; `subject` opsional.
  - Sebelum dikembalikan/dikirim, HTML email/preview melewati **sanitizer output runtime** untuk
    menangkap data dinamis dari `{{{ }}}`; hasil yang dibersihkan dicatat dan diukur ulang
    terhadap batas ukuran channel.
- Cache tidak boleh mencampur tenant: key selalu menyertakan ID baris yang sudah tenant-scoped.

### 7.4 Error taxonomy

| Kode | Penyebab | Perilaku worker |
|---|---|---|
| `template_not_found` | Tidak ada published cocok | `UnrecoverableError`, failed, 1 attempt |
| `template_render_failed` | Handlebars syntax/runtime/partial hilang | `UnrecoverableError`, failed, 1 attempt |
| `template_variable_missing` | Required hilang/tipe salah pada strict | `UnrecoverableError`, failed, 1 attempt |
| `template_layout_invalid` | Layout tanpa `{{{body}}}` / >1 | `UnrecoverableError` (seharusnya dicegah publish) |
| `template_too_large` | Output melebihi batas channel | `UnrecoverableError`, failed, 1 attempt |

Worker email/in-app/WhatsApp membungkus error template non-retryable menjadi `UnrecoverableError`
agar tidak retry 5x; error provider tetap retry seperti sekarang.

### 7.5 Perubahan kontrak internal

- `TemplateService.render` menerima hasil resolusi yang sudah membawa aset dan schema; tetap
  sinkron (tidak ada query di dalam render).
- `RenderedTemplate` diperluas: `{ subject, preheader, body, format, warnings }`.
- `ProviderSendInput` email tetap `subject`/`body` (body sudah dokumen email lengkap). Tidak ada
  perubahan provider interface di MVP.
- In-app/WhatsApp tetap memakai `body` teks.
- `TemplateService` tidak lagi mengompilasi dengan `Handlebars.compile` global; menggunakan
  environment terisolasi.

---

## 8. Perilaku per channel

### 8.1 Email

- `format=html`; `body` adalah fragmen HTML; layout membungkus.
- `subject` wajib saat publish template baru (maks 255, tanpa CR/LF). Baris lama tanpa subject
  tetap boleh terkirim (kompatibilitas).
- `preheader` opsional (maks 200), fallback ke subject di layout.
- Layout wajib table-based, lebar 600 px, `role="presentation"`, gambar `alt`, CTA `<a>`.
- Responsive: media query `max-width: 480px`; kolom dua ditumpuk.
- Dark mode: `@media (prefers-color-scheme: dark)` + `[data-ogsc]`; warna fallback tetap terbaca
  di client tanpa dark mode.
- Kompatibilitas client: target Gmail web/iOS, Apple Mail, Outlook desktop, Outlook.com, Yahoo.
  Batasan: dark mode dan media query tidak seragam; tidak ada jaminan pixel-perfect.
- Ukuran: warning > 100 KB (Gmail clipping), hard limit 256 KB sebelum/sesudah render; layout +
  partial total maksimum 256 KB; body maksimum 256 KB.
- Plain-text alternative: **tidak** di MVP (email tetap HTML-only seperti sekarang); dicatat
  sebagai fase 2.
- Gambar: hanya `http`/`https`; tidak ada upload/attachment di MVP.

### 8.2 In-app

- `format=text`; body teks polos, newline dipertahankan semaksimal mungkin oleh konsumen (SDK
  saat ini menampilkan teks; CSS `white-space` adalah tanggung jawab aplikasi).
- HTML ditolak untuk template baru; markdown ditunda sampai `@notifhub/js`/`@notifhub/react`
  merilis dukungan render (versi terbit tidak diubah).
- Subject opsional (SSE sudah membawa subject); tidak ada layout/theme/partial.
- Batas panjang: 10.000 karakter (peringatan > 4.000); mencegah payload SSE membengkak.
- Preview menampilkan teks apa adanya; tidak ada iframe HTML.

### 8.3 WhatsApp

- `format=text`; body teks polos; tidak ada HTML/markdown.
- Batas 4.096 karakter setelah render (batas teks Cloud API); publish memvalidasi dengan sample
  data; runtime memvalidasi output akhir.
- Subject/preheader/layout/theme/partial ditolak untuk template baru.
- Bukan Meta approved-template; provider tetap `type: "text"`. Pemetaan template Meta
  (nama template + parameter) ditunda dan membutuhkan kolom/flow terpisah.
- Normalisasi nomor tetap di provider (bukan di template).

### 8.4 SMS

- Channel ada di enum dan console, tetapi belum ada provider/worker. Template SMS dapat disimpan
  sebagai `text` dengan batas 1.600 karakter (warning), tetapi pengiriman belum didukung.
- Tidak ada layout/theme/partial. Ini mencegah model template dipaksa sama dengan email.

---

## 9. Perubahan Admin API

Semua endpoint di bawah `/api/v1/admin`, `AdminJwtGuard`, tenant dari JWT.

### 9.1 Endpoint lama (tetap, dengan field baru opsional)

| Method | Path | Perubahan |
|---|---|---|
| GET | `/templates` | Tambah filter `status`, `format`; respons memuat field baru. `view=summary` (baru) mengembalikan metadata + `bodyPreview` ≤ 200 karakter tanpa `body` penuh; default lama tetap `body` penuh agar SDK/console lama kompatibel. Console baru memakai `view=summary`. |
| POST | `/templates` | Menerima field baru; tanpa `status` tetap `published` (kompatibel); console mengirim `draft`. Draft tanpa `version` memakai `MAX(version)+1`; published lama mempertahankan default versi 1. |
| GET | `/templates/:id` | Respons memuat field baru + relasi aset ringkas. |
| PUT | `/templates/:id` | Tetap ada; konten published → auto-publish versi baru (deprecated). Draft → update in-place. Metadata published → update in-place. |
| DELETE | `/templates/:id` | Tetap `active=false`; audit `deactivated`. |

### 9.2 Endpoint baru

| Method | Path | Fungsi |
|---|---|---|
| POST | `/templates/:id/publish` | Publish draft; body `{ expectedRevision, note? }`. |
| POST | `/templates/:id/activate` | Aktifkan published tertinggi yang nonaktif; jika bukan tertinggi → 409. |
| POST | `/templates/:id/clone` | Buat draft baru; body `{ key?, locale?, note? }`; channel sama. |
| POST | `/templates/:id/rollback` | Buat draft baru dari `{ sourceVersion, note? }`. |
| GET | `/templates/:id/versions` | Riwayat versi untuk key/channel/locale yang sama; ringkasan tanpa body penuh (`bodyPreview`). |
| GET | `/templates/:id/audit` | Audit paginasi. |
| GET | `/templates/:id/test-sends` | Riwayat test send (recipient masked). |
| POST | `/templates/preview` | Preview konten inline (belum disimpan). |
| POST | `/templates/:id/preview` | Preview versi tersimpan + sample override. |
| POST | `/templates/:id/test-send` | Kirim uji ke recipient eksplisit. |
| GET | `/template-layouts` | Daftar layout (filter `key`, `latest`). |
| POST | `/template-layouts` | Buat versi layout baru. |
| GET | `/template-layouts/:id` | Detail layout. |
| GET | `/template-themes` | Daftar theme. |
| POST | `/template-themes` | Buat versi theme baru. |
| GET | `/template-themes/:id` | Detail theme. |
| GET | `/template-partials` | Daftar partial. |
| POST | `/template-partials` | Buat versi partial baru. |
| GET | `/template-partials/:id` | Detail partial. |

Tidak ada `PUT`/`DELETE` aset di MVP.

### 9.3 Contoh request/response

Create draft:

```http
POST /api/v1/admin/templates
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{
  "key": "order.shipped",
  "channel": "email",
  "locale": "id-ID",
  "format": "html",
  "status": "draft",
  "subject": "Pesanan {{order.number}} dikirim",
  "preheader": "Kabar baik untuk {{customer.name}}",
  "body": "<p>Halo {{customer.name}},</p><p>Pesanan {{order.number}} sudah dikirim.</p>",
  "layoutId": "layout-uuid",
  "themeId": "theme-uuid",
  "partialIds": ["partial-header-uuid", "partial-footer-uuid"],
  "variables": { "version": 1, "variables": ["..."] },
  "sampleData": { "customer": { "name": "Budi" }, "order": { "number": "INV-001" } },
  "strictVariables": true,
  "direction": "auto"
}
```

Respons `201` memuat `TemplateView` (field lama + baru), `validation` (errors/warnings; draft boleh
disimpan walau ada error sintaks), dan `revision=0`.

Publish:

```http
POST /api/v1/admin/templates/:id/publish
{ "expectedRevision": 3, "note": "Ganti header promo" }
```

Respons `200`:

```json
{
  "id": "template-uuid",
  "status": "published",
  "version": 4,
  "revision": 4,
  "active": true,
  "publishedAt": "2026-11-16T06:00:00.000Z",
  "supersededTemplateId": "template-lama-uuid",
  "validation": { "errors": [], "warnings": [] }
}
```

Preview:

```http
POST /api/v1/admin/templates/:id/preview
{ "sampleData": { "customer": { "name": "Siti" } }, "viewport": "desktop" }
```

Respons `200`:

```json
{
  "templateId": "template-uuid",
  "version": 4,
  "channel": "email",
  "format": "html",
  "subject": "Pesanan INV-001 dikirim",
  "preheader": "Kabar baik untuk Siti",
  "html": "<!doctype html>...",
  "errors": [],
  "warnings": [{ "code": "unused_variable", "message": "Variabel order.total tidak dipakai" }],
  "missingVariables": [],
  "resolved": {
    "locale": "id-ID",
    "direction": "ltr",
    "layout": { "id": "layout-uuid", "key": "base", "version": 3 },
    "theme": { "id": "theme-uuid", "key": "brand", "version": 2 },
    "partials": [{ "id": "partial-header-uuid", "key": "header", "version": 1 }]
  },
  "bytes": 18234,
  "renderMs": 41
}
```

Test send:

```http
POST /api/v1/admin/templates/:id/test-send
{ "recipient": "qa@example.com", "requestKey": "3f0c..." }
```

Respons `200`:

```json
{
  "status": "simulated",
  "mode": "development",
  "channel": "email",
  "provider": "smtp",
  "providerMessageId": "dev-log-only",
  "recipientMasked": "q***@example.com",
  "auditId": "test-send-uuid"
}
```

Error validasi (contoh):

```json
{
  "statusCode": 422,
  "message": "Template validation failed",
  "error": "Unprocessable Entity",
  "details": {
    "code": "template_validation_failed",
    "errors": [
      { "code": "unsafe_html", "path": "body", "message": "<script> tidak diizinkan" },
      { "code": "missing_required_variable", "path": "variables", "message": "order.total wajib ada di sampleData" }
    ]
  },
  "timestamp": "...",
  "path": "/api/v1/admin/templates/.../publish",
  "requestId": "..."
}
```

### 9.4 Aturan validasi input

- `key`, `locale`, `channel` tetap seperti sekarang.
- `body`: 1–262.144 karakter; email harus HTML valid (sintaks Handlebars dicek saat publish;
  draft boleh invalid).
- `layout.content`/`partial.content`: 1–262.144 karakter; total partial per template ≤ 262.144.
- `variables`: JSON ≤ 32 KB, maksimum 100 variabel.
- `sampleData`: JSON ≤ 32 KB.
- `preheader` ≤ 200; `subject` ≤ 255.
- `note` ≤ 500.
- `format` wajib cocok channel; `direction` enum; `strictVariables` boolean.
- `layoutId`/`themeId`/`partialIds` harus milik tenant dan channel email.
- Test send recipient: email valid ≤ 320, atau E.164 `+` 8–15 digit; tolak CR/LF.
- `expectedRevision` integer ≥ 0.
- Body parser admin 1 MB; parser global ingest tetap 64 KB. `HttpExceptionFilter` disesuaikan agar
  pesan 413 memakai batas yang relevan (admin vs ingest), bukan selalu `INGEST_MAX_PAYLOAD_BYTES`.

### 9.5 Rate limit

- Preview: 120/menit per admin (fallback IP) melalui `ThrottlerGuard` + `@Throttle`.
- Test send: 10/jam/admin dan 30/hari/tenant, dihitung dari `TemplateTestSend` (akurat lintas
  instance), bukan hanya in-memory.
- Publish/clone/rollback: tidak perlu limit khusus; dilindungi auth + validasi.
- Login tetap 5/menit seperti sekarang.

---

## 10. Perubahan console

### 10.1 Modul dan tipe lokal

- `console/src/lib/adminTemplates.ts`: wrapper `HttpTransport` (base `/api/v1/admin`) untuk
  endpoint baru, `retry:false` pada mutasi.
- `console/src/lib/templateTypes.ts`: tipe lokal (`TemplateDetail`, `TemplateVersion`,
  `TemplateAuditEvent`, `PreviewResult`, `PublishResult`, `TestSendResult`, `LayoutVersion`,
  `ThemeVersion`, `PartialVersion`). Tipe `Template` dari SDK tetap dipakai untuk field lama;
  field baru opsional agar kompatibel.
- Tidak ada import `fetch`/`axios` langsung; tidak mengubah `@notifhub/js`.

### 10.2 Halaman dan komponen

| Rute | Isi |
|---|---|
| `/templates` | Tabel status/versi/format/channel/locale/aktif/updated; filter status/channel/locale; aksi. |
| `/templates/new` | Form draft baru; channel-specific. |
| `/templates/:id/edit` | Editor dua panel; published read-only + "Buat draft dari versi ini". |
| `/templates/:id/history` | Daftar versi + timeline audit + rollback. |
| `/templates/assets` | Tab layout/theme/partial; daftar versi; buat versi baru. |

Komponen baru: `TemplateStatusBadge`, `TemplateEditorLayout`, `PreviewPane`, `VariableEditor`,
`SampleDataEditor`, `AssetSelector`, `PublishDialog`, `TestSendDialog`, `VersionTimeline`,
`AuditTimeline`, `UnsavedChangesGuard`, `SnippetMenu`, `ChannelFields`.

### 10.3 State dan data fetching

- TanStack Query key: `['templates', filters]`, `['template', id]`,
  `['template-versions', key, channel, locale]`, `['template-audit', id]`,
  `['template-assets', type, key]`.
- Mutasi meng-invalidate key terkait; publish invalidate list + versi + audit.
- Preview memakai `AbortController`; debounce 500–700 ms; tampilkan "preview usang" saat berubah.
- Sample data disimpan sebagai string JSON di form; validasi zod sebelum preview/publish; error
  ditampilkan per field.
- Tidak ada polling; refresh manual seperti halaman lain.

### 10.4 Unsaved changes dan accessibility

- Dirty = nilai form berbeda dari snapshot terakhir.
- `beforeunload` untuk tab/browser.
- Guard navigasi internal dengan `useBlocker` (React Router v6); perlu migrasi `App` ke
  `createBrowserRouter` (paket yang sama, tanpa dependency baru). Jika migrasi ditunda, minimal
  konfirmasi pada tombol Batal/Kembali + `beforeunload`; ini dicatat sebagai batasan sementara.
- Error summary di atas form dengan tautan ke field; `aria-live="polite"` untuk hasil preview;
  fokus otomatis ke summary setelah submit gagal.
- Status memakai teks + badge, bukan hanya warna; kontras mengikuti Bootstrap.
- Semua input punya label; tombol ikon punya `aria-label`; iframe preview punya `title`.

### 10.5 Error state

- `401` → handler global logout (sudah ada).
- `403`/`404` → halaman/empty state yang jelas; ID tenant lain tidak membocorkan keberadaan.
- `409 template_conflict` → dialog "versi berubah, muat ulang".
- `422` → daftar error validasi per field + panel error preview.
- `429` → pesan rate limit dengan waktu tunggu.
- Provider error test send → pesan mode/provider + `requestId` untuk troubleshooting.

---

## 11. Keamanan dan sanitasi (rinci)

### 11.1 Model ancaman

| Ancaman | Mitigasi |
|---|---|
| XSS di browser admin lewat preview | iframe `sandbox=""`, `referrerpolicy=no-referrer`, CSP meta, validator publish, tidak ada `dangerouslySetInnerHTML` di luar iframe. |
| XSS di email client | Email client menolak script; validator menolak tag/atribut berbahaya; sanitizer output runtime menangkap data dinamis; tidak ada JS di template. |
| Data dinamis berbahaya lewat `{{{ }}}` | Sanitizer output runtime setelah render; peringatan di console; gunakan `{{ }}` untuk data tidak tepercaya. |
| SSRF | Renderer tidak mengambil gambar/URL; tidak ada fetch server-side. |
| Prototype pollution/akses properti | Handlebars `allowProtoPropertiesByDefault=false`, `allowProtoMethodsByDefault=false`, data object biasa. |
| Helper berbahaya | Hanya helper whitelist; tidak ada helper dari input admin. |
| Header injection pada email | Subject divalidasi tanpa CR/LF; recipient divalidasi; provider menangani header. |
| Kebocoran lintas tenant | Semua query `tenantId`; validasi kepemilikan aset; test E2E. |
| Penyalahgunaan test send | Rate limit per admin/tenant, recipient eksplisit, audit, tanpa body inline. |
| Secret/PII di log | Tidak ada body/sample/recipient lengkap; recipient masked/hash; error code saja. |
| Payload besar/DoS | Batas DTO, parser admin 1 MB, preview debounce + rate limit, batas render. |

### 11.2 Aturan validator HTML (ringkas)

- Tag dilarang: `script`, `iframe`, `object`, `embed`, `form`, `input`, `textarea`, `select`,
  `button`, `base`, `link`, `svg`, `math`; meta hanya `charset`, `viewport`, `color-scheme`,
  `x-apple-disable-message-reformatting`, `Content-Type`, `X-UA-Compatible` (tanpa refresh).
- Atribut: tolak semua `on*`; `srcdoc`; `formaction`; `xlink:href` berbahaya.
- URL: `http`, `https`, `mailto`, `tel`, `#`; tolak `javascript:`, `vbscript:`, `data:`, `file:`;
  decode entitas sebelum cek.
- CSS: tolak `expression(`, `behavior:`, `-moz-binding`, `@import`, `javascript:` di `url()`.
- Komentar kondisional Outlook (`<!--[if mso]>`) diizinkan; komentar biasa diizinkan.
- Error memblokir publish/test send; warning tidak memblokir (mis. variabel tidak dideklarasikan,
  gambar tanpa `alt`, HTML > 100 KB).
- Baris legacy yang dipublish sebelum fitur ini tidak melalui validator statis publish baru, tetapi
  output HTML-nya tetap melewati sanitizer runtime; konstruksi berbahaya dihapus (dan dicatat).
  Preview baris legacy tetap memakai iframe sandbox. Jika nanti diperlukan fail-closed untuk baris
  lama, tambahkan penanda `validatedAt`/`validationVersion` lewat desain terpisah.

### 11.3 Preview

- `iframe sandbox=""` wajib; jangan pernah `allow-scripts` atau `allow-same-origin`.
- `srcDoc` dari server; jangan menyisipkan HTML ke DOM console.
- CSP meta bila memungkinkan; jika layout berupa dokumen penuh, sisipkan setelah `<head>`.
- Nonaktifkan form/popup/navigasi di dalam iframe; link eksternal tidak bisa dibuka dari preview
  (sandbox tanpa `allow-popups`), atau sediakan tombol "salin URL" yang aman bila diperlukan.
- Preview tidak boleh memuat resource lokal/intranet; hanya gambar http/https.

---

## 12. Localization dan RTL

- Locale disimpan sebagai BCP-47 (`id`, `id-ID`, `en`, `ar`). Kandidat resolusi:
  `id-ID` → `id` → `DEFAULT_LOCALE` (dinormalisasi), dedupe.
- `direction` per template: `auto` (deteksi bahasa RTL: `ar`, `he`, `fa`, `ur`, `ps`, `sd`, `ug`,
  `yi`, `dv`, `ku`), `ltr`, `rtl`.
- Renderer menyuplai `locale`, `lang`, `dir`, `isRtl` ke body/layout. Layout starter memakai
  `dir="{{dir}}"` dan `text-align` eksplisit berdasarkan `isRtl`; tabel tetap dipakai karena
  dukungan CSS logical properties di email client terbatas.
- Theme dapat menentukan font stack yang cocok untuk Arab/Hebrew; per-locale theme otomatis
  ditunda (bisa memilih theme berbeda per template).
- Subject/preheader email tidak memerlukan arah khusus; client menangani.
- Fallback locale tetap `DEFAULT_LOCALE` (bukan per-key fallback) di MVP. Jika template locale
  tidak ada, worker memakai default; tidak ada error baru.
- Console menampilkan locale/direction dan preview sesuai nilai template; tidak ada UI terjemahan
  berdampingan di MVP.

---

## 13. Migrasi dan kompatibilitas ke belakang

### 13.1 Data lama

- Semua baris lama menjadi `status='published'`, `active` tidak berubah, `format` diinferensi,
  `publishedAt=updatedAt`, `strictVariables=false`, `revision=0`, tanpa aset.
- Render lama tetap memakai body saja (layout/theme/partial null), sehingga output setara.
- Satu perubahan yang disengaja: channel teks (in-app/WhatsApp) tidak lagi meng-escape HTML
  entities. Contoh: `Budi & Co` tetap `Budi & Co` (sebelumnya `Budi &amp; Co`). Selain itu,
  **subject email** kini dirender sebagai teks header tanpa HTML escaping dan CR/LF dibuang;
  sebelumnya `&` menjadi `&amp;` di subject. Ini koreksi bug untuk output non-HTML; dicatat di
  laporan verifikasi dan diuji golden.
- Body email tetap escape HTML seperti sekarang; `{{{ }}}` tetap mentah. Satu-satunya perubahan
  output email legacy adalah sanitizer runtime yang menghapus konstruksi berbahaya (mis. `<script>`,
  event handler, URL berbahaya); template legacy yang bersih tidak berubah.

### 13.2 API lama

- `GET/POST/GET :id/PUT/DELETE` tetap tersedia dan 2xx untuk input valid yang sebelumnya diterima.
  Input yang melanggar aturan keamanan baru (mis. `<script>`) dapat menghasilkan `422`; ini
  perubahan yang disengaja dan dicatat di laporan.
- `POST` tanpa `status`/`format` tetap published + format inferensi.
- `PUT` konten published membuat versi published baru (bukan 409), sehingga klien lama tetap
  mendapat 200 dan perubahan langsung live. Baris lama tidak dimutasi.
- `DELETE` tetap `active=false`.
- Field respons baru aditif; SDK 0.3.0 mengabaikannya.
- Batasan yang didokumentasikan: klien lama yang menyimpan ID versi lama setelah `PUT` akan
  memegang ID non-aktif; deactivate/update berikutnya pada ID itu tidak memengaruhi versi aktif.
  Console baru tidak memakai jalur ini. Jalur lama deprecated dan dihapus pada major berikutnya.

### 13.3 SDK dan paket

- `@notifhub/js` 0.3.0 dan `@notifhub/react` 0.2.0 tidak diubah.
- Console menambah wrapper lokal; tidak ada perubahan `openapi/notifhub.json` konsumen.
- Root version naik ke `0.11.0`; `notifhub-console` `0.2.0` (privat). Go SDK tidak berubah.

### 13.4 Rollout

1. Deploy migrasi (aditif) + backend baru.
2. Verifikasi worker tetap mengirim baris lama; E1–E11 lulus.
3. Deploy console baru.
4. Buat draft pertama, preview, test send, publish.
5. Setelah stabil, deprecated legacy `PUT` dapat dihapus pada rilis major berikutnya.

### 13.5 Rollback

- Kode lama dapat berjalan di schema baru (kolom/tabel baru diabaikan), sehingga rollback
  deployment aman.
- Draft/aset yang dibuat saat versi baru tidak terlihat oleh kode lama; published tetap terkirim.
- Rollback schema (drop kolom/tabel) hanya jika benar-benar diperlukan dan setelah ekspor draft.

---

## 14. Fase MVP dan fase lanjutan

### MVP

- Migrasi + backfill.
- Renderer: resolusi published, locale/RTL, escaping sadar-channel, layout/theme/partial,
  variabel, helper, error taxonomy.
- API: draft/publish/clone/rollback/activate, versi, audit, aset, preview, test send.
- Validator + sandbox + batas payload.
- Console: list status, editor dua panel, variabel/sample, preview, publish, test send, riwayat,
  aset, unsaved guard.
- Test + dokumentasi + laporan verifikasi.

### Fase 2

- Diff versi (field-level/HTML), approval maker-checker, penjadwalan publish.
- Plain-text alternative email, markdown in-app setelah rilis SDK.
- CodeMirror/syntax highlight, template import/export.
- Retensi audit/test send, penghapusan aset dengan cek penggunaan.
- Evaluasi `juice`/MJML dengan keputusan dependency terpisah.

### Fase 3

- Block builder/drag-and-drop di atas kontrak yang sama.
- Meta approved WhatsApp template + media.
- Per-tenant sender identity, A/B, analytics, template marketplace internal.

---

## 15. Rencana verifikasi end-to-end dan regresi

### 15.1 Perintah

```bash
git status --porcelain
npx prisma migrate status
npm run typecheck
npm run build
npm run test:e2e -- --runInBand
npm run sdk:test
npm run console:typecheck
npm run console:build
```

### 15.2 Unit test (backend)

- Escaping email vs teks (`&`, `'`, `<`, `>`), `{{{ }}}`.
- Helper whitelist dan penolakan helper tidak dikenal.
- Variable validator: required/optional/default/type/path nested; strict vs non-strict.
- Safety scanner: script, event handler, javascript URL, CSS expression, entity-encoded scheme.
- Locale candidates: `id-ID → id → default`, normalisasi case, RTL.
- Layout composition: `{{{body}}}` tepat satu, partial terdaftar, theme token.
- Resolusi versi: draft tidak terpilih, published tertinggi, inactive tidak terpilih.
- Imutabilitas aset: template published tetap memakai versi lama setelah aset baru dibuat.

### 15.3 E2E baru (Jest + supertest)

| ID | Skenario |
|---|---|
| E12 | Legacy: template email/in-app lama tetap terkirim; output email setara golden; teks tidak meng-escape entity. |
| E13 | Lifecycle: create draft (worker tidak memilih) → edit → preview → publish (worker memilih, versi lama inactive) → clone → rollback → publish. |
| E14 | Publish gate: sintaks invalid, variabel required hilang, HTML berbahaya, WhatsApp > 4096, email tanpa subject, in-app HTML → 422; draft tetap tersimpan. |
| E15 | Preview: saved/unsaved, layout/theme/partial/locale/direction, sample override, missing variables, error syntax. |
| E16 | Test send: email dev log-only + audit; in-app 400; rate limit 429; tenant isolation. |
| E17 | Tenant isolation: template/aset/audit/test send tenant lain → 404; asset ID cross-tenant ditolak. |
| E18 | Concurrency: publish dengan `expectedRevision` salah → 409; publish ulang idempoten? (publish kedua pada published → 409). |
| E19 | Payload: admin template 1 MB diterima sampai batas DTO; ingest > 64 KB tetap 413. |

E1–E11 (auth, ingest, in-app, email/preferensi, webhook, topic, resend) tetap lulus tanpa
perubahan perilaku.

### 15.4 Verifikasi DB/SQL

- `NotificationTemplate`: status/format/publishedAt/revision/active sesuai transisi.
- Hanya satu `active=true` published per `(tenant,key,channel,locale)` setelah publish.
- `TemplateAuditEvent` bertambah dengan aksi dan versi yang benar.
- `TemplateTestSend` tidak menyimpan recipient lengkap; status/provider sesuai.
- `TemplateLayout/Theme/Partial` bertambah versi, tidak ada update in-place.
- `TemplatePartialLink` menunjuk versi yang benar.

### 15.5 Verifikasi manual console (tanpa Playwright)

1. Login, buka templates; filter status/channel/locale.
2. Buat draft email; isi subject/body; pilih layout/theme/partial; isi variabel/sample.
3. Preview desktop/mobile; cek error/warning; coba sample kurang required.
4. Simpan draft; refresh; pastikan state kembali.
5. Publish; cek dialog, error validasi, status berubah; worker mengirim versi baru.
6. Test send email (dev log-only) dan WhatsApp (stub/dev); cek pesan mode dan audit.
7. Clone ke locale lain; edit; publish; cek fallback locale.
8. Rollback ke versi lama; preview; publish; cek audit.
9. Buka published; pastikan read-only dan tombol buat draft.
10. Coba tinggalkan editor dengan perubahan; pastikan guard.
11. Cek aksesibilitas: tab order, label, error summary, `aria-live`.
12. Cek iframe preview `sandbox`/`referrerpolicy` di DOM (manual DevTools).
13. Cek 401 → logout; 429 → pesan rate limit.

### 15.6 Keamanan

- Draft berisi `<script>alert(1)</script>`: preview tidak mengeksekusi; publish 422 `unsafe_html`.
- Link `javascript:alert(1)` dan `&#106;avascript:`: publish 422.
- `<iframe srcdoc>`/`<svg onload>`: publish 422.
- CSS `expression()`/`@import`: publish 422.
- Tenant B mengakses template/aset/audit/test send tenant A: 404.
- Test send melebihi limit: 429; tidak ada notifikasi/billing baru.
- Log: tidak ada body/sample/recipient lengkap/secret.

### 15.7 Kinerja dan observability

- Preview p95 < 300 ms di lokal untuk template 50 KB; render worker tetap wajar.
- Cache compiled delegate tidak bocor antar tenant; batas entri.
- Metrik baru: `notifhub_template_render_errors_total{code}`,
  `notifhub_template_variable_missing_total{channel}`,
  `notifhub_template_preview_duration_seconds`, `notifhub_template_test_send_total{channel,status}`.
- Log event: `template.preview.rendered` (id/versi/bytes/renderMs), `template.test_send`,
  `template.published`, `template.variable_missing` (nama saja), tanpa PII.

### 15.8 Bukti yang akan dilaporkan setelah implementasi

- Perintah + status exit + ringkasan output (typecheck/build/test/e2e/console).
- Contoh curl + status code untuk create draft/publish/preview/test send/error.
- Query SQL/DB untuk status/versi/audit/test send.
- Hasil regresi E1–E11.
- Deviasi dari desain, batasan yang tersisa, dan kondisi lingkungan (Node/Postgres/Redis/Docker).
- Konfirmasi tidak ada perubahan `@notifhub/js`/`@notifhub/react`/Go module/tiga lane auth.

---

## 16. Risiko dan pertanyaan terbuka

### Risiko

1. **Kompatibilitas email client** tidak bisa dijamin sempurna; layout starter dan verifikasi
   manual adalah mitigasi. Dark mode sangat bervariasi.
2. **Validator HTML/CSS berbasis pola** bisa dilewati; sandbox preview dan kebijakan "admin
   tepercaya" adalah lapisan pertahanan. Parser HTML penuh (dependency) dipertimbangkan fase 2.
3. **Aset append-only** menambah jumlah baris; UI harus jelas menampilkan versi dan penggunaan.
4. **Legacy `PUT` auto-publish** bisa melewati preview/test send; ini transisi yang didokumentasikan
   dan akan dihapus pada major berikutnya.
5. **Perubahan escaping teks** adalah koreksi perilaku; perlu golden test dan catatan rilis.
6. **Batas payload admin 1 MB** perlu parser khusus agar batas ingest 64 KB tidak berubah.
7. **Rate limit per IP** di belakang proxy bisa menjadi global; test send memakai hitungan DB per
   admin/tenant untuk menghindari ini.

### Pertanyaan terbuka (tidak menghambat MVP)

- Apakah nanti perlu approval maker-checker sebelum publish?
- Apakah test send in-app diperlukan (mis. inbox admin) atau cukup preview?
- Apakah plain-text alternative email masuk fase 2 atau lebih cepat?
- Apakah per-locale theme otomatis diperlukan, atau cukup pilih theme per template?
- Apakah block builder benar-benar dibutuhkan, atau starter snippet + layout sudah cukup?

---

## 17. Definition of done (setelah persetujuan)

1. Migrasi + backfill berhasil di database dev/test; `npx prisma migrate status` bersih.
2. Semua keputusan D1–D12 diterapkan atau deviasinya dicatat.
3. Baris template lama terkirim tanpa perubahan yang tidak disetujui; E1–E11 + E12–E19 lulus.
4. API lama tetap 2xx; SDK terbit tidak berubah.
5. Console typecheck/build lulus; alur draft → preview → test send → publish → rollback
   terverifikasi manual.
6. Validator menolak payload berbahaya; preview tersandbox; tenant isolation terbukti.
7. Dokumentasi (`docs/design/templates/template-system-design.md`, `docs/design/admin-api.md`, `docs/design/react-and-console.md`,
   `docs/design/email-and-preferences.md`, `docs/design/in-app.md`, `docs/design/whatsapp.md`, `docs/getting-started/local-setup.md`,
   README) diperbarui sesuai implementasi.
8. Laporan akhir berisi bukti perintah/status/output, deviasi, batasan, dan kondisi lingkungan.

---

## 18. Catatan implementasi dan verifikasi

Status: terimplementasi dan terverifikasi pada 2026-11-16 (root `0.11.0`, console `0.2.0`).

### 18.1 Yang diterapkan

- Migrasi aditif `20261116150000_template_system`: enum `TemplateStatus`/`TemplateFormat`/
  `TemplateDirection`/`TemplateAuditAction`, kolom baru `NotificationTemplate`, tabel
  `TemplateLayout`, `TemplateTheme`, `TemplatePartial`, `TemplatePartialLink`,
  `TemplateAuditEvent`, `TemplateTestSend`, index/foreign key, backfill `format` email dan
  `publishedAt`. Migrasi lanjutan `20261116160000_template_builder_data` menambah `builderData`
  untuk round-trip block builder.
- Renderer terpusat: `template.render.ts` (helper whitelist, layout/partial/theme, escaping
  sadar-channel, cache berbasis hash konten, sanitizer output), `template.variables.ts`,
  `template.safety.ts`; worker email/in-app/WhatsApp memakai resolver published + aset.
- Admin API: draft/publish/clone/rollback/activate, versions, audit, test-sends, preview inline
  dan saved, test send, aset layout/theme/partial; `view=summary`; parser admin 1 MB.
- Console: daftar status/versi, editor dua panel dengan tab konten/variabel/aset/pengaturan,
  preview iframe sandbox desktop/mobile, sample JSON, snippet, publish/test send, riwayat/audit,
  halaman aset, guard unsaved changes (`useBlocker` + `beforeunload`), router data mode.
- 26 E2E lulus (E1–E26; E1–E20 MVP template, E21–E26 roadmap P0: validasi `builderData`,
  plain-text, retensi, dan warning dua kolom).

### 18.2 Deviasi dari desain awal

1. Endpoint aset digabung di `/api/v1/admin/template-assets/{layouts,themes,partials}` (desain
   menyebut path terpisah per jenis); bentuk respons dan semantik versi tetap sama.
2. Preview/test send ditempatkan di controller template yang sama (bukan controller terpisah).
3. Test send memakai `notificationId` sintetis `template-test:<id>` dan tidak membuat
   `Notification`/`BillingEvent`; audit ada di `TemplateTestSend` + `TemplateAuditEvent`.
4. Pesan error validasi mengirim `message[]` + `details` aditif; `HttpExceptionFilter` diperluas
   untuk meneruskan `details` dan batas payload yang relevan.
5. Mode test send di `development` menghasilkan status `simulated` (bukan `sent`) agar jelas tidak
   ada email keluar; desain hanya menyebut status sent/failed.
6. Rate limit preview memakai `ThrottlerGuard` 120/menit (tracker IP, bukan per-admin) karena
   keterbatasan tracker bawaan; test send memakai hitungan DB per admin/tenant.
7. `TemplateDirection`/RTL didukung di renderer dan schema; layout starter memakai `dir`/`isRtl`.
   Preview latar gelap adalah pemeriksaan kontras, bukan emulasi penuh dark mode client.

### 18.3 Batasan yang tersisa

- Sanitizer HTML/CSS berbasis pola, bukan parser penuh; sandbox iframe dan validasi publish adalah
  lapisan utama. `{{{ }}}` dinamis tetap disanitasi saat render.
- Block builder MVP sudah tersedia (lihat `docs/design/templates/email-block-builder-design.md`); loop/conditional
  visual, MJML/juice, markdown in-app, Meta approved WhatsApp template, impor HTML ke Visual,
  diff visual versi, CodeMirror, atau approval maker-checker belum ada.
- Test send hanya email/WhatsApp; in-app/SMS memakai preview.
- Aset append-only dan belum ada penghapusan otomatis. Roadmap P1 menambahkan `usageCount` dan
  `DELETE` hanya untuk aset yang tidak direferensikan; aset yang dipakai tetap immutable.
- Roadmap P0/P1 (2026-11-16) menambahkan validasi `builderData`, plain-text email otomatis,
  retensi telemetry, warning dua kolom, drag-and-drop/undo-redo, ekspor HTML, dan proteksi hapus
  aset. Slice P2 menambahkan pencatatan `templateId`/`templateVersion` per recipient dan upload
  gambar tervalidasi (storage lokal); lihat `docs/design/templates/template-limitations-roadmap.md` §11–§14.
- `preview` tidak menulis tabel audit (hanya log terstruktur); publish/test send diaudit.
- Dukungan email client/dark mode tetap best effort dan diverifikasi manual.

### 18.4 Bukti verifikasi utama

- `npm run typecheck`, `npm run build`, `npm run console:typecheck`, `npm run console:build`,
  `npm run sdk:test` (lihat laporan akhir).
- `npm run test:e2e -- --runInBand`: 29/29 lulus.
- `npm run test:unit`: 22/22 lulus (builder, plain-text, sanitizer, provider, console blocks,
  image detection).
- `npx prisma migrate status`: 9 migrasi, tidak ada pending (dev dan test).
- Console dev `http://127.0.0.1:5180/` merespons `200` setelah build; UI interaktif diverifikasi
  manual (tanpa Playwright).
