# Impor HTML ke Visual (subset kecil)

Status: **terimplementasi dan terverifikasi** (2026-11-22). Lihat §14 untuk catatan implementasi,
deviasi, batasan, dan bukti verifikasi.
Basis: `docs/design/templates/template-system-design.md` (§7 pipeline render, §11 sanitasi, §18
catatan), `docs/design/templates/email-block-builder-design.md`,
`docs/design/templates/template-limitations-roadmap.md` D4/§2.1/§9.2/§14.4,
`docs/design/templates/in-app-markdown-design.md` §11 (pola subset + validasi),
`docs/architecture/project-brief.md` §6–§7 butir 9, `src/templates/template.builder.ts`,
`console/src/lib/emailBlocks.ts`, dan `console/src/pages/TemplateFormPage.tsx`.

**Isi dokumen**

- [1. Latar belakang dan tujuan](#1-latar-belakang-dan-tujuan)
- [2. Ruang lingkup](#2-ruang-lingkup)
- [3. Keputusan desain](#3-keputusan-desain)
- [4. Subset dan pemetaan HTML ke builderData](#4-subset-dan-pemetaan-html-ke-builderdata)
- [5. Penanganan CSS dan elemen tersembunyi](#5-penanganan-css-dan-elemen-tersembunyi)
- [6. Keamanan dan sanitasi](#6-keamanan-dan-sanitasi)
- [7. Dependency](#7-dependency)
- [8. Kontrak endpoint dan console](#8-kontrak-endpoint-dan-console)
- [9. Batas dan penanganan kesalahan](#9-batas-dan-penanganan-kesalahan)
- [10. Rencana test dan verifikasi](#10-rencana-test-dan-verifikasi)
- [11. Risiko dan batasan](#11-risiko-dan-batasan)
- [12. Daftar file yang direncanakan](#12-daftar-file-yang-direncanakan)
- [13. Pertanyaan persetujuan](#13-pertanyaan-persetujuan)
- [14. Catatan implementasi](#14-catatan-implementasi)

---

## 1. Latar belakang dan tujuan

Editor template email sudah punya dua mode: **Visual** (`EmailBlockBuilder`) dan **HTML**. Template
baru dibuat dari block, diedit sebagai block, lalu console merender block menjadi `body` HTML
(`renderBlocksToHtml`) dan mengirim `body` + `builderData` ke API. Worker tetap memakai `body`;
`builderData` hanya dokumen round-trip editor dan divalidasi ketat di server
(`src/templates/template.builder.ts`). Ekspor HTML sudah tersedia (Unduh/Salin HTML), sedangkan
**impor HTML ke Visual masih ditolak**: beralih ke Visual hanya menampilkan konfirmasi bahwa HTML
yang ada tidak diimpor (lihat `console/src/pages/TemplateFormPage.tsx`, `changeEditorMode`).

Roadmap P2 mencatat dua alasan penundaan: pemetaan HTML arbitrer ke tujuh tipe block bersifat ambigu
dan membutuhkan parser (dependency). Dokumen ini mengusulkan **subset kecil** yang dapat dipetakan
tanpa parser baru dan tanpa kehilangan data secara diam-diam: HTML sederhana (heading, paragraf,
gambar, tombol, divider) diubah menjadi `builderData`, dengan laporan eksplisit untuk apa pun yang
tidak dapat dipetakan.

Tujuan:

1. Admin dapat memindahkan HTML body email yang sudah ada (mis. hasil ekspor lama, kiriman desainer,
   atau HTML sederhana dari dokumen) ke mode Visual tanpa mengetik ulang.
2. Tidak ada **silent lossy import**: setiap konstruksi yang dibuang atau diubah levelnya muncul di
   laporan sebelum admin menerapkan.
3. Tidak ada perubahan schema, migrasi, endpoint, contract SDK, atau dependency baru.
4. Hasil impor tetap melewati validasi server yang sudah ada; tidak ada jalur baru untuk menyimpan
   `builderData` invalid.

Bukan tujuan: menjadi HTML parser penuh atau menjamin hasil visual identik dengan HTML sumber.

## 2. Ruang lingkup

### Termasuk

1. Tombol **Impor HTML** di tab **Konten** untuk channel `email`, mode editing (bukan template
   published/read-only).
2. Dialog impor: tempel HTML atau pilih file `.html`/`.htm` (dibaca lokal, tidak diunggah), tombol
   **Analisis**, laporan hasil, dan tombol **Terapkan**.
3. Fungsi murni `importHtmlToBlocks(html)` di console yang memetakan subset HTML ke
   `EmailBlockDocument` (schema v1) memakai `DOMParser` bawaan browser.
4. Pemetaan: heading (`h1`–`h6`), paragraf/teks (`p`, teks liar, `div` berisi inline), gambar
   (`img`), tombol (`a` tunggal), dan divider (`hr`).
5. Laporan impor: jumlah block per tipe, jumlah elemen/CSS yang dibuang, daftar issue
   `error`/`warning` dengan lokasi elemen.
6. Unit test importer (Vitest/jsdom) dan regresi console; verifikasi manual end-to-end lewat UI
   (simpan draft → preview → publish) tanpa browser automation.
7. Dokumentasi: dokumen ini, indeks `docs/README.md` dan `docs/design/README.md`, serta pembaruan
   status di roadmap dan project brief **setelah** implementasi disetujui.

### Tidak termasuk

1. `spacer` dan `columns` tidak diimpor. Keduanya tetap dapat dibuat manual di Visual.
2. Tabel multi-sel, list (`ul`/`ol`/`li`), blockquote, `<style>`/CSS eksternal, media query, kelas
   CSS, dark mode, RTL layout, dan struktur layout email (header/footer) tidak dipetakan.
3. Handlebars block/partial/komentar (`{{#if}}`, `{{/each}}`, `{{> partial}}`, `{{! ... }}`) tidak
   didukung; impor ditolak agar tidak menjadi teks literal yang salah.
4. Endpoint impor server-side, upload file ke server, penyimpanan HTML sumber, atau impor dua arah
   (builder → HTML sudah ada lewat ekspor).
5. Perubahan pada `body`/worker/preview pipeline, sanitizer, `openapi/notifhub.json`, schema,
   migrasi, env, `@notifhub/js`, `@notifhub/react`, atau Go module.
6. Impor untuk channel `inapp`/`whatsapp`/`sms`, atau untuk template published.

## 3. Keputusan desain

| # | Keputusan | Default | Alasan |
|---|---|---|---|
| D1 | Cakupan block hasil impor | `heading`, `text`, `image`, `button`, `divider` | Persis subset yang diminta dan yang dapat dipetakan tanpa heuristik layout |
| D2 | Arah impor | Satu arah HTML → `builderData`; `body` final tetap hasil `renderBlocksToHtml` | `body` tetap sumber kebenaran worker; HTML sumber tidak pernah disimpan/dipakai ulang |
| D3 | Tempat parsing | Console (client), `DOMParser` bawaan; server tetap validator akhir | Tanpa endpoint/dependency baru; `DOMParser` inert dan sudah tersedia di browser + jsdom test |
| D4 | Kebijakan CSS | CSS tidak diimpor. Hanya `text-align`, `width`/`max-width`, dan `display`/`visibility`/`opacity` dibaca untuk pemetaan | Builder menghasilkan styling sendiri dari inline style + theme; menyalin CSS tidak mungkin dipetakan ke field block |
| D5 | Kebijakan kehilangan data | Setiap pembuangan/transformasi dilaporkan; `error` memblokir impor, `warning` tidak | Menegakkan "tidak ada silent lossy import" seperti D4 roadmap |
| D6 | URL | Hanya `http`/`https` absolut atau token `{{...}}` persis; selain itu dibuang + warning | Sama dengan kontrak `builderData` di server (`builder_url_unsafe`) |
| D7 | Handlebars | Hanya token variabel `{{nama}}`/`{{{nama}}}`; blok/partial/komentar ditolak | Builder tidak merepresentasikan loop/conditional; token blok sebagai teks akan tampil rusak |
| D8 | Batas | Input ≤ 262.144 byte, ≤ 5.000 node, dan batas server (200 block/64 KiB/10.000 teks/500 label/500 alt/2.048 URL) | Mencegah UI freeze dan menjamin dokumen lolos validasi server |
| D9 | UX | Tombol **Impor HTML** di tab Konten; dialog analisis + laporan + Terapkan; preview memakai pipeline server setelah diterapkan | Preview lokal tidak bisa mengevaluasi ekspresi theme Handlebars |
| D10 | Test | Unit console wajib; regresi E20/E21; E2E baru opsional (E48) | Perubahan hanya di console; server tidak berubah |
| D11 | Perubahan lain | Tanpa schema, migrasi, env, OpenAPI, SDK, Go module | Fitur murni sisi editor |

Alternatif yang dipertimbangkan dan ditolak untuk fase ini:

| Opsi | Alasan ditolak |
|---|---|
| Endpoint `POST /admin/templates/import-html` dengan `parse5`/`cheerio` | Menambah dependency server + permukaan API baru; parsing HTML di server tidak dibutuhkan karena output akhir tetap `builderData` yang divalidasi |
| Konversi dengan regex di server | HTML bukan regular language; rawan salah petakan dan sulit diaudit |
| `innerHTML` ke DOM aplikasi lalu dibaca | Berisiko XSS jika ada kesalahan; `DOMParser` menghasilkan dokumen inert tanpa menyentuh DOM aplikasi |
| Memakai `jsdom` di runtime console | Hanya devDependency dan terlalu berat untuk bundle; hanya dipakai test |
| Impor `spacer`/`columns` juga | Menambah heuristik layout (tinggi/dua kolom) yang rawan salah; di luar subset kecil |

## 4. Subset dan pemetaan HTML ke builderData

Builder hanya punya satu tipe `text`; "paragraf" dan "teks" sama-sama menjadi block `text` (setiap
block dirender sebagai `<p>`), sehingga jumlah paragraf tetap terjaga.

Aturan traversal:

1. Ambil konten `<body>` bila input berupa dokumen penuh; `<head>`, `<title>`, `<style>`, dan
   komentar HTML dibuang dan dihitung di laporan.
2. Telusuri node sesuai urutan dokumen (depth-first). Container transparan ditelusuri anaknya:
   `div`, `section`, `article`, `header`, `footer`, `main`, `center`, `td`, `th`, `tr`, `tbody`,
   dan `table` yang hanya punya satu jalur sel.
3. Container yang isinya hanya inline/teks menjadi **satu** block `text`; container dengan anak
   block-level ditelusuri per anak, dan teks langsung di antaranya menjadi block `text` sendiri.
4. Teks liar di level body digabung per kelompok menjadi block `text`.
5. `img` di tengah paragraf memecah paragraf menjadi `text` sebelum, `image`, lalu `text` sesudah
   (urutan dipertahankan).

| HTML sumber | Block hasil | Aturan |
|---|---|---|
| `<h1>` | `heading` level 1 | Teks inline digabung; format inline dibuang (warning bila ada) |
| `<h2>`, `<h3>` | `heading` level 2/3 | Sama |
| `<h4>`–`<h6>` | `heading` level 3 | Warning `import_heading_level_clamped` (level 4–6 tidak ada di schema) |
| `<p>` | `text` | `<br>` menjadi `\n`; format inline dibuang (warning) |
| `div`/`section`/`article`/`header`/`footer`/`main`/`center` | container | Anak diproses; konten inline saja menjadi satu `text` |
| Teks liar / `<br>` di level blok | `text` | Baris baru dipertahankan sebagai `\n` |
| `<hr>` | `divider` | |
| `<img src alt width>` | `image` | `src` http/https atau token; `alt` apa adanya (≤ 500); `width` dari atribut `width` atau style `width`/`max-width` numerik, clamp 80–600, default 552 |
| `<a href>` sebagai satu-satunya isi blok | `button` | `label` = teks anchor; `url` = `href`; `align` dari `text-align` container terdekat (`left` default) |
| `<a href>` di dalam paragraf/teks | `text` | Teks anchor dipertahankan, link dibuang, warning `import_inline_link_dropped` (href ditampilkan di laporan) |
| `<a href><img alt></a>` | `image` | Link pada gambar dibuang, warning `import_image_link_dropped` (href ditampilkan) |
| `<strong>`, `<em>`, `<code>`, `<span>`, `<font>`, `<b>`, `<i>`, `<u>`, `<small>` | inline | Teks dipertahankan; format dibuang (warning per block `import_inline_formatting_dropped`) |
| `<table>` satu jalur sel | container | Ditembus transparan (layout wrapper) |
| `<table>` multi-sel | — | Error `import_multi_cell_table_unsupported` (termasuk pola `.nh-col`) |
| `<ul>`, `<ol>`, `<li>` | — | Error `import_list_unsupported` |
| `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<input>`, `<textarea>`, `<select>`, `<button>`, `<base>`, `<link>`, `<svg>`, `<math>`, `<video>`, `<audio>`, `<canvas>` | — | Error `import_unsafe_element`; seluruh impor ditolak |
| `<style>`, `<head>`, `<title>`, komentar HTML | — | Dibuang, dihitung di laporan (`import_css_dropped`, `import_comment_dropped`) |
| Komentar kondisional `<!--[if mso]>` | — | Dibuang, warning `import_conditional_comment_dropped` |
| Tag block tak dikenal (mis. `<blockquote>`) | — | Error `import_unsupported_element` (eksplisit, bukan ditebak) |
| Tag inline tak dikenal | inline | Teks dipertahankan + warning `import_unknown_inline_flattened` |

Contoh pemetaan:

```html
<h1>Halo {{nama}}</h1>
<p>Pesanan <strong>INV-001</strong> sudah dikirim.<br>Terima kasih.</p>
<img src="https://cdn.example.com/box.png" alt="Paket" width="600">
<a href="https://example.com/lacak">Lacak paket</a>
<hr>
```

menjadi:

```json
{
  "version": 1,
  "blocks": [
    { "id": "…uuid…", "type": "heading", "text": "Halo {{nama}}", "level": 1 },
    { "id": "…uuid…", "type": "text", "text": "Pesanan INV-001 sudah dikirim.\nTerima kasih." },
    { "id": "…uuid…", "type": "image", "url": "https://cdn.example.com/box.png", "alt": "Paket", "width": "600" },
    { "id": "…uuid…", "type": "button", "label": "Lacak paket", "url": "https://example.com/lacak", "align": "left" },
    { "id": "…uuid…", "type": "divider" }
  ]
}
```

dengan warning `import_inline_formatting_dropped` untuk `<strong>`.

Catatan Handlebars:

- Token variabel dipertahankan apa adanya di dalam teks/label/alt/URL (mis. `{{cta.url}}` sebagai
  URL tombol, `{{customer.name}}` di paragraf).
- Teks dibaca lewat `textContent` (sekali decode entitas), lalu builder meng-escape ulang saat
  render; `&amp;` menjadi `&` dan kembali `&amp;` di HTML final — tidak ada double escaping.
- Token blok/partial/komentar (`{{#`, `{{/`, `{{else`, `{{^`, `{{>`, `{{!`) memicu error
  `import_handlebars_block_unsupported`; admin harus memakai mode HTML.

Normalisasi teks:

1. `&nbsp;` (U+00A0) dinormalisasi menjadi spasi biasa.
2. Spasi/tab/baris baru berurutan di dalam satu text node dipadatkan menjadi satu spasi.
3. Spasi di awal/akhir block dipangkas; block yang kosong setelah pemangkasan tidak dibuat.
4. `\n` hanya berasal dari `<br>`.

## 5. Penanganan CSS dan elemen tersembunyi

CSS tidak dipetakan karena block builder menghasilkan styling sendiri (inline style + token theme
`{{default theme.…}}`), dan schema v1 tidak punya field CSS. Kebijakan rinci:

| Sumber | Perlakuan |
|---|---|
| Atribut `style` pada elemen | Dibaca hanya untuk `text-align`, `width`/`max-width` (img), dan `display`/`visibility`/`opacity`; deklarasi lain dibuang dan dihitung |
| `<style>` di `<head>`/`<body>` | Dibuang seluruhnya; jumlah aturan dihitung di `summary.droppedCssRules` |
| Kelas/id CSS | Diabaikan |
| `display:none`, `visibility:hidden`, `opacity:0` (inline) | Elemen dilewati, warning `import_hidden_element_skipped`; mencegah preheader tersembunyi tampil sebagai teks |
| Media query, dark mode, animasi, font-face | Dibuang (bagian dari `<style>`) |
| `!important` | Diabaikan bersama aturan lain |
| `text-align` pada container leluhur | Dipakai untuk `align` tombol yang berdiri sendiri |
| `width`/`max-width` non-numerik (mis. `100%`) | Diabaikan; `width` gambar memakai default 552 |

Konsekuensi yang harus disadari: warna, tipografi, padding, dan layout dua kolom tidak terbawa.
Setelah diterapkan, admin memilih layout/theme yang sudah ada, dan preview server-side menunjukkan
hasil final. Elemen tersembunyi berbasis kelas CSS (bukan inline) tidak dapat dideteksi; ini
batasan yang didokumentasikan.

## 6. Keamanan dan sanitasi

1. **Parsing inert.** `new DOMParser().parseFromString(html, 'text/html')` menghasilkan dokumen tanpa
   browsing context: script tidak dieksekusi, event handler tidak berjalan, dan dokumen tidak
   ditempelkan ke DOM aplikasi. Importer hanya membaca `textContent` dan atribut terpilih; tidak
   menyalin `innerHTML`, tidak memakai `dangerouslySetInnerHTML`/`innerHTML`/`insertAdjacentHTML`.
2. **Allowlist tag.** Tag berbahaya ditolak sebagai `error` sebelum ada block dihasilkan
   (`script`/`iframe`/`object`/`embed`/`form`/`input`/`button`/`base`/`link`/`svg`/`math`/media).
3. **URL.** Nilai atribut diambil dari DOM (entity sudah ter-decode, sehingga `&#106;avascript:`
   menjadi `javascript:`), lalu divalidasi dengan `new URL` dan hanya `http:`/`https:` yang
   diterima (atau token `{{...}}` persis). `javascript:`, `vbscript:`, `data:`, `file:`, `cid:`,
   dan URL relatif dibuang + warning `import_url_unsafe`; untuk `image`/`button` block tetap dibuat
   dengan URL kosong agar admin melihat dan memperbaikinya.
4. **CSS tidak dieksekusi.** Tidak ada CSS yang disuntikkan ke aplikasi; `url(javascript:)` dan
   `expression()` tidak pernah diteruskan karena CSS tidak diimpor.
5. **Batas kerja.** Input dibatasi 262.144 byte dan 5.000 node sebelum/di tengah traversal, sehingga
   HTML sangat besar tidak membekukan tab. Batas block/teks/URL mengikuti kontrak server.
6. **Tidak ada request jaringan.** File dibaca lokal (`file.text()`/FileReader), HTML tidak dikirim
   ke server pada tahap analisis. Gambar sumber tidak dimuat karena dokumen hasil parse tidak
   dirender.
7. **Server tetap validator akhir.** `POST /admin/templates` dan `PUT /admin/templates/:id` sudah
   memanggil `parseBuilderDocument` (schema v1, 200 block, 64 KiB, URL allowlist, field tak
   dikenal ditolak). Bug importer yang menghasilkan field ilegal berakhir `422 builder_*`, bukan
   data tersimpan.
8. **Preview tetap tersandbox.** Preview setelah impor memakai pipeline preview server yang sudah
   ada (`iframe sandbox=""`, `referrerpolicy="no-referrer"`); tidak ada preview HTML lokal baru.
9. **Logging.** Console tidak mencatat HTML sumber, isi teks, atau URL ke log/analytics. Tidak ada
   secret baru.
10. **Isolasi tenant.** Tidak berubah: tidak ada endpoint baru dan semua operasi tetap lewat
    `templatesClient` yang sudah tenant-scoped.

## 7. Dependency

**Rekomendasi: tanpa dependency baru.**

| Kebutuhan | Solusi | Catatan |
|---|---|---|
| Parse HTML | `DOMParser` (Web API, tersedia di browser dan jsdom test) | Bukan paket npm; tidak menambah bundle dependency |
| Validasi schema/limit | `parseBlockDocument` (console) + server `parseBuilderDocument` | Sudah ada |
| Render block → HTML | `renderBlocksToHtml` | Sudah ada |
| Test | Vitest + jsdom (devDependency console) | Sudah ada |
| ID block | `crypto.randomUUID()` dengan fallback (sudah dipakai `createId`) | Sudah ada |

Yang sengaja tidak ditambahkan: `parse5`, `cheerio`, `sanitize-html`, `jsdom` sebagai runtime
dependency, `htmlparser2`, atau library impor/ekspor email. Jika kelak impor perlu dilakukan
server-side (mis. untuk konsumen API non-console), desain terpisah harus mengevaluasi `parse5`
(ukuran, lisensi, maintenance, kompatibilitas Node 24) dan endpoint baru; keputusan itu tidak
diambil di sini.

## 8. Kontrak endpoint dan console

### 8.1 Endpoint

**Tidak ada endpoint baru dan tidak ada perubahan kontrak HTTP.** Ringkasnya:

| Endpoint | Perubahan |
|---|---|
| `POST /api/v1/admin/templates` | Tidak berubah; menerima `builderData` hasil impor seperti dokumen builder biasa |
| `PUT /api/v1/admin/templates/:id` | Tidak berubah |
| `POST /api/v1/admin/templates/preview`, `/:id/preview` | Tidak berubah; preview tetap menerima `body` hasil render console |
| Endpoint aset/test send/publish | Tidak berubah |

Konsekuensi: `openapi/notifhub.json` tidak berubah, tidak ada migrasi, tidak ada env baru, dan
konsumen API non-console belum bisa memakai impor (batasan yang disengaja).

### 8.2 Kontrak fungsi importer (console)

Modul baru `console/src/lib/htmlImport.ts`, fungsi murni tanpa akses jaringan/DOM global selain
parser:

```ts
export interface HtmlImportOptions {
  maxInputBytes?: number; // default 262_144
  maxNodes?: number;      // default 5_000
}

export interface HtmlImportIssue {
  code: string;
  severity: 'error' | 'warning';
  element?: string; // mis. "table", "a", "p"
  path: string;     // mis. "body>div:nth-child(2)>p"
  message: string;  // Bahasa Indonesia, tanpa data sensitif
}

export interface HtmlImportSummary {
  blocks: number;
  byType: Record<string, number>;
  droppedCssRules: number;
  droppedStyleAttributes: number;
  ignoredElements: number;
  bytes: number; // ukuran JSON builderData
}

export interface HtmlImportResult {
  document: EmailBlockDocument | null; // null bila ada issue severity=error
  issues: HtmlImportIssue[];
  summary: HtmlImportSummary;
}

export function importHtmlToBlocks(html: string, options?: HtmlImportOptions): HtmlImportResult;
```

Kontrak: `document` tidak pernah berisi field di luar schema v1, ID unik dan cocok
`^[A-Za-z0-9_-]{1,64}$`, tidak ada teks HTML mentah di field teks, dan `document` harus lolos
`parseBlockDocument` di console serta `parseBuilderDocument` di server.

### 8.3 Perilaku UI

1. **Entri**: tombol `Impor HTML` (outline-secondary) di tab **Konten**, hanya untuk
   `channel === 'email'`, `!readOnly`, dan tidak tergantung mode editor saat ini. Tombol ekspor
   (`Unduh HTML`, `Salin HTML`) tetap seperti sekarang.
2. **Dialog** (`ImportHtmlDialog`, memakai Modal Bootstrap yang sudah dipakai dialog publish):
   - input file `accept=".html,.htm,text/html"` + textarea tempel (salah satu);
   - tombol **Analisis**; file > 262.144 byte ditolak sebelum dibaca;
   - status loading (`aria-live="polite"`), lalu ringkasan: `N block · W peringatan · E error`,
     tabel block (urutan, tipe, cuplikan ≤ 80 karakter), dan daftar issue;
   - tombol **Terapkan** hanya aktif bila tidak ada `error`; **Batal** menutup tanpa perubahan.
3. **Menerapkan** (hanya setelah konfirmasi bila block saat ini bukan default): `setBlockDocument`,
   `setEditorMode('visual')`, tampilkan warning impor di panel validasi yang ada, dan
   `saveNotice` = "HTML diimpor menjadi N block. Simpan draft untuk menyimpan hasil." Riwayat
   undo/redo block di-reset (batasan).
4. **Preview**: memakai tombol Preview yang ada setelah diterapkan (pipeline server-side dengan
   sample data/theme/layout), bukan render lokal.
5. **Aksesibilitas**: label eksplisit untuk file/textarea, tabel ringkasan dengan header, error
   dibacakan lewat `aria-live`, fokus kembali ke ringkasan setelah analisis, target sentuh memadai.

## 9. Batas dan penanganan kesalahan

| Aspek | Batas | Perilaku |
|---|---|---|
| Ukuran input HTML | 262.144 byte | Error `import_input_too_large` |
| Jumlah node yang ditelusuri | 5.000 | Error `import_too_many_nodes` |
| Ukuran JSON `builderData` | 65.536 byte (batas server) | Error `import_document_too_large` |
| Jumlah block | 200 | Error `import_block_limit` |
| Panjang teks heading/text | 10.000 karakter | Error `import_text_too_long` |
| Panjang label tombol / alt gambar | 500 karakter | Error `import_field_too_long` |
| Panjang URL | 2.048 karakter | Error `import_url_too_long` |
| Lebar gambar | 80–600 px | Clamp; di luar rentang memakai 552 |
| Heading level | 1–3 | h4–h6 → 3 + warning |
| Block kosong | — | Tidak dibuat; tidak dihitung |

Severity:

- **Error** (impor ditolak, `document = null`): tag berbahaya, list, tabel multi-sel, Handlebars
  blok, tag block tak dikenal, tanpa block yang dapat diimpor, dan semua pelanggaran batas di atas.
- **Warning** (impor boleh diterapkan): format inline dibuang, link inline/gambar dibuang, heading
  di-clamp, elemen tersembunyi dilewati, CSS dibuang, komentar kondisional dibuang, URL tidak aman
  diganti kosong, tag inline tak dikenal diratakan.

Semua pemeriksaan berjalan di console sebelum data dikirim; server tetap memvalidasi ulang dan dapat
mengembalikan `422` dengan kode `builder_*` (lihat
`docs/design/templates/template-limitations-roadmap.md` §5.2). Pesan issue tidak memuat isi teks
lengkap; cuplikan hanya ditampilkan di UI, bukan dikirim ke server.

## 10. Rencana test dan verifikasi

### 10.1 Unit test console (wajib)

`console/src/lib/htmlImport.test.ts` (Vitest, jsdom), minimal:

| Kelompok | Assertion |
|---|---|
| Mapping heading | h1/h2/h3 → level 1/2/3; h4–h6 → 3 + `import_heading_level_clamped` |
| Paragraf/teks | `<p>` → `text`; `<br>` → `\n`; beberapa paragraf → beberapa block; div inline → satu block; teks liar → block |
| Format inline | `<strong>`/`<em>` → teks + warning; tidak ada tag tersisa di field `text` |
| Link | anchor tunggal → `button` + `align`; link dalam paragraf → teks + warning berisi href; `<a><img></a>` → image + warning |
| Gambar | `src`/`alt`/`width` atribut; width style clamp 80–600; token URL; `javascript:`/`data:`/relatif → URL kosong + warning |
| Divider | `<hr>` → `divider` |
| Container | table satu sel transparan; `div` bersarang; urutan terjaga |
| Penolakan | `ul`, table multi-sel, `script`, `svg`, Handlebars blok → error; `document === null` |
| Sanitasi teks | `&amp;`/`&lt;`/`&nbsp;` decode tepat sekali; spasi dipadatkan; tanpa double escape |
| CSS | `<style>` dibuang + hitungan; `display:none` inline dilewati + warning; `text-align` memengaruhi align |
| Batas | 201 block, teks 10.001, dokumen > 64 KiB, input > 262.144 byte, 5.001 node → error masing-masing |
| Round-trip | `renderBlocksToHtml(importHtmlToBlocks(html))` menghasilkan HTML tanpa tag sumber dan memuat teks yang diharapkan |
| Kontrak | ID unik/cocok pola; `parseBlockDocument(result.document)` tidak null; tidak ada field ekstra |

### 10.2 Test komponen (opsional, disarankan)

`console/src/components/ImportHtmlDialog.test.tsx`: menampilkan laporan, menonaktifkan **Terapkan**
saat ada error, memanggil `onApply` dengan dokumen valid, dan menolak file melebihi batas.

### 10.3 Regresi backend

- `npm run test:unit` (73 test) dan `npm run test:e2e -- --runInBand` (47 test, E20/E21 sebagai
  regresi kontrak `builderData`) — diharapkan lulus tanpa perubahan ekspektasi.
- `npm run ci` (typecheck, build, unit, e2e, status migrasi; 14 migrasi, tanpa migrasi baru).
- E2E baru **opsional** (E48): buat template dengan dokumen hasil impor (enam tipe block),
  publish, dan pastikan `body` serta `builderData` tersimpan utuh. Nilainya kecil karena server
  tidak berubah; keputusan diserahkan pada §13.

### 10.4 Regresi paket dan dokumentasi

- `npm --prefix console run test` (23 test + test baru), `npm run console:typecheck`,
  `npm run console:build`.
- `npm run sdk:typecheck`, `npm run sdk:test` (36), `npm run react:test` (5) — tidak menyentuh
  paket, dijalankan sebagai regresi.
- `npm run docs:check` setelah menambah/mengubah dokumen.

### 10.5 Verifikasi manual end-to-end (tanpa Playwright)

1. Buka template email baru, mode Visual, klik **Impor HTML**, tempel fixture contoh.
2. Periksa laporan: jumlah block per tipe, warning yang diharapkan, tidak ada error.
3. **Terapkan** → block tampil di builder; Preview (server-side) menampilkan heading/paragraf/
   gambar/tombol/divider sesuai tema.
4. Simpan draft; query DB `NotificationTemplate.builderData` dan `body`; pastikan sesuai.
5. Publish; cek `status='published'`, `active=true`, dan tidak ada error validasi.
6. Coba HTML dengan `<script>`/`ul`/tabel multi-sel: **Terapkan** tidak aktif dan pesan jelas.
7. Coba HTML berisi `{{#if}}`: ditolak dengan pesan untuk memakai mode HTML.
8. Cek preview tetap `sandbox=""` di DevTools dan tidak ada error console.

## 11. Risiko dan batasan

| Risiko | Mitigasi |
|---|---|
| Pemetaan ambigu (mis. heading 4–6, teks di dalam div) menghasilkan struktur berbeda dari niat admin | Laporan per block + preview server-side sebelum publish + tombol Terapkan eksplisit; warning menyebut transformasi |
| CSS hilang membuat tampilan berbeda | Dinyatakan sejak dialog ("CSS tidak diimpor"); setelah terapkan admin memilih theme/layout; preview final menunjukkan hasil |
| Preheader tersembunyi via kelas CSS ikut tampil sebagai teks | Deteksi inline `display:none`/`visibility:hidden`/`opacity:0`; keterbatasan kelas CSS didokumentasikan |
| HTML email nyata memakai tabel layout dua kolom | Ditolak eksplisit (`import_multi_cell_table_unsupported`) alih-alih ditebak; admin memakai mode HTML atau menyusun ulang block |
| Importer menghasilkan field ilegal | Validasi client `parseBlockDocument` + server `parseBuilderDocument` (422) |
| HTML sangat besar/bersarang membekukan tab | Batas byte/node sebelum traversal |
| XSS lewat atribut/teks | Dokumen inert + hanya `textContent`/atribut terpilih + URL allowlist + server sanitizer |
| Ekspektasi "impor sempurna" | Ruang lingkup subset kecil ditulis di dialog dan dokumen ini |
| Undo tidak mencakup impor | Riwayat di-reset; konfirmasi sebelum mengganti block; simpan draft baru setelah puas |
| Duplikasi logika mapping dengan `renderBlocksToHtml` | Round-trip test menjaga keduanya konsisten; mapping hanya satu arah dan tidak mengubah renderer |

## 12. Daftar file yang direncanakan

### Baru

| File | Isi |
|---|---|
| `console/src/lib/htmlImport.ts` | Parser subset, pemetaan ke `EmailBlockDocument`, laporan issue/ringkasan |
| `console/src/lib/htmlImport.test.ts` | Unit test importer |
| `console/src/components/ImportHtmlDialog.tsx` | Dialog impor (input, analisis, laporan, terapkan) |
| `console/src/components/ImportHtmlDialog.test.tsx` | Test komponen (opsional, disarankan) |
| `docs/design/templates/html-import-design.md` | Dokumen ini |

### Diubah

| File | Perubahan |
|---|---|
| `console/src/pages/TemplateFormPage.tsx` | Tombol **Impor HTML** di tab Konten, wiring dialog, notice, warning |
| `console/src/lib/emailBlocks.ts` | Hanya bila perlu mengekspor helper (mis. tipe dokumen); tanpa perubahan perilaku |
| `docs/README.md`, `docs/design/README.md` | Indeks dokumen (sudah dilakukan bersama draf ini) |
| `docs/design/templates/template-limitations-roadmap.md` | Status impor HTML di §14.4 (setelah implementasi) |
| `docs/architecture/project-brief.md` | §7 butir 9 (setelah implementasi) |
| `docs/design/templates/email-block-builder-design.md` | §6 batasan "belum ada impor HTML" (setelah implementasi) |

Tidak ada perubahan pada `src/`, `prisma/`, `test/`, `openapi/`, `packages/`, atau `console/package.json`.

## 13. Pertanyaan persetujuan

Pertanyaan di bawah diajukan sebelum implementasi; semuanya disetujui dengan default yang
direkomendasikan dan hasilnya dicatat di §14.

1. **Subset**: setuju impor hanya menghasilkan `heading`, `text`, `image`, `button`, `divider`,
   sementara `spacer` dan `columns` tidak diimpor (D1)?
2. **CSS**: setuju seluruh CSS tidak diimpor, dan hanya `text-align`/`width`/`display` dibaca untuk
   pemetaan (D4)?
3. **Arsitektur**: setuju impor berjalan di console dengan `DOMParser`, tanpa endpoint baru dan
   tanpa dependency baru, dengan server tetap validator akhir (D3, §7)?
4. **Kehilangan data**: setuju kebijakan `error` vs `warning` di §9 (format inline/link/heading
   clamp/URL tidak aman/hidden menjadi warning; tag berbahaya/list/tabel multi-sel/Handlebars blok
   dan pelanggaran batas menjadi error) (D5–D7)?
5. **Batas**: setuju batas input 262.144 byte, 5.000 node, serta batas server 200 block/64 KiB/
   10.000 teks/500 label/500 alt/2.048 URL (D8)?
6. **UX**: setuju tombol **Impor HTML** di tab Konten (email, bukan read-only), hasil menggantikan
   block setelah konfirmasi, dan preview memakai pipeline server-side yang ada (D9)?
7. **Cakupan rilis**: setuju tanpa schema/migrasi/env/OpenAPI/SDK dan tanpa E2E baru, dengan unit
   test console + regresi E20/E21 sebagai bukti (D10–D11)?
8. **E2E opsional**: perlu E48 (dokumen hasil impor enam tipe block → publish) atau cukup unit test
   console + verifikasi manual?

Setelah disetujui, urutan implementasi: `htmlImport.ts` + unit test → dialog + wiring →
`console:typecheck/test/build` → verifikasi manual end-to-end → dokumentasi status → commit.

## 14. Catatan implementasi

Status: **terimplementasi dan terverifikasi** pada 2026-11-22.

### 14.1 Yang diterapkan

| Area | Perubahan |
|---|---|
| Importer | `console/src/lib/htmlImport.ts`: `importHtmlToBlocks(html, options)` memakai `DOMParser`, traversal container transparan, pemetaan heading/text/image/button/divider, issue + ringkasan |
| Dialog | `console/src/components/ImportHtmlDialog.tsx`: tempel/berkas, **Analisis**, ringkasan block/issue, **Terapkan** dengan konfirmasi |
| Wiring | `console/src/pages/TemplateFormPage.tsx`: tombol **Impor HTML** di tab Konten (email, bukan read-only), `applyHtmlImport` mengisi block, mode Visual, notice, warning di panel validasi, riwayat undo di-reset lewat `historyKey` |
| Batas | Input 262.144 byte, 5.000 elemen, 200 block, 64 KiB dokumen, 10.000 teks, 500 label/alt, 2.048 URL; lebar gambar clamp 80–600 |
| Keamanan | Dokumen inert; hanya `textContent`/atribut terpilih; URL http/https/token; tag berbahaya, list, tabel multi-sel, dan Handlebars blok ditolak |
| Endpoint/schema | Tidak ada perubahan; server tetap memvalidasi lewat `parseBuilderDocument` |

Tidak ada dependency baru, migrasi, env, perubahan OpenAPI, SDK, atau Go module.

### 14.2 Deviasi dan keputusan tambahan

1. **Analisis sinkron** (tanpa spinner/timer) karena parsing lokal hanya beberapa milidetik untuk
   batas 256 KB; tombol dinonaktifkan selama HTML kosong.
2. **Deteksi tersembunyi** menambah `max-height:0` dan `mso-hide:all` (pola preheader email) di luar
   `display`/`visibility`/`opacity` yang disebut §5.
3. **Kode issue baru** `import_image_src_missing` untuk `<img>` tanpa `src`; block tetap dibuat
   dengan URL kosong (schema mengizinkannya).
4. **Tag block tak dikenal** memakai daftar eksplisit (`blockquote`, `pre`, `dl`, `picture`, dst.)
   agar tidak bergantung pada heuristik turunan anak.
5. **Batas node** dihitung dari jumlah elemen (`querySelectorAll('*')`), bukan seluruh node DOM.
6. `<head>` dibuang tanpa warning tersendiri; aturan `<style>` di head tetap dihitung di
   `summary.droppedCssRules`.
7. **Undo/redo tidak mencakup impor**: `historyKey` dinaikkan sehingga riwayat builder di-reset
   sesudah impor, sesuai §8.3.
8. `spacer`/`columns` tidak diimpor; `<ul>`/`<ol>` dan tabel multi-sel ditolak eksplisit.
9. Preview memakai pipeline server-side setelah diterapkan; dialog tidak merender HTML lokal
   (menghindari ekspresi theme Handlebars mentah).
10. **Test send tidak diverifikasi ulang** pada backend dev yang berjalan: endpoint mengembalikan
    `502 Invalid address in to: ""` karena proses tersebut memakai `NOTIFHUB_MODE=staging` dengan
    catch-all yang tidak valid. Jalur render sudah diverifikasi lewat preview dan test send tetap
    dicakup E15 di `npm run ci` (mode development, status `simulated`).

### 14.3 Bukti verifikasi

| Pemeriksaan | Hasil |
|---|---|
| `npm --prefix console run test` | **55** test lulus (10 file); 26 test importer + 6 test dialog baru |
| `npm run console:typecheck` | lulus |
| `npm run console:build` | lulus; tenant 1.028,33 KB / 299,01 KB gzip (naik ±18 KB), platform 505,74 KB / 154,74 KB gzip (tidak berubah) |
| `npm run ci` | lulus **98 s** (6 langkah): typecheck, build, 73 unit, 47 e2e, 14 migrasi (tanpa migrasi baru) |
| `npm run sdk:typecheck` / `sdk:test` / `react:test` | lulus; 36 test SDK, 5 test React |
| `npm run docs:check` | lulus — 572 tautan/anchor, 46 file |
| GitHub Actions | run commit ini hijau (lihat laporan akhir) |

Verifikasi end-to-end manual terhadap backend dev (`:3000`), memakai **HTML nyata** yang diproses
modul importer asli:

1. Fixture: `h1`, `h4`, paragraf dengan `<strong>`/`<br>`, paragraf dengan link inline, `<img>`
   lebar 600, tombol center, `<hr>`, paragraf penutup, `div` preheader `display:none`, wrapper
   `<table>` satu sel, dan `<style>` di head.
2. Hasil importer: **8 block** (2 heading, 3 text, 1 image, 1 button, 1 divider) dengan warning
   `import_css_dropped`, `import_hidden_element_skipped`, `import_heading_level_clamped`,
   `import_inline_formatting_dropped`, `import_inline_link_dropped`.
3. `POST /api/v1/admin/templates` → **201**, `status=draft`, `builderData.blocks` = 8.
4. `POST /api/v1/admin/templates/:id/preview` → **200**; `html` memuat `<h3`,
   `cdn.example.com/box.png`, dan `Lacak paket`; `text` memuat `Pesanan INV-001 sudah dikirim`;
   `missingVariables` kosong.
5. `POST /api/v1/admin/templates/:id/publish` → **200**, `status=published`, `active=true`,
   `validation.warnings` = 0.
6. DB (`NotificationTemplate`): 8 block dengan tipe
   `heading,heading,text,text,image,button,divider,text`; `body` 1.958 karakter memuat gambar dan
   tombol.
7. `DELETE /api/v1/admin/templates/:id` → **200**, `active=false` (data uji dinonaktifkan).

### 14.4 Batasan yang tersisa

- CSS, layout, dua kolom, dan list tidak diimpor; tampilan final bergantung theme/layout yang
  dipilih setelah impor.
- Handlebars blok/partial/komentar ditolak; template dengan loop/conditional tetap memakai mode
  HTML.
- Elemen tersembunyi melalui kelas CSS (bukan inline) tidak terdeteksi.
- Tidak ada endpoint impor server-side, sehingga konsumen API non-console belum bisa memakai
  impor; bila dibutuhkan kelak, perlu desain terpisah dengan parser (mis. `parse5`).
- Verifikasi interaksi browser tetap manual (tanpa Playwright); komponen diuji dengan jsdom.
