# Markdown in-app (subset aman)

Status: **terimplementasi dan terverifikasi (F1 + F2)** (2026-11-21). Lihat §11.
Basis: `docs/design/templates/template-limitations-roadmap.md` D12 (butir 9, baris 92/143),
`src/templates/template.render.ts`, `src/admin/services/admin-template-validation.service.ts`,
`src/in-app/`, `packages/js-sdk/src/types.ts`, dan `packages/react/src/inbox.tsx`.

**Isi dokumen**

- [1. Latar belakang dan tujuan](#1-latar-belakang-dan-tujuan)
- [2. Ruang lingkup](#2-ruang-lingkup)
- [3. Keputusan desain](#3-keputusan-desain)
- [4. Subset markdown dan keamanan](#4-subset-markdown-dan-keamanan)
- [5. Kontrak dan alur](#5-kontrak-dan-alur)
- [6. Perubahan per paket](#6-perubahan-per-paket)
- [7. Rencana verifikasi](#7-rencana-verifikasi)
- [8. Risiko dan batasan](#8-risiko-dan-batasan)
- [9. Daftar file](#9-daftar-file)
- [10. Pertanyaan persetujuan](#10-pertanyaan-persetujuan)
- [11. Catatan implementasi](#11-catatan-implementasi)

---

## 1. Latar belakang dan tujuan

`TemplateFormat.markdown` sudah ada di enum Prisma, tetapi service menolak semua format selain
`html` (email) dan `text` (kanal lain). Roadmap menunda markdown in-app karena SDK/React terbit
belum punya jalur render yang aman. `@notifhub/js` `0.3.1` sudah terbit, tetapi belum menambahkan
field HTML; `@notifhub/react` masih merender `body` sebagai teks biasa
(`packages/react/src/inbox.tsx`).

Tujuan fase ini: mengizinkan **markdown hanya untuk kanal in-app**, dirender server-side menjadi
HTML subset yang aman, dengan fallback teks biasa agar klien lama tidak menampilkan tag mentah.
Tidak ada dependency baru dan tidak ada perubahan schema.

## 2. Ruang lingkup

### Termasuk (F1)

1. Validasi format: `inapp` menerima `text` atau `markdown`; `email` tetap `html`; `whatsapp`/`sms`
   tetap `text`.
2. Renderer markdown subset di backend (`src/templates/template.markdown.ts`) tanpa dependency,
   escape-first, lalu membentuk tag yang diizinkan.
3. `bodyHtml` dan `format` ditambahkan secara **aditif** ke payload in-app (SSE `payload.content`,
   catch-up `GET /api/v1/in-app/notifications`, dan response read). `body` tetap berisi teks biasa
   (markdown yang sudah dilucuti) untuk klien lama.
4. Preview/test send menampilkan HTML hasil render dan plain text; console dapat memilih format
   markdown untuk template in-app dan menampilkan preview di pane yang ada.
5. Test unit renderer/validasi + e2e alur template markdown sampai notifikasi in-app.
6. Dokumentasi: dokumen ini, roadmap D12, configuration/usage bila perlu.

### Termasuk (F2, disetujui bersamaan)

- Rilis `@notifhub/js` `0.4.0` (tipe `bodyHtml`/`format`) dan `@notifhub/react` `0.3.0`
  (opsi opt-in `renderBody="safe-html"`). Dilakukan pada 2026-11-21; lihat §11.

### Tidak termasuk

- Markdown untuk email/WhatsApp/SMS, gambar di markdown, tabel, HTML mentah, atau blockquote
  bersarang.
- Perubahan schema/migrasi, editor WYSIWYG, atau parser markdown penuh (CommonMark).
- Perubahan kontrak publik `openapi/notifhub.json` (endpoint in-app bukan subset konsumen).

## 3. Keputusan desain

| # | Keputusan | Default | Alasan |
|---|---|---|---|
| D1 | Markdown hanya untuk kanal `inapp` | Ya | Email punya pipeline HTML/sanitizer sendiri; WhatsApp/SMS hanya teks |
| D2 | Render dilakukan **server-side** saat worker/preview, bukan di klien | Ya | Satu sumber kebenaran, klien lama tetap mendapat teks, keamanan tidak bergantung pada klien |
| D3 | `body` tetap teks biasa; HTML hasil render dikirim sebagai `bodyHtml` baru | Ya | Aditif dan backward-compatible; tidak mengubah arti `body` |
| D4 | Renderer subset ditulis sendiri, tanpa dependency | Ya | Aturan repo: dependency baru butuh alasan kuat; subset kecil dan escape-first lebih mudah diaudit |
| D5 | Input markdown yang mengandung tag HTML mentah ditolak saat validasi | Ya | Mencegah upaya menyelipkan HTML; output hanya tag yang dibentuk renderer |
| D6 | Link hanya `http`, `https`, dan `mailto`; atribut `rel="noopener noreferrer"` | Ya | Mencegah `javascript:`/`data:` dan tabnabbing |
| D7 | F1 (backend+console) dan F2 (rilis SDK/React) dipisah | Ya | Backend bisa dirilis tanpa menunggu npm; klien lama tetap aman |
| D8 | Tidak ada schema/migrasi; `format` sudah ada di enum | Ya | Tidak perlu perubahan DB |
| D9 | Batas panjang tetap memakai limit kanal yang ada (4.096 karakter in-app) | Ya | Konsisten dengan publish gate |

## 4. Subset markdown dan keamanan

Subset yang didukung:

| Markdown | Output |
|---|---|
| `**tebal**`, `*miring*`, `` `kode` `` | `<strong>`, `<em>`, `<code>` |
| `[teks](https://…)` | `<a href="…" rel="noopener noreferrer">` |
| Daftar `- item` / `1. item` | `<ul><li>`, `<ol><li>` |
| Baris baru dalam paragraf | `<br>` |
| Paragraf dipisah baris kosong | `<p>` |
| Heading `#`, `##`, `###` | `<h3>`, `<h4>`, `<h5>` (dibatasi agar tidak merusak layout in-app) |

Tidak didukung: gambar, tabel, blockquote, HTML mentah, markdown di dalam kode, nested list > 1
level, referensi link, dan karakter kontrol.

Algoritma renderer:

1. Escape `&`, `<`, `>`, `"`, `'` pada seluruh input.
2. Tokenisasi baris: heading, list, paragraf; inline: strong/em/code/link.
3. Link divalidasi dengan `new URL`; skema di luar allowlist → teks + warning, bukan error publish
   (kecuali saat validasi publish, lihat §5).
4. Output hanya tag/atribut yang dibentuk renderer; tidak ada `dangerouslySetInnerHTML` di backend.
5. `markdownToPlainText` menghasilkan `body` tanpa marker untuk klien lama.

Batas: maksimum 4.096 karakter body in-app, maksimum 100 link per body, dan maksimum 200 baris.

## 5. Kontrak dan alur

```
POST /api/v1/notify (channels: ["inapp"], template format markdown)
  -> worker in-app merender template
     - body (markdown + Handlebars) -> markdownToHtmlSubset() -> bodyHtml
     - bodyHtml -> markdownToPlainText() -> body
  -> InAppEventBus publish { body, bodyHtml, format: "markdown", ... }
  -> SSE / catch-up mengembalikan body + bodyHtml + format

GET /api/v1/in-app/notifications
  -> item: { ..., body, bodyHtml, format }
```

- `bodyHtml` bernilai `null` untuk template `text` (perilaku lama tidak berubah).
- `format` bernilai `text` | `markdown`; klien lama mengabaikan kedua field baru.
- Payload event in-app yang tersimpan di Redis ikut memuat field baru; replay `Last-Event-ID` tetap
  kompatibel karena field tambahan.
- Preview (`POST /admin/templates/preview` dan `/:id/preview`) mengisi `html` (hasil subset) dan
  `text` (plain) untuk template markdown; `body` tetap sumber markdown.
- Test send in-app memakai hasil render yang sama.

## 6. Perubahan per paket

### Backend

- `src/templates/template.markdown.ts` (baru): renderer subset + `markdownToPlainText` +
  `validateMarkdownSubset`.
- `src/templates/template.render.ts`: untuk `format === 'markdown'`, hasilkan `body` plain dan
  `bodyHtml`; tambahkan `html`/`bodyHtml` pada `RenderedTemplate`.
- `src/admin/services/admin-template-validation.service.ts`: aturan format per kanal
  (`inapp` → text|markdown), validasi subset (HTML mentah, link, batas), error code jelas.
- `src/workers/in-app.processor.ts`, `src/providers/in-app/in-app.provider.ts`,
  `src/in-app/in-app-event-bus.service.ts`, `src/in-app/in-app.service.ts`,
  `src/in-app/dto/list-in-app-notifications.dto.ts`: teruskan `bodyHtml`/`format`.
- Test unit + e2e.

### Console

- `TemplateFormPage`: opsi format `markdown` hanya saat channel `inapp`; bantuan sintaks singkat.
- `TemplatePreviewPane`: bila `html` tersedia, render di iframe `sandbox=""` yang sudah dipakai
  preview email; jika tidak, tetap teks.
- `TemplateStatusBadge`/tipe: tidak berubah.

### SDK (F2, terpisah)

- `@notifhub/js` `0.4.0`: `InAppNotification.bodyHtml?: string | null`, `format?: 'text' | 'markdown'`.
- `@notifhub/react` `0.3.0`: opsi opt-in `renderBody="safe-html"` yang memakai `bodyHtml`; default
  tetap teks (`body`), tanpa breaking change. Publish mengikuti `docs/sdk/npm-publishing.md`.

## 7. Rencana verifikasi

| Pemeriksaan | Target |
|---|---|
| Unit renderer | tebal/miring/kode/link/list/heading/escape; XSS (`<script>`, `javascript:`, `onerror=`, `data:`); batas link/baris; plain-text |
| Unit validasi | format per kanal; markdown ditolak untuk email/whatsapp/sms; HTML mentah ditolak; template text lama tetap valid |
| E2E | buat/publish template inapp markdown → notify → catch-up memuat `bodyHtml` tersanitasi + `body` plain; SSE live; test send/preview; regresi template text |
| Console | `console:typecheck`/`test`/`build`; preview manual tidak diotomasi (batasan repo) |
| Regresi | `npm run ci` (unit + e2e + 14 migrasi), `docs:check` |
| Keamanan | tidak ada `dangerouslySetInnerHTML` baru di backend; output hanya tag subset |

## 8. Risiko dan batasan

1. **Klien lama menampilkan teks biasa** sampai F2; ini sengaja agar tidak ada tag mentah.
2. **Bukan CommonMark penuh**; author yang memakai tabel/gambar akan mendapat warning/penolakan.
3. **Renderer buatan sendiri** berisiko bug parsing; mitigasi: escape-first, subset sempit, unit
   test XSS, dan tidak menerima HTML mentah.
4. **Preview console** memakai iframe sandbox; tidak ada browser automation permanen.
5. **Rilis SDK/React F2** harus disetujui dan diverifikasi terpisah; F1 tidak boleh mengubah versi
   paket npm.
6. **Kanal lain tidak berubah**; markdown untuk email/WhatsApp tetap di luar cakupan.

## 9. Daftar file

### Baru

| File | Isi |
|---|---|
| `src/templates/template.markdown.ts` | Renderer subset, plain-text, validator |
| `test/template.markdown.unit-spec.ts` | Unit renderer/validator |
| `docs/design/templates/in-app-markdown-design.md` | Dokumen ini |

### Diubah (F1)

| File | Perubahan |
|---|---|
| `src/templates/template.types.ts` | `RenderedTemplate.bodyHtml`/`html` opsional |
| `src/templates/template.render.ts` | Render markdown → bodyHtml + plain body |
| `src/admin/services/admin-template-validation.service.ts` | Aturan format per kanal + subset |
| `src/admin/services/admin-template-preview.service.ts` | Isi `html`/`text` untuk markdown |
| `src/workers/in-app.processor.ts`, `src/providers/in-app/in-app.provider.ts` | Teruskan field baru |
| `src/in-app/in-app-event-bus.service.ts`, `src/in-app/in-app.service.ts`, `src/in-app/dto/list-in-app-notifications.dto.ts` | `bodyHtml`/`format` di payload/API |
| `console/src/pages/TemplateFormPage.tsx`, `console/src/components/TemplatePreviewPane.tsx` | Format markdown + preview |
| `test/app.e2e-spec.ts` | E2E markdown in-app |
| `docs/design/templates/template-limitations-roadmap.md` | Status butir 9/D12 |
| `docs/README.md`, `docs/design/README.md` | Indeks |

## 10. Pertanyaan persetujuan

1. Setuju markdown **hanya untuk inapp**, dengan `email` tetap `html` dan `whatsapp`/`sms` tetap
   `text` (D1)?
2. Setuju kontrak aditif `bodyHtml` + `format` pada payload in-app, sementara `body` tetap teks
   biasa untuk klien lama (D2–D3)?
3. Setuju renderer subset tanpa dependency, menolak HTML mentah, dan hanya mengizinkan link
   http/https/mailto (D4–D6)?
4. Setuju F1 (backend + console) dikerjakan sekarang dan F2 (rilis `@notifhub/js` 0.4.0 +
   `@notifhub/react` 0.3.0) menjadi persetujuan terpisah (D7)?
5. Setuju tanpa perubahan schema/migrasi dan tanpa perubahan `openapi/notifhub.json` (D8)?

Setelah disetujui, implementasi dimulai dari renderer + unit test, lalu validasi/pipeline, lalu
payload in-app, lalu console, diakhiri e2e dan dokumentasi.

## 11. Catatan implementasi

F1 dan F2 selesai dan terverifikasi pada 2026-11-21.

Yang sudah berjalan:

- `src/templates/template.markdown.ts` merender subset (paragraf, heading `#`–`###` → `h3`–`h5`,
  tebal, miring, kode, link http/https/mailto, list) dengan escape-first; HTML mentah ditolak saat
  validasi, link tidak aman menjadi teks + warning.
- `TemplateRenderer` menghasilkan `body` plain dan `bodyHtml` untuk format markdown;
  `TemplatePreviewResult.html/text` diisi; validasi menerima `inapp` + `markdown`, menolak
  markdown untuk kanal lain.
- Payload in-app (SSE `payload.content`, catch-up, DTO) memuat `bodyHtml` dan `format`; klien lama
  tetap memakai `body`.
- Console: pilihan format `text`/`markdown` untuk inapp dan preview HTML di pane yang ada.
- `@notifhub/js` `0.4.0`: `InAppNotification.bodyHtml`/`format`.
- `@notifhub/react` `0.3.0`: `NotificationInbox` menerima `renderBody="safe-html"` (opt-in,
  memakai `bodyHtml`); default tetap teks.

Verifikasi:

| Pemeriksaan | Hasil |
|---|---|
| `npm run test:unit` | **73** test lulus (14 suite); 7 test baru untuk markdown |
| `npm run test:e2e` | **47** test lulus; E47 (markdown in-app end-to-end) lulus |
| `npm run sdk:test` / `react:test` | 36 test SDK; 5 test React (1 test `safe-html`) |
| `npm run console:test` / `console:typecheck` / `console:build` | 18 test; typecheck & build lulus |
| `npm run ci` | lulus **102 s**; 73 unit, 47 e2e, 14 migrasi |
| `npm run docs:check` | lulus (538 tautan/anchor, 44 file) |
| Registry | `@notifhub/js@0.4.0` (`sha512-m7MMjK1k1hUqFdd6PdWSrvsXwqr+fbzy8GKd5PoGCkjTnMRF1LDwxmYVZlHZ1EHi9SXe7unWTNJijUKCtLSjfg==`) dan `@notifhub/react@0.3.0` (`sha512-j4S7XerCXhi+6VygWpVuI4K0D4aXR2RxWulaV6+FBebFTYwry5SfMV6rAi/RyWVRlbpw74ed9K56eIFm3AbZMg==`); `latest` keduanya naik |
| Verifikasi registry | proyek bersih: CJS/ESM, render `NotificationInbox` (`safe-html` menghasilkan `<strong>`, default tidak), dan `tsc --noEmit` lulus |
| Tag git | `js-v0.4.0`, `react-v0.3.0` |

Deviasi dan batasan:

1. **Markdown untuk email ditolak `400`** oleh normalizer format (bukan `200` dengan error
   validasi seperti `format=html` yang tidak aman). Ini disengaja: kombinasi kanal/format yang
   tidak didukung ditolak sebelum render.
2. Heading dibatasi ke `h3`–`h5` agar tidak merusak layout in-app; gambar/tabel/blockquote tidak
   didukung.
3. `renderBody="safe-html"` memakai `dangerouslySetInnerHTML`; hanya aman karena HTML dihasilkan
   server dari subset. Konsumen yang memakai backend lain bertanggung jawab atas sanitasi.
4. Tidak ada perubahan schema/migrasi; 14 migrasi tetap.
5. `openapi/notifhub.json` tidak berubah karena endpoint in-app bukan subset konsumen.
