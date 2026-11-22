# Roadmap batasan template dan authoring

Status: **P0, P1, dan slice P2 terimplementasi dan terverifikasi** (D10 + upload gambar pada
2026-11-16; impor HTML subset kecil pada 2026-11-22). Item P2 lain belum dimulai. Lihat §11, §12,
§13, §14, dan `docs/design/templates/html-import-design.md`.

Tanggal: 2026-11-16
Basis: `docs/design/templates/template-system-design.md`, `docs/design/templates/email-authoring-ui-design.md`,
`docs/design/templates/email-block-builder-design.md`, `docs/architecture/project-brief.md`, kode template/admin/worker/cleanup,
console template, dan suite E2E E1–E20. HEAD desain: `348eb64` (working tree bersih; berisi
`29072f6` dan perbaikan sidebar setelahnya).

**Isi dokumen**

- [1. Ringkasan prioritas](#1-ringkasan-prioritas)
- [2. Penilaian 13 batasan](#2-penilaian-13-batasan)
- [3. D1 — Prioritas P0/P1/P2 dan alasan](#3-d1--prioritas-p0p1p2-dan-alasan)
- [4. Keputusan D2–D13](#4-keputusan-d2d13)
- [5. Perubahan schema, API, dan console](#5-perubahan-schema-api-dan-console)
- [6. Migrasi dan backward compatibility](#6-migrasi-dan-backward-compatibility)
- [7. Rencana keamanan dan sanitasi](#7-rencana-keamanan-dan-sanitasi)
- [8. Rencana test, verifikasi, dan regresi](#8-rencana-test-verifikasi-dan-regresi)
- [9. Risiko dan hal yang sengaja ditunda](#9-risiko-dan-hal-yang-sengaja-ditunda)
- [10. Definition of done dan persetujuan](#10-definition-of-done-dan-persetujuan)
- [11. Implementasi dan verifikasi P0](#11-implementasi-dan-verifikasi-p0)
- [12. Implementasi dan verifikasi P1](#12-implementasi-dan-verifikasi-p1)
- [13. Implementasi dan verifikasi P2 (D10)](#13-implementasi-dan-verifikasi-p2-d10)
- [14. Implementasi dan verifikasi P2 (upload gambar)](#14-implementasi-dan-verifikasi-p2-upload-gambar)

---

## 1. Ringkasan prioritas

### 1.1 Tujuan fase ini

Menutup batasan yang berisiko pada **integritas data, deliverability, dan pertumbuhan data**,
tanpa menambah dependency, tanpa mengubah paket npm terbit (`@notifhub/js` 0.3.0,
`@notifhub/react` 0.2.0), Go module path, tiga lane auth, atau stack console. Perubahan
dilakukan bertahap: P0 disetujui dan diimplementasikan lebih dulu; P1 dan P2 dibuka sebagai fase
terpisah dengan persetujuan baru.

### 1.2 Tabel prioritas terhadap 13 batasan

| # | Batasan | Prioritas | Keputusan singkat |
|---|---|---|---|
| 1 | `builderData` belum divalidasi backend | **P0** | Validasi schema v1 ketat, limit ukuran, normalisasi, tolak tulis invalid; baris legacy hanya warning saat publish |
| 2 | Belum drag-and-drop/undo-redo | **P1** | Native HTML5 DnD + tombol naik/turun sebagai jalur keyboard; undo/redo stack lokal tanpa dependency |
| 3 | HTML ↔ Visual belum impor/ekspor | **P1/P2** | Ekspor HTML di P1; impor HTML arbitrer **ditolak** sampai ada parser yang disetujui. **2026-11-22:** impor subset kecil (heading/paragraf/gambar/tombol/divider) selesai via console `DOMParser`; impor HTML arbitrer tetap di luar cakupan |
| 4 | Dua kolom bergantung `.nh-col` | **P1** | Pertahankan tabel + media query; tambah warning validasi bila layout tidak punya `.nh-col` |
| 5 | Belum upload gambar | **P2 (selesai)** | Upload multipart tervalidasi (PNG/JPEG/WebP/GIF, maks 5 MiB/4000 px), storage lokal tenant-scoped, URL publik UUID; SVG ditolak |
| 6 | Retensi audit/test send/aset | **P0/P1** | Cleanup test send 180 hari, audit 730 hari (bisa dimatikan); aset P1: hapus manual hanya jika usage=0 |
| 7 | Belum approval maker-checker/diff | **P2** | Ditunda; butuh RBAC/role yang belum ada. Audit actor sudah tersedia |
| 8 | Email HTML-only, tanpa plain-text | **P0** | Generate plain-text dari HTML final di server; fallback aman ke HTML-only; provider kirim multipart |
| 9 | Markdown in-app | **P2** | Selesai 2026-11-21: subset aman dirender server-side; SDK/React terbit; lihat `docs/design/templates/in-app-markdown-design.md` |
| 10 | Meta approved WhatsApp tertunda | **P2** | Tetap ditunda; provider masih text-only, butuh model template Meta terpisah |
| 11 | Sanitizer pola, preview manual tanpa Playwright | **P0/P2** | P0: tetap pola + sandbox + CSP, tambah corpus test; P2: evaluasi parser penuh/Playwright dengan persetujuan |
| 12 | Versi template tidak dicatat per notifikasi | **P2 (selesai)** | Kolom nullable `NotificationRecipient.templateId/templateVersion/templateResolvedAt`; worker mengisi saat resolve; tanpa backfill |
| 13 | Aset belum usage count/proteksi hapus | **P1** | Tambah `usageCount` dan endpoint delete yang menolak aset terpakai (409) |

### 1.3 Prinsip yang dipakai

1. **P0 adalah risiko, bukan kenyamanan.** Validasi `builderData`, plain-text, dan retensi
   menyentuh data yang disimpan/dikirim setiap hari. P1 adalah produktivitas/ketahanan UI. P2
   adalah fitur besar atau terblokir dependency/RBAC.
2. **Aditif dan bisa di-rollback.** Schema P0 hanya menambah index; tidak ada drop/rename,
   tidak ada backfill destruktif.
3. **Worker lama tetap aman.** Plain-text adalah bagian tambahan; jika generasi gagal atau
   kosong, email tetap dikirim seperti sekarang (HTML-only).
4. **Tanpa dependency baru.** Semua P0/P1 memakai dependency yang sudah ada (zod, Jest,
   Handlebars, React/Bootstrap, Nodemailer).
5. **Tenant-scoped di semua query.** Validasi/aset/delete memakai `tenantId` dari JWT admin;
   cleanup retensi adalah job sistem global yang hanya menghapus berdasarkan waktu, bukan
   membaca konten lintas tenant.
6. **SDK terbit tidak disentuh.** Semua perubahan API bersifat aditif; console tetap memakai
   wrapper `HttpTransport` lokal.

---

## 2. Penilaian 13 batasan

### 2.1 Fakta yang relevan saat ini

| Area | Kondisi (bukti) |
|---|---|
| `builderData` | Kolom `NotificationTemplate.builderData Json?` ada. DTO memakai `@IsObject()` opaque di create/update. Service menyimpan `jsonInput(dto.builderData)` pada create/update/clone/rollback/legacy version. Tidak ada validasi version/blocks/ukuran/URL. |
| Block builder | `console/src/components/EmailBlockBuilder.tsx` hanya tombol naik/turun/duplikat/hapus. Tidak ada DnD, undo/redo. |
| HTML/Visual | `TemplateFormPage.tsx`: beralih ke Visual memberi konfirmasi. **Sejak 2026-11-22** tersedia tombol **Impor HTML** (subset kecil: heading/paragraf/gambar/tombol/divider) yang memetakan HTML ke `builderData` di console; lihat `docs/design/templates/html-import-design.md`. Beralih ke HTML menghapus `builderData` saat disimpan. |
| Dua kolom | `emailBlocks.ts` menghasilkan `<table>` dengan `<td class="nh-col" width="50%">`. Media query `.nh-col { display:block; width:100% }` hanya ada di layout preset `console/src/lib/emailDesign.ts`, bukan di body/block. Layout kustom tanpa `.nh-col` tidak menumpuk. |
| Gambar | `image` block dan layout/partial memakai URL `http/https`; tidak ada upload. |
| Retensi | `CleanupService` hanya punya `runRetention` (notifikasi) dan `runIdempotencyCleanup`. `TemplateAuditEvent` dan `TemplateTestSend` tumbuh tanpa batas. Aset append-only tanpa delete. |
| Approval/diff | Tidak ada role selain `tenant_admin`; `platform_admin` ditolak. Audit menyimpan actor. Tidak ada diff. |
| Plain-text | `RenderedTemplate` hanya `subject/preheader/body/format`; `ProviderSendInput` tidak punya field teks; `EmailProvider.sendMail` hanya `{ html: input.body }`. Preview email selalu `text: null`. |
| Markdown | Didukung untuk `inapp` (subset aman, dirender server-side ke `bodyHtml`); `email`/`whatsapp`/`sms` tetap menolak markdown. |
| Meta WhatsApp | Provider WhatsApp hanya `type: "text"`; belum ada template name/parameter/approval. |
| Sanitizer | `template.safety.ts` berbasis regex pola; preview memakai iframe `sandbox=""` + CSP. Verifikasi UI manual. |
| Versi per notifikasi | Worker memanggil `TemplateService.resolve` saat memproses; tidak ada kolom template di `NotificationRecipient`/`DeliveryAttempt`. |
| Aset | `layoutId/themeId` FK restrict; partial lewat `TemplatePartialLink`; tidak ada usage count/delete. |

### 2.2 Dampak jika tidak dikerjakan

- `builderData` invalid/oversize dapat tersimpan permanen, memperbesar row, membingungkan
  editor, dan menyulitkan migrasi schema block di masa depan. Karena worker tidak membacanya,
  dampaknya bukan pengiriman salah, tetapi integritas data dan biaya migrasi.
- Email tanpa plain-text lebih mudah masuk spam, tidak ramah pembaca teks, dan tidak memenuhi
  ekspektasi aksesibilitas dasar.
- Audit/test send tanpa retensi menambah PII operasional (recipient masked/hash, error) dan
  biaya storage tanpa batas.
- Dua kolom tanpa jaminan stacking menghasilkan layout rusak di mobile untuk layout kustom.
- Menunda validasi sampai ada upload/approval akan memperbesar data legacy yang harus
  dimigrasikan nanti.

---

## 3. D1 — Prioritas P0/P1/P2 dan alasan

**Default: P0 = #1, #8, #6 (audit/test send), plus E2E baru dan regresi E1–E20.**

### 3.1 P0 (wajib di fase ini)

| Item | Alasan |
|---|---|
| Validasi `builderData` + limit + test | Titik masuk data paling tidak tepercaya yang saat ini lolos tanpa pemeriksaan. Perbaikannya terpusat, murah, dan mencegah data buruk menjadi legacy. Tidak perlu kolom baru. |
| Plain-text alternative email | Dampak langsung ke deliverability dan aksesibilitas. Nodemailer sudah mendukung `text`; tidak perlu schema/API/SDK baru. Fallback HTML-only menjaga kompatibilitas. |
| Retensi audit/test send | Mengikuti pola `CleanupService` yang sudah ada; hanya butuh env + index. Mencegah pertumbuhan PII operasional. |
| E2E baru + regresi | Memastikan tiga perubahan di atas tidak memecahkan E1–E20 dan worker/provider lama. |

### 3.2 P1 (setelah P0 stabil)

| Item | Alasan |
|---|---|
| Drag-and-drop + undo/redo | Produktivitas editor; tanpa dependency dan tanpa risiko data. Tombol naik/turun tetap ada sebagai jalur aksesibel. |
| Ekspor HTML | Hampir gratis karena `body` sudah HTML; berguna untuk review/backup. |
| Dua kolom lebih teruji | Warning validasi + dokumentasi client; tidak mengubah HTML block secara besar. |
| Usage count + proteksi hapus aset | Mencegah admin menghapus aset yang masih direferensikan; menjaga reproducibility. |

### 3.3 P2 / ditunda

| Item | Alasan/penghalang |
|---|---|
| Impor HTML arbitrer ke Visual | **Subset kecil selesai 2026-11-22** (tanpa dependency, `DOMParser` di console; lihat `docs/design/templates/html-import-design.md`). Impor HTML arbitrer (tabel/list/CSS penuh) tetap butuh parser dan keputusan dependency. |
| Upload gambar/storage | Butuh storage, MIME sniffing, limit, signing, dan keputusan dependency; URL-only masih aman. |
| Approval maker-checker/diff | Butuh RBAC/role dan tabel approval; belum ada role selain `tenant_admin`. |
| Template version per notifikasi | Perlu kolom baru + perubahan worker/admin; bukan bug, hanya keterbatasan audit. |
| Markdown in-app | Selesai 2026-11-21 (backend + console + `@notifhub/js` 0.4.0 + `@notifhub/react` 0.3.0); lihat `docs/design/templates/in-app-markdown-design.md`. |
| Meta approved WhatsApp | Terblokir model provider yang masih text-only. |
| Parser sanitizer penuh/Playwright | Investasi keamanan/test yang butuh evaluasi dependency dan persetujuan terpisah. |

**Alasan tidak mengerjakan semuanya sekarang:** P0 memiliki rasio risiko/manfaat terbaik dan
tidak mengubah kontrak SDK. P1 bergantung pada P0 yang stabil (terutama format `builderData`).
P2 membutuhkan keputusan arsitektur (storage/RBAC/provider) yang tidak boleh dipaksakan di
dalam fase ini.

---

## 4. Keputusan D2–D13

### D2 — Schema, versi, dan limit `builderData`

**Default: schema v1 ketat divalidasi di server; limit 200 block dan 64 KiB; normalisasi;
tolak tulis invalid; baris legacy hanya warning.**

#### D2.1 Bentuk yang diterima

```json
{
  "version": 1,
  "blocks": [
    { "id": "b1", "type": "heading", "text": "Halo {{nama}}", "level": 1 },
    { "id": "b2", "type": "text", "text": "Pesanan sudah dikirim." },
    { "id": "b3", "type": "button", "label": "Lacak", "url": "https://example.com", "align": "left" }
  ]
}
```

Tipe block yang diizinkan tetap: `heading`, `text`, `image`, `button`, `divider`, `spacer`,
`columns`. Tidak ada block baru di P0.

#### D2.2 Limit

| Aspek | Batas | Perilaku |
|---|---|---|
| `version` | harus `1` | `422 builder_unsupported_version` |
| `blocks` | maksimum 200 | `422 builder_too_many_blocks` |
| Ukuran JSON UTF-8 | maksimum 65.536 byte | `422 builder_too_large` |
| `id` block | 1–64 char, `^[A-Za-z0-9_-]+$`, unik | `422 builder_duplicate_id` / `builder_block_invalid` |
| `heading.text`, `text.text` | maksimum 10.000 char | `422 builder_block_invalid` |
| `columns.left/right` | maksimum 5.000 char per kolom | `422 builder_block_invalid` |
| `button.label`, `image.alt` | maksimum 500 char | `422 builder_block_invalid` |
| `image.url`, `button.url` | maksimum 2.048 char; kosong atau `http/https` atau token `{{...}}` persis | `422 builder_url_unsafe` |
| `image.width` | string numerik 80–600 | default 552 bila absen |
| `spacer.height` | string numerik 4–120 | default 24 bila absen |
| `heading.level` | 1, 2, atau 3 | default 1 |
| `button.align` | `left`/`center`/`right` | default `left` |
| Nested block | tidak ada di v1; `columns` hanya teks | `422 builder_block_invalid` |
| Field tak dikenal | ditolak | `422 builder_unknown_field` |
| `builderData` pada channel non-email | ditolak | `422 builder_channel_mismatch` |

Catatan: batas 64 KiB dipilih karena `builderData` hanya dokumen round-trip editor, bukan
dokumen HTML; `body` tetap punya batas 256 KiB dan parser admin 1 MiB. Dengan 200 block dan
10.000 char/block, batas JSON praktis sudah tercapai lebih dulu, sehingga kedua batas saling
mengamankan.

#### D2.3 Validasi dan normalisasi server

- Modul baru `src/templates/template.builder.ts` (zod sudah dependency):
  - `parseBuilderDocument(channel, value): { document, issues }`
  - `assertBuilderDocument(...)` untuk jalur tulis
  - `builderDocumentReferencesColumns(document)` untuk warning dua kolom
- **Jalur tulis** (`POST /templates`, `PUT /templates/:id`, termasuk auto-publish legacy):
  - Jika `builderData` dikirim non-null: validasi + normalisasi (hanya field known, default
    terisi, urutan block dipertahankan). Invalid → **422** dengan envelope validasi yang sudah
    ada (`details.code = 'template_validation_failed'`, `details.errors[]` berisi code di atas).
  - Draft **juga** ditolak jika struktur invalid. Alasannya: draft boleh belum layak publish,
    tetapi tidak boleh menyimpan dokumen yang melanggar kontrak editor. Ini mencegah data
    invalid baru masuk.
  - `builderData: null` menghapus dokumen (perilaku existing `jsonInput(null)`).
- **Jalur publish**: validasi ulang `builderData` tersimpan. Baris legacy yang invalid hanya
  menghasilkan **warning** `builder_legacy_invalid` (tidak memblokir), karena worker tidak
  membacanya dan memblokir akan membuat draft lama tidak bisa dipublish.
- **Clone/rollback/legacy version**: salin `builderData` hanya jika valid. Jika invalid, set
  `null`, tambahkan warning `builder_legacy_invalid`, dan catat `metadata.builderDataDropped=true`
  di audit. Ini mencegah penyebaran dokumen invalid ke baris baru.
- **Preview**: tidak menerima `builderData` (body sudah dirender console). Tidak ada perubahan.
- **Migrasi schema block**: versi berikutnya (`version: 2`) harus diterima berdampingan dengan
  v1. Saat v2 dirilis, server menerima v1+v2 dan menormalkan ke versi yang didukung; tidak ada
  migrasi DB karena `builderData` adalah JSON. Ini alasan version ada sejak awal.

#### D2.4 Perubahan console

- `parseBlockDocument` saat ini **diam-diam membuang** block invalid. Ganti/tambah
  `parseBlockDocumentStrict` yang mengembalikan `issues`; jika ada block yang dibuang, tampilkan
  warning di editor dan jangan simpan dokumen hasil potongan tanpa konfirmasi.
- Setelah save, console memakai `builderData` normalisasi dari respons server (sudah dilakukan
  `toForm`/`parseBlockDocument`).
- Tampilkan error 422 `details.errors` di ringkasan error, bukan hanya `message`.
- `builderData` yang tidak ada/invalid → mode HTML (perilaku lama dipertahankan).

#### D2.5 Data legacy

- Tidak ada backfill/penghapusan. Baris invalid tetap ada dan tetap bisa dibaca.
- Tool opsional (read-only) `scripts/audit-builder-data.mjs` melaporkan jumlah baris invalid per
  tenant/versi untuk keputusan manual. Tidak dijalankan otomatis.

---

### D3 — Drag-and-drop dan undo/redo

**Default: native HTML5 drag-and-drop + tombol naik/turun; undo/redo stack lokal React; tanpa
dependency.**

- **DnD**: `draggable` pada header/handle block, `onDragStart/onDragOver/onDrop`, indikator
  posisi sisip. Tidak memakai library (react-dnd/dnd-kit) di P1.
- **Aksesibilitas**:
  - Tombol naik/turun **tetap ada** dan menjadi jalur utama keyboard/screen reader.
  - `aria-label` pada handle dan tombol; instruksi via `aria-describedby`.
  - Setelah reorder, umumkan posisi baru lewat `aria-live="polite"`.
  - Fokus dipertahankan pada block yang dipindah.
  - DnD bukan satu-satunya cara memindahkan block.
- **Mobile/touch**: HTML5 DnD tidak didukung baik di iOS/Android; tombol tetap solusi. Tidak
  menjanjikan DnD sentuh di P1.
- **Undo/redo**:
  - Hook lokal `useBlockHistory` menyimpan snapshot `EmailBlockDocument` (maksimum 50).
  - Coalesce perubahan teks dalam jendela 500 ms agar undo tidak per karakter.
  - Shortcut `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`/`Ctrl+Y` hanya aktif saat fokus bukan di
    `input/textarea/contenteditable`; tombol Undo/Redo selalu tersedia.
  - Riwayat tidak dipersist ke server; reset saat load/save.
- Fungsi murni `moveBlock`, `insertBlock`, `removeBlock`, `duplicateBlock` dipindah ke
  `emailBlocks.ts` agar bisa diuji unit tanpa browser.

---

### D4 — HTML ↔ Visual import/export

**Default: ekspor HTML didukung; impor HTML arbitrer ditolak di P1; impor terbatas di P2 dengan
parser yang disetujui.**

- **Ekspor (P1)**:
  - Tombol **Unduh HTML** mengunduh `body` fragment sebagai `.html`; tombol **Salin HTML**.
  - Opsional: unduh dokumen preview lengkap (layout + body) bila preview tersedia. Tidak ada
    endpoint baru.
  - Ekspor selalu bekerja, termasuk untuk template lama tanpa `builderData`.
- **Impor (P1)**: tombol “Impor HTML ke Visual” **ditolak** dengan pesan jelas. Alasan:
  - HTML arbitrer tidak punya pemetaan satu-satu ke 7 tipe block; memaksakan pemetaan berisiko
    kehilangan struktur/atribut.
  - Loop/conditional Handlebars, tabel kustom, dan inline style kompleks tidak dapat
    direpresentasikan visual.
  - Parser HTML penuh membutuhkan dependency (mis. parse5) yang belum disetujui.
  - Perilaku saat ini (konfirmasi lalu mulai block baru) dipertahankan; ditambah penjelasan
    bahwa HTML lama tidak diimpor otomatis.
- **P2 (jika disetujui)**: importer konservatif hanya untuk markup yang dihasilkan builder
  sendiri, dengan daftar tag/atribut yang didukung, preview diff, dan penolakan eksplisit jika
  ada konstruksi tak dikenal. Tidak ada silent lossy import.
- **Ekspor bukan alasan untuk mengubah `body`**: `body` tetap sumber kebenaran worker.

---

### D5 — Plain-text email

**Default: generate otomatis dari HTML final di server; tidak ada field terpisah; fallback aman
ke HTML-only; provider mengirim multipart/alternative.**

- **Tempat generate**: `TemplateRenderer.render` setelah sanitasi HTML dan pemeriksaan ukuran.
  Fungsi murni baru `src/templates/template.text.ts`:
  - Hapus `<style>`, `<script>`, `<head>`, komentar, conditional comment.
  - `br` → newline; blok (`p`, `div`, `tr`, `h1`–`h6`, `table`, `li`) → newline/blank line;
    `li` → `- `; `hr` → `---`.
  - `a` → `label (url)` bila URL http/https/mailto dan label berbeda; selain itu label.
  - `img` → `alt` atau `[gambar]`.
  - Decode entitas memakai `decodeHtmlEntities` yang sudah ada.
  - Collapse spasi/blank line berlebih; trim; batas 100.000 karakter.
  - Dukung penanda `data-nh-text-skip` pada elemen tersembunyi (preheader) dan heuristik
    `display:none` untuk layout lama.
- **Kontrak**:
  - `RenderedTemplate.text: string | null` (hanya email; channel teks tetap memakai `body`).
  - `ProviderSendInput.text?: string | null` (aditif, opsional).
  - `EmailProvider.sendMail({ html, text })` bila `text` ada; bila `null`/kosong, tetap
    `{ html }` persis seperti sekarang.
  - Worker email dan test send meneruskan `rendered.text`.
  - Preview email mengisi `text` (sebelumnya `null`); preview non-email tetap `text = body`.
- **Fallback**: jika generator menghasilkan string kosong/melebihi batas/waktu, set `null`,
  catat warning `plain_text_empty` + metrik, dan kirim HTML-only. Tidak pernah menggagalkan
  pengiriman hanya karena plain-text.
- **Tanpa kolom baru**: template lama otomatis mendapat plain-text pada render berikutnya.
  Field `textBody` manual **tidak** ditambahkan di P0; alasan: dua sumber kebenaran, UI sinkron,
  dan validasi ganda. Bisa dipertimbangkan P2 jika ada kebutuhan nyata.
- **Kompatibilitas**: klien yang mendukung HTML tetap memilih bagian HTML; klien teks
  mendapat versi teks. Tidak ada perubahan pada in-app/WhatsApp/SMS. Tidak ada perubahan SDK.
- **Layout**: preheader tersembunyi ditandai `data-nh-text-skip` pada preset layout console agar
  tidak muncul sebagai baris pertama plain-text. Layout kustom tanpa penanda memakai heuristik;
  jika tetap muncul, itu keterbatasan yang didokumentasikan.

---

### D6 — Upload gambar vs URL-only

**Default: upload gambar diimplementasikan pada P2 (lihat §14); URL-only tetap didukung.**

- URL gambar/logo tetap divalidasi `http/https` (sudah ada di console dan sanitizer).
- Tidak ada fetch aset server-side, jadi tidak ada SSRF baru.
- Implementasi:
  - Endpoint multipart admin + `TemplateImage` tenant-scoped.
  - Maksimum 5 MiB, MIME `image/png|jpeg|webp|gif`, tanpa SVG, dimensi maksimum 4000×4000.
  - Magic bytes dan dimensi divalidasi server; nama file di-generate server; URL publik
    unguessable UUID; `nosniff` + cache immutable.
  - Storage lokal (`TEMPLATE_IMAGE_DIR`) dengan volume Docker; URL publik memakai
    `TEMPLATE_IMAGE_BASE_URL` atau origin request.
- Batasan yang tersisa: belum ada EXIF stripping/optimasi/antivirus, belum ada delete/orphan
  cleanup, dan storage lokal belum cocok untuk multi-instance tanpa shared volume. Upload
  S3-compatible menunggu keputusan terpisah.
- Tanpa dependency runtime baru: `multer` sudah tersedia lewat `@nestjs/platform-express`;
  tidak memakai `sharp`.

---

### D7 — Retensi audit/test send/aset dan kebijakan delete

**Default: test send 180 hari; audit 730 hari (0 = nonaktif); aset tanpa auto-delete dan hanya
bisa dihapus manual jika usage=0 (P1).**

| Data | Kebijakan | Implementasi |
|---|---|---|
| `TemplateTestSend` | Hard delete setelah **180 hari** | Job cleanup batch 1.000; env `TEMPLATE_TEST_SEND_RETENTION_DAYS` (default 180, `0` menonaktifkan) |
| `TemplateAuditEvent` | Hard delete setelah **730 hari** | Job cleanup batch 1.000; env `TEMPLATE_AUDIT_RETENTION_DAYS` (default 730, `0` menonaktifkan) |
| Aset layout/theme/partial | Tidak ada auto-delete; P1 delete manual hanya jika tidak direferensikan | `usageCount` + `DELETE` 409 bila terpakai |
| Template | Tidak pernah hard delete; deaktivasi tetap `active=false` | Tidak berubah |

- **Mengapa hard delete, bukan soft delete**: soft delete tidak mereklaim storage dan
  memperumit query; data yang disimpan hanya metadata operasional (recipient masked/hash,
  error, actor), bukan body. Jika kebijakan tenant membutuhkan retensi lebih lama, set env
  yang lebih besar atau `0`.
- **Job**: tambah `runTemplateTelemetryCleanup` di `CleanupService`, cron `0 3 * * *` UTC
  (setelah retention 02:00 dan idempotency 02:30). Loop `findMany` id batch 1.000 → `deleteMany`
  `id in`, sampai habis; guard `running` seperti job lain.
- **Logging/metrik**: hanya jumlah baris terhapus, cutoff, dan jenis data. Tidak ada isi baris,
  recipient, atau error message di log. Metrik `template_telemetry_deleted_total{kind}`.
- **Index**: tambah `@@index([createdAt])` pada kedua tabel agar cleanup tidak full scan.
- **Peringatan operasional**: run pertama dapat menghapus data lama. Dokumentasikan untuk
  backup DB sebelum deploy pertama dan review jumlah yang akan terhapus (log job menghitung
  cutoff). Untuk deployment baru (data belum tua), dampaknya nol.
- **Rate limit test send** dihitung dari 24 jam terakhir, sehingga retensi 180 hari tidak
  memengaruhi rate limit.

---

### D8 — Two-column responsive

**Default: pertahankan tabel 50/50 + media query `.nh-col`; tambah warning validasi dan
dokumentasi batas client; tanpa CSS inliner/MJML.**

- Block `columns` tetap menghasilkan `<table role="presentation">` dengan dua `<td
  class="nh-col" width="50%">` dan inline style.
- Stacking mobile bergantung pada `<style>` di layout:
  `@media only screen and (max-width: 480px) { .nh-col { display:block !important; width:100% !important; ... } }`.
- **Warning baru** saat save/publish: jika `builderData` memakai `columns` dan layout `null`
  atau konten layout tidak mengandung `.nh-col` + media query, tambahkan warning
  `two_column_css_missing` dengan pesan yang menjelaskan cara memperbaiki (pilih layout preset
  atau tambahkan CSS). Ini warning, bukan error, agar template lama tetap bisa disimpan.
- **Batas client**: Gmail web/iOS, Apple Mail, Outlook.com umumnya mendukung media query;
  Outlook desktop mengabaikan media query sehingga dua kolom tetap berdampingan (lebar total
  600 px, tiap kolom ±284 px) — masih terbaca. Tidak ada jaminan pixel-perfect.
- **Tidak menambah** `juice`/MJML di P1. Jika nanti dibutuhkan, keputusan dependency terpisah.
- **Test**: assertion HTML bahwa output block memuat `role="presentation"`, dua `td.nh-col`,
  dan layout preset memuat media query; warning muncul untuk layout tanpa `.nh-col`.

---

### D9 — Approval maker-checker/diff

**Default: ditunda ke P2; tidak ada implementasi parsial di fase ini.**

- Alasan:
  - Hanya ada role `tenant_admin`; `platform_admin` ditolak. Maker-checker membutuhkan minimal
    dua role/permission dan kebijakan siapa yang boleh approve.
  - Perlu tabel approval, status review, notifikasi, dan UI antrian review.
  - Diff visual membutuhkan perbandingan HTML dua versi; diff teks sederhana bisa tanpa
    dependency, tetapi keputusan UI/UX dan audit-nya lebih baik satu paket dengan approval.
- **Yang sudah ada**: `TemplateAuditEvent` mencatat `actorAdminId`, `actorEmail`, aksi, versi,
  dan metadata; ini fondasi audit yang cukup untuk sekarang.
- **Sketsa P2 (jika disetujui)**:
  - `TemplateApproval` (tenantId, templateId, requestedBy, approvedBy, status, note, timestamps)
    dan role `template_reviewer`.
  - Publish draft berstatus `pending_approval` ditolak sampai ada approval; audit `submitted`,
    `approved`, `rejected`.
  - Diff: dua versi HTML disanitasi, ditampilkan side-by-side; bukan diff pixel. Tanpa
    Playwright.
- Tidak ada perubahan schema/API sekarang.

---

### D10 — Pencatatan template version per notifikasi

**Default: diimplementasikan pada P2 (lihat §13); tetap tanpa backfill.**

- Perilaku sekarang: template di-resolve saat worker memproses, bukan saat ingest. Job pending
  akan memakai versi published terbaru. Ini sudah didokumentasikan di desain template §D6.
- Kebutuhan nyata: audit “konten apa yang benar-benar dikirim” untuk komplain/regulasi, dan
  reproduksi saat investigasi.
- **Implementasi P2** (aditif):
  - `NotificationRecipient.templateId String?`, `templateVersion Int?`, `templateResolvedAt
    DateTime?`.
  - Worker email/in-app/WhatsApp mengisi setelah `resolve` (sebelum preferensi/render/send),
    hanya jika versi berubah atau belum tercatat.
  - Admin notification detail menampilkan versi; resend tetap memakai template aktif saat ini
    (batasan lama, terpisah).
  - Tanpa backfill; baris lama `null`. Index `[templateId]`.
- Alasan ditempatkan di P2: bukan bug keamanan/data; perubahan worker menyentuh tiga lane dan
  membutuhkan test regresi tambahan.

---

### D11 — Sanitizer dan keamanan

**Default: tetap sanitizer pola + iframe sandbox + CSP di P0/P1; tambah test corpus; parser
penuh/Playwright ditunda ke P2.**

- Pertahankan pertahanan berlapis yang sudah ada:
  - `validateEmailHtml` saat save/publish/preview (tag/atribut/URL/CSS).
  - `sanitizeEmailHtml` pada output runtime (data dinamis dari `{{{ }}}`).
  - Preview iframe `sandbox=""`, `referrerpolicy="no-referrer"`, CSP meta `script-src 'none'`.
  - Handlebars terisolasi, helper whitelist, akses properti prototipe dimatikan.
- **Test corpus baru** (P0): bypass umum — `<scr<script>ipt>`, event handler tanpa kutip,
  `&#106;avascript:`, `java\0script:`, `data:text/html`, `srcset`, `<svg/onload>`, `<math>`,
  `<form>`, `<base>`, meta refresh, CSS `expression`/`@import`/`-moz-binding`,
  `url(javascript:)`, komentar/conditional comment, tag malformed, uppercase/campuran.
  Test ini boleh mengungkap gap; perbaikan tetap dalam pendekatan pola (tanpa parser) selama
  memungkinkan.
- **Keterbatasan yang diakui**: regex bukan parser; mXSS/malformed markup bisa lolos pola.
  Sandbox/CSP adalah pertahanan utama untuk preview; email client adalah konteks eksekusi yang
  berbeda dan tidak mengeksekusi script.
- **P2**: evaluasi `sanitize-html`/`parse5` (server) atau DOMPurify+jsdom, dengan kriteria:
  ukuran dependency, lisensi, maintenance, performa render, dan kompatibilitas Node 24.
  Playwright hanya jika disetujui terpisah; tidak ada browser automation sekarang.

---

### D12 — Markdown in-app dan Meta WhatsApp

**Default: tetap ditunda; tidak ada perubahan di fase ini.**

- **Markdown in-app (selesai 2026-11-21):**
  - `TemplateFormat.markdown` diterima hanya untuk `inapp`; dirender server-side ke `bodyHtml`
    subset aman (tanpa dependency, escape-first), dan `body` tetap teks biasa untuk klien lama.
  - `@notifhub/js` `0.4.0` menambahkan tipe `bodyHtml`/`format`; `@notifhub/react` `0.3.0`
    menyediakan opt-in `renderBody="safe-html"`.
  - Detail keputusan, subset, dan verifikasi: `docs/design/templates/in-app-markdown-design.md`.
- **Meta approved WhatsApp**:
  - Provider masih `type: "text"`; belum ada template name, language, components, parameter,
    atau status approval.
  - Prasyarat: desain provider template Meta terpisah (model data + sinkronisasi approval +
    mapping parameter), bukan sekadar menambah field di template.
- Tidak ada schema/API/console yang diubah untuk dua item ini. Jangan memaksakan sekarang:
  keduanya terblokir oleh kontrak eksternal (SDK/provider), bukan oleh keputusan internal.

---

### D13 — Test, regresi, dan rollout

**Default: unit test baru + E2E E21–E26 + regresi penuh E1–E20; verifikasi UI manual; tanpa
Playwright.**

- **Unit** (Jest yang sudah ada; tambah `test/jest-unit.json` + script `test:unit`, tanpa
  dependency baru):
  - `template.builder.spec.ts`: schema valid/invalid, limit, normalisasi, URL, duplicate id,
    field tak dikenal, channel mismatch.
  - `template.text.spec.ts`: paragraf, link, image alt, list, entity, preheader skip,
    whitespace, batas panjang, fallback kosong.
  - `template.safety.spec.ts`: corpus bypass D11.
  - `cleanup.spec.ts`: cutoff, `0` menonaktifkan, batch, tidak menghapus baris baru.
  - `email.provider.spec.ts`: `sendMail` menerima `text` saat ada; tidak mengirim `text` saat
    null; mode development tidak membuka SMTP; log tidak memuat isi.
- **E2E baru** (detail §8.3):
  - E21 validasi `builderData` + limit + normalisasi.
  - E22 plain-text preview dan fallback.
  - E23 retensi audit/test send.
  - E24 warning dua kolom.
  - E25 baris legacy `builderData` invalid saat publish/clone.
  - E26 regresi `builderData` valid (memperluas E20) / tidak mengubah worker.
- **Regresi**: E1–E20 wajib lulus tanpa perubahan ekspektasi. Perubahan yang mungkin
  memengaruhi ekspektasi: preview email kini punya `text` (aditif), validasi draft dengan
  `builderData` invalid (tidak ada di E1–E20), dan retensi (data test lama). Jika ada test
  yang membuat `TemplateTestSend` berumur >180 hari, sesuaikan; saat ini tidak ada.
- **Console**: `npm run console:typecheck` + `npm run console:build`; checklist manual
  (plain-text tab, error 422, builder mode, DnD/undo P1, export P1, usage/delete P1) tanpa
  Playwright.
- **SDK/Go**: `npm run sdk:test`, `npm run sdk:typecheck`, `npm run sdk:go:test` — tidak ada
  perubahan yang diharapkan; jalankan sebagai regresi.
- **Rollout**: migrasi → backend → console; staging dulu; backup DB sebelum run cleanup pertama;
  monitor metrik validasi/plain-text/retensi. P1 dan P2 dibuka dengan persetujuan baru.

---

## 5. Perubahan schema, API, dan console

### 5.1 Schema

#### P0 — hanya index (aditif)

```prisma
model TemplateAuditEvent {
  // ... kolom existing ...
  @@index([createdAt])
}

model TemplateTestSend {
  // ... kolom existing ...
  @@index([createdAt])
}
```

Tidak ada kolom/tabel baru untuk `builderData` (kolom sudah ada) dan plain-text (dihitung saat
render). Tidak ada backfill.

#### P1 — tidak ada perubahan schema

Usage count dihitung dari relasi yang ada (`NotificationTemplate.layoutId/themeId`,
`TemplatePartialLink.partialId`). Delete aset yang tidak terpakai memakai hard delete; tidak
perlu `archivedAt`.

#### P2 — hanya jika disetujui

```prisma
// Jika D10 disetujui
model NotificationRecipient {
  // ...
  templateId         String?
  templateVersion    Int?
  templateResolvedAt DateTime? @db.Timestamptz
  @@index([templateId])
}
```

Upload gambar (D6) dan approval (D9) memerlukan tabel/kolom terpisah yang akan didesain di
fase masing-masing, bukan di dokumen ini.

### 5.2 API

#### P0

| Endpoint | Perubahan |
|---|---|
| `POST /admin/templates` | `builderData` divalidasi/normalisasi; invalid → 422; respons memuat `builderData` normalisasi |
| `PUT /admin/templates/:id` | Sama; termasuk jalur `updatePublishedViaNewVersion` |
| `POST /admin/templates/:id/publish` | Validasi ulang; legacy invalid → warning `builder_legacy_invalid`, tidak memblokir |
| `POST /admin/templates/:id/clone` | `builderData` invalid tidak disalin; warning + audit metadata |
| `POST /admin/templates/:id/rollback` | Sama |
| `POST /admin/templates/preview` | `text` diisi untuk email (sebelumnya `null`); tidak menerima `builderData` |
| `POST /admin/templates/:id/preview` | Sama |
| `POST /admin/templates/:id/test-send` | Internal memakai `rendered.text`; bentuk respons tidak berubah |
| `GET /admin/templates*` | Tidak berubah; `builderData` tetap dikembalikan apa adanya untuk legacy |

Kode issue validasi baru: `builder_unsupported_version`, `builder_too_large`,
`builder_too_many_blocks`, `builder_block_invalid`, `builder_unknown_block_type`,
`builder_unknown_field`, `builder_duplicate_id`, `builder_url_unsafe`,
`builder_channel_mismatch`, `builder_legacy_invalid` (warning), `two_column_css_missing`
(warning), `plain_text_empty` (warning internal, tidak selalu dikembalikan).

Envelope error tetap:
```json
{
  "message": ["builderData.blocks[0].type: ..."],
  "details": {
    "code": "template_validation_failed",
    "errors": [{ "code": "builder_unknown_block_type", "path": "builderData.blocks[0].type", "message": "...", "severity": "error" }]
  }
}
```

#### P1

| Endpoint | Perubahan |
|---|---|
| `GET /admin/template-assets/layouts|themes|partials` | Tambah `usageCount` (aditif) memakai `_count` relasi |
| `GET /admin/template-assets/.../:id` | Tambah `usageCount` |
| `DELETE /admin/template-assets/.../:id` | **Baru**; 204 jika usage=0; 409 `asset_in_use` + count jika terpakai; tenant-scoped; `404` untuk aset tenant lain |

Tidak ada endpoint baru untuk ekspor HTML (client-side download) dan DnD/undo (client-side).

#### P2

- Upload: `POST /admin/template-assets/images` (multipart) + metadata; belum dirancang detail.
- Approval: endpoint submit/approve/reject; belum dirancang detail.
- Version per notifikasi: field baru di respons detail notifikasi; belum dirancang detail.

### 5.3 Console

#### P0

- **Preview plain-text**: tab/segmen “Plain text” di `TemplatePreviewPane` untuk email;
  tampilkan `preview.text`; jika `null`, tampilkan pesan fallback “HTML-only”.
- **Builder error**: tampilkan `details.errors` 422; `parseBlockDocumentStrict` mencegah
  penyimpanan dokumen yang terpotong diam-diam.
- **Retensi**: catatan singkat di halaman riwayat bahwa test send disimpan 180 hari dan audit
  730 hari (dari konfigurasi; jika tidak tersedia, teks generik).
- Tidak ada perubahan layout/stack; tetap React 18/Vite/Bootstrap/TanStack/RHF+zod.

#### P1

- `EmailBlockBuilder`: DnD + undo/redo (tombol dan shortcut), announcement `aria-live`.
- Tombol ekspor/salin HTML.
- Warning `two_column_css_missing` ditampilkan di panel validasi.
- Halaman aset: badge `usageCount`; tombol Hapus disabled + tooltip bila >0; dialog konfirmasi;
  tampilkan error 409.
- Tidak perlu dependency baru.

#### P2

- Upload gambar (form + preview), approval queue/diff, versi template di detail notifikasi.
- Semua menunggu persetujuan fase masing-masing.

---

## 6. Migrasi dan backward compatibility

### 6.1 Urutan migrasi

1. **P0**: `prisma/migrations/<timestamp>_template_telemetry_indexes/migration.sql`
   - `CREATE INDEX "TemplateAuditEvent_createdAt_idx" ON "TemplateAuditEvent"("createdAt");`
   - `CREATE INDEX "TemplateTestSend_createdAt_idx" ON "TemplateTestSend"("createdAt");`
   - Tidak ada perubahan kolom/tabel/data.
2. **P1**: tidak ada migrasi schema.
3. **P2**: migrasi terpisah per fitur, hanya setelah persetujuan.

### 6.2 Perubahan env

| Env | Default | Catatan |
|---|---|---|
| `TEMPLATE_TEST_SEND_RETENTION_DAYS` | `180` | `0` menonaktifkan; integer non-negatif |
| `TEMPLATE_AUDIT_RETENTION_DAYS` | `730` | `0` menonaktifkan; integer non-negatif |

- Tambah helper `nonNegativeInt` di `src/config/env.schema.ts`; nilai invalid gagal fast seperti
  env lain.
- Env baru memiliki default sehingga deployment lama tidak perlu mengubah `.env`.
- Kode lama yang berjalan di schema baru mengabaikan index dan env baru; rollback kode aman.

### 6.3 Matriks kompatibilitas

| Kombinasi | Perilaku |
|---|---|
| Backend baru + DB baru | Semua fitur P0 aktif |
| Backend lama + DB baru (setelah migrasi) | Index diabaikan; cleanup tidak berjalan; plain-text tidak ada; builderData tidak divalidasi. Tidak ada kerusakan. |
| Backend baru + console lama | Console lama tidak mengirim `builderData` invalid; plain-text tetap digenerate di server; UI belum menampilkan tab teks. |
| Backend lama + console baru | Console baru menampilkan `text: null` sebagai HTML-only; validasi builder tidak tersedia di server, tetapi console tidak mengirim data invalid. |
| SDK terbit 0.3.0/0.2.0 | Tidak berubah; tidak ada API yang dihapus/diubah bentuknya. |

### 6.4 Data legacy

- `builderData` invalid yang sudah ada: tidak dimigrasikan/dihapus; publish hanya warning;
  clone/rollback tidak menyalin; save berikutnya harus memperbaiki.
- Template email lama tanpa plain-text: otomatis mendapat plain-text saat render; jika
  generator kosong, HTML-only.
- Test send/audit lama: tunduk pada cutoff retensi saat job pertama berjalan. Backup DB
  sebelum deploy pertama; dokumentasikan bahwa data lama dapat terhapus.
- Tidak ada perubahan pada `Notification`, `NotificationRecipient`, `DeliveryAttempt`,
  `DeliveryEvent`, `BillingEvent` di P0/P1.

### 6.5 Rollback

- P0: rollback kode cukup; index boleh tetap ada. Tidak ada data yang diubah kecuali baris
  yang dihapus cleanup (tidak bisa dikembalikan tanpa backup).
- P1: rollback kode; tidak ada schema/data.
- P2: setiap migrasi harus punya rencana rollback sendiri; tidak digabung dengan P0/P1.

---

## 7. Rencana keamanan dan sanitasi

1. **`builderData` adalah input tidak tepercaya.** Validasi schema, limit, URL allowlist, dan
   penolakan field tak dikenal. Data tidak pernah dieksekusi server; console merender dengan
   `escapeHtml` dan preview memakai sandbox.
2. **URL**: hanya `http`/`https` atau token `{{...}}` persis untuk image/button; tidak ada
   `javascript:`, `data:`, `file:`, atau protokol relatif. Decode entitas sebelum pemeriksaan
   (mengikuti `isDangerousUrl`).
3. **Plain-text**: dibuat dari HTML yang sudah disanitasi; tidak memanggil Handlebars lagi,
   tidak mengakses jaringan, tidak mengeksekusi HTML. Output tidak di-log.
4. **Sanitizer**: pola + sandbox + CSP tetap dipertahankan; corpus bypass ditambah. Keterbatasan
   regex didokumentasikan; parser penuh menunggu P2.
5. **Retensi**: job hanya menghapus berdasarkan `createdAt`; log hanya count/cutoff/kind; tidak
   ada body, recipient, atau error message. Backup sebelum run pertama.
6. **Aset**: delete tenant-scoped; cek usage; `409` bila terpakai; `404` untuk aset tenant lain
   (tidak membocorkan keberadaan). FK restrict menjadi pertahanan terakhir.
7. **Tenant isolation**: semua query template/aset/test send memakai `tenantId` dari JWT;
   `builderData` tidak menerima `tenantId` dari body. E2E isolasi tenant diperluas untuk delete
   aset.
8. **Tidak ada secret** di kode/log/bundle; plain-text dan builderData tidak masuk log.
9. **DoS**: batas 64 KiB/200 block/10k char; parser admin tetap 1 MiB; tidak ada algoritma
   eksponensial di validator/generator.

---

## 8. Rencana test, verifikasi, dan regresi

### 8.1 Unit test (baru, tanpa dependency)

- `test/template.builder.unit-spec.ts`
- `test/template.text.unit-spec.ts`
- `test/template.safety.unit-spec.ts`
- `test/cleanup.unit-spec.ts`
- `test/email.provider.unit-spec.ts`

Konfigurasi: `test/jest-unit.json` (rootDir `..`, `testRegex: "test/.*\\.unit-spec\\.ts$"`,
ts-jest, testEnvironment node) + script `"test:unit": "jest --config test/jest-unit.json"`.
Tidak menambah package; Jest/ts-jest sudah ada.

### 8.2 Unit assertions utama

| Modul | Assertion |
|---|---|
| Builder | version salah, 201 block, >64 KiB, duplicate id, unknown type/field, URL unsafe, channel non-email, normalisasi default, JSON valid disimpan apa adanya secara struktur |
| Text | `p`/`br`/list/link/image/entity/whitespace/preheader skip; output kosong → `null`; batas 100k; tidak ada tag HTML tersisa |
| Safety | corpus bypass D11; `sanitizeEmailHtml` menghapus script/event/URL berbahaya; `validateEmailHtml` memberi issue |
| Cleanup | cutoff tepat; `0` tidak menghapus; batch loop; baris baru tidak tersentuh; hanya count yang di-log |
| Provider | `text` diteruskan ke `sendMail`; `null` tidak mengirim `text`; development log-only; `text` tidak ada di log |

### 8.3 E2E baru (E21–E26)

| Test | Skenario | Ekspektasi |
|---|---|---|
| **E21** | `builderData` valid + invalid (version salah, unknown type, duplicate id, >200 block, >64 KiB, non-email) | valid 201 dan tersimpan normalisasi; invalid 422 dengan `details.errors` code yang tepat; tidak ada row baru untuk invalid |
| **E22** | Preview email dengan body + link + gambar; test send dev | `preview.text` memuat teks/link/alt dan tidak memuat `<p>`; test send tetap `simulated`; provider unit test memastikan `text` dikirim |
| **E23** | Seed `TemplateAuditEvent`/`TemplateTestSend` lama (mis. 800/200 hari) + baru; panggil cleanup | baris lama terhapus, baris baru tetap; count sesuai; log hanya count |
| **E24** | Draft dengan `builderData` `columns` + layout tanpa `.nh-col`, lalu layout dengan `.nh-col` | warning `two_column_css_missing` muncul/hilang; publish tidak terblokir |
| **E25** | Insert langsung baris legacy `builderData` invalid; publish + clone | publish 200 dengan warning `builder_legacy_invalid`; clone menyimpan `builderData=null` + warning; worker tetap mengirim body |
| **E26** | Regresi E20 diperluas: builderData valid tetap tersimpan/diclone; tidak memengaruhi `body`/worker | perilaku E20 tetap; tidak ada perubahan status kirim |

Catatan implementasi test:
- Gunakan key/tenant unik dan bersihkan row test setelah selesai agar tidak mengganggu E1–E20.
- E23 memanggil method cleanup langsung (bukan menunggu cron) dan memakai cutoff default;
  bila perlu, test membuat row dengan `createdAt` eksplisit.
- E25 menyisipkan row lewat Prisma (bukan API) untuk mensimulasikan data legacy.

### 8.4 Regresi wajib

- `npm run test:e2e -- --runInBand`: E1–E26 lulus; E1–E20 tidak berubah.
- `npm run typecheck && npm run build`.
- `npm run console:typecheck && npm run console:build`.
- `npm run sdk:test && npm run sdk:typecheck && npm run sdk:go:test` (regresi; tidak ada
  perubahan yang diharapkan).
- `npx prisma migrate status` bersih.

### 8.5 Verifikasi UI manual (tanpa Playwright)

- Buka template email, cek tab **Plain text** menampilkan hasil dan tombol salin.
- Simpan draft dengan `builderData` valid; cek tidak ada error.
- Kirim payload invalid lewat curl/Postman; cek pesan 422 jelas dan editor tidak menyimpan.
- Publish template legacy invalid; cek warning muncul, publish berhasil.
- Set layout tanpa `.nh-col`; cek warning dua kolom.
- P1: DnD dengan mouse, tombol naik/turun dengan keyboard, undo/redo, fokus/announcement,
  ekspor HTML, usage/delete aset (termasuk 409).
- Cek preview iframe tetap `sandbox=""`; tidak ada console error.

### 8.6 Metrik/monitoring

- `template_validation_errors_total{code}` (baru atau perluas yang ada).
- `template_plain_text_total{result="generated|empty|error"}`.
- `template_telemetry_deleted_total{kind="audit|test_send"}`.
- Log terstruktur: `template.builder.invalid`, `template.plain_text.empty`,
  `template.telemetry.cleanup` (count saja).

---

## 9. Risiko dan hal yang sengaja ditunda

### 9.1 Risiko

| Risiko | Mitigasi |
|---|---|
| Validasi builder terlalu ketat memblokir draft yang sah | Limit/field mengikuti output console; error menyebut path; legacy publish hanya warning; uji dengan E20 dan UI |
| Plain-text jelek/duplikat (preheader) | Unit corpus, preview, fallback HTML-only, `data-nh-text-skip` pada preset; layout kustom didokumentasikan |
| Retensi menghapus bukti yang dibutuhkan | Default konservatif (180/730), `0` menonaktifkan, backup sebelum run pertama, log count, kebijakan terdokumentasi |
| Delete aset memutus template | Usage count + FK + 409; hanya aset tak terpakai yang bisa dihapus; tidak ada soft delete |
| DnD tidak aksesibel/tidak jalan di mobile | Tombol naik/turun tetap; keyboard; `aria-live`; DnD hanya enhancement |
| Dua kolom tidak menumpuk di Outlook desktop | Diterima sebagai batas client; lebar kolom tetap terbaca; warning untuk layout kustom |
| Sanitizer pola bisa dilewati | Sandbox/CSP sebagai pertahanan utama; corpus test; parser penuh ditunda dengan kriteria |
| Scope creep ke P2 | Gate persetujuan per fase; P0 tidak menyentuh storage/RBAC/provider |
| Kebocoran lintas tenant pada delete/usage | Semua query `tenantId`; E2E tenant isolation; `404` bukan `403` |
| Bundle console membengkak | P1 hanya komponen kecil; cek warning `console:build` |

### 9.2 Sengaja ditunda

| Item | Alasan | Prasyarat/keputusan |
|---|---|---|
| Impor HTML → Visual | Subset kecil selesai 2026-11-22 (console, tanpa dependency); impor arbitrer tetap butuh parser | Desain lanjutan bila impor arbitrer dibutuhkan |
| Upload gambar | Storage/MIME/keamanan | P2 + desain storage |
| Approval maker-checker/diff | RBAC belum ada | P2 + role/permission |
| Versi template per notifikasi | Perubahan tiga worker + schema | P2 + persetujuan |
| Markdown in-app | Selesai (backend subset aman + SDK/React terbit) | Tidak ada; lihat `docs/design/templates/in-app-markdown-design.md` |
| Meta approved WhatsApp | Provider text-only | Desain provider Meta terpisah |
| Parser sanitizer penuh | Dependency/keamanan | P2 + evaluasi lisensi/ukuran |
| Playwright/browser automation | Batasan eksplisit | Persetujuan terpisah |
| MJML/juice/CodeMirror | Dependency berat | Keputusan rilis terpisah |
| Template import/export penuh, scheduling, A/B, analytics | Di luar cakupan | Roadmap produk berikutnya |

---

## 10. Definition of done dan persetujuan

### 10.1 DoD P0

1. Migrasi index diterapkan dan `migrate status` bersih.
2. `builderData` divalidasi + dinormalisasi di create/update/publish/clone/rollback; limit
   ditegakkan; error 422 jelas; legacy warning.
3. Plain-text digenerate untuk email, dikirim provider bila ada, fallback HTML-only bila
   kosong/gagal; preview menampilkannya.
4. Cleanup retensi audit/test send berjalan (batch, env, log/metrik) dan index tersedia.
5. Unit test baru + E21–E26 lulus; E1–E20 lulus; typecheck/build backend & console lulus.
6. Tidak ada dependency baru; `@notifhub/js` 0.3.0, `@notifhub/react` 0.2.0, Go module path,
   tiga lane auth, dan stack console tidak berubah. Versi root/console hanya berubah bila ada
   keputusan rilis terpisah.
7. Dokumentasi diperbarui (`project-brief` batasan, dokumen desain terkait, README bila perlu).

### 10.2 Keputusan yang disetujui untuk P0

- **D2**: limit 200 block / 64 KiB / field limit, dan penolakan tulis invalid (termasuk draft).
- **D4**: ekspor HTML saja; impor HTML ditolak sampai P2.
- **D5**: plain-text generated-only, tanpa field manual.
- **D7**: retensi 180 hari (test send) dan 730 hari (audit), `0` menonaktifkan; aset dihapus
  manual hanya jika usage=0.
- **D8**: warning dua kolom, bukan error; tanpa CSS inliner.
- **D3**: native DnD + tombol, tanpa dependency.
- **D13**: E21–E26 dan regresi E1–E20.

Implementasi P0 dimulai setelah persetujuan pengguna. P1/P2 tetap menunggu persetujuan fase
berikutnya; tidak ada dependency baru yang ditambahkan untuk P0.

---

## 11. Implementasi dan verifikasi P0

Status: **terimplementasi dan terverifikasi** pada 2026-11-16.

### 11.1 Perubahan yang diterapkan

| Area | Perubahan |
|---|---|
| `builderData` | Modul `src/templates/template.builder.ts`; validasi + normalisasi di create/update/publish/clone/rollback; limit 200 block/64 KiB; legacy invalid hanya warning; clone/rollback tidak menyalin data invalid |
| Plain-text | `src/templates/template.text.ts`; `RenderedTemplate.text`; `ProviderSendInput.text` opsional; `EmailProvider` mengirim `text` bila ada; worker email dan test send meneruskan; preview email mengisi `text`; console menampilkan tab **Plain text** |
| Retensi | `CleanupService.runTemplateTelemetryCleanup` (03:00 UTC); env `TEMPLATE_TEST_SEND_RETENTION_DAYS` (180) dan `TEMPLATE_AUDIT_RETENTION_DAYS` (730), `0` menonaktifkan; index `createdAt` |
| Dua kolom | Warning `two_column_css_missing` bila block `columns` dipakai tanpa layout yang mendukung `.nh-col` |
| Test | Unit test baru (`test/*.unit-spec.ts`, `npm run test:unit`); E2E E21–E26 |
| Console | Tab **Plain text**; parser block strict agar `builderData` invalid dibuka di mode HTML dengan warning, bukan dipotong diam-diam |

Migration: `20261116074659_template_telemetry_indexes` (dua index baru; Prisma juga melakukan
`RENAME INDEX` pada index `NotificationTemplate` yang sudah ada untuk normalisasi nama — metadata
saja, tanpa perubahan data).

### 11.2 Bukti verifikasi

- `npm run test:unit`: **16/16** lulus (4 suite).
- `npm run test:e2e -- --runInBand`: **26/26** lulus; E1–E20 tidak berubah, E21–E26 baru lulus.
- `npm run typecheck`, `npm run build`: lulus.
- `npm run console:typecheck`, `npm run console:build`: lulus; bundle 982,54 KB / 286,01 KB gzip
  (naik ±2,5 KB dari sebelumnya).
- `npx prisma migrate status`: database development dan test menerapkan 8 migrasi.
- Tidak ada dependency baru; `@notifhub/js` 0.3.0 dan `@notifhub/react` 0.2.0 tidak berubah.

### 11.3 Deviasi dan catatan

- `npx prisma generate` sempat gagal mengganti DLL engine saat dev watcher berjalan; setelah
  watcher dihentikan, generate berhasil dan client baru dipakai untuk P2. P0 sendiri tidak
  menambah model/field.
- Preview/test send tetap memakai UI manual; tidak ada Playwright.
- Warning dua kolom adalah warning, bukan error; layout kustom tanpa `.nh-col` tetap dapat
  disimpan/dipublish.
- Server memvalidasi struktur `builderData` tetapi tidak merender ulang block menjadi `body`;
  console tetap sumber render HTML block, dan `body` tetap sumber kebenaran worker. Drift antara
  `builderData` dan `body` dari klien API non-console tidak dideteksi pada P0.
- Retensi bersifat hard delete dan tidak dapat dibatalkan tanpa backup; default 180/730 dipilih
  agar data baru tidak terhapus pada deployment pertama.

### 11.4 Berikutnya

P1 sudah diimplementasikan (lihat §12). P2 (impor HTML, upload, approval/diff, versi template per
notifikasi, Meta WhatsApp, parser sanitizer/Playwright) belum dimulai dan memerlukan
persetujuan fase masing-masing. Markdown in-app selesai 2026-11-21.

---

## 12. Implementasi dan verifikasi P1

Status: **terimplementasi dan terverifikasi** pada 2026-11-16.

### 12.1 Perubahan yang diterapkan

| Area | Perubahan |
|---|---|
| Drag-and-drop | Handle `⋮⋮` native HTML5; drop target per card; tombol naik/turun tetap menjadi jalur keyboard/screen reader; pengumuman `aria-live`; tanpa dependency |
| Undo/redo | Riwayat lokal 50 langkah di `EmailBlockBuilder`; coalesce perubahan teks 500 ms; tombol Undo/Redo dan shortcut `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`/`Ctrl+Y`; reset saat template dimuat/disimpan |
| Ekspor HTML | Tombol **Unduh HTML** dan **Salin HTML** di tab Konten untuk email; memakai `body` efektif (hasil builder di mode Visual) |
| Aset | `usageCount` pada list/detail layout/theme/partial; endpoint `DELETE` baru; `409 asset_in_use` bila masih direferensikan; `404` untuk aset tenant lain; hard delete hanya aset tak terpakai |
| Console aset | Kolom **Dipakai**, badge jumlah, tombol Hapus (disabled bila >0), konfirmasi, dan invalidasi query |
| Two-column | P1 tidak menambah dependency; warning + E25 dari P0 tetap berlaku |

### 12.2 Bukti verifikasi

- `npm run test:unit`: **19/19** lulus (5 suite; termasuk `moveBlock`/parser console).
- `npm run test:e2e -- --runInBand`: **27/27** lulus; E1–E26 regresi, E27 baru untuk usage/delete
  aset dan isolasi tenant.
- `npm run ci`: **6/6 langkah** lulus (typecheck, build, unit, e2e, migrate status).
- `npm run console:typecheck`, `npm run console:build`: lulus; bundle 987,80 KB / 287,59 KB gzip.
- Tidak ada dependency baru; `@notifhub/js` 0.3.0, `@notifhub/react` 0.2.0, Go module path, tiga
  lane auth, dan stack console tidak berubah.

### 12.3 Deviasi dan catatan

- Drag-and-drop native hanya nyaman dengan mouse; perangkat sentuh memakai tombol naik/turun.
  Tidak ada library DnD.
- Ekspor mengunduh/menyalin **body** HTML, bukan dokumen layout lengkap; layout tetap dilihat
  lewat preview server-side.
- Impor HTML ke Visual tetap **ditolak**; hanya ekspor yang tersedia di P1.
- `usageCount` menghitung semua baris template/partial yang mereferensikan aset, termasuk draft
  dan versi lama. Ini sengaja: penghapusan aset tidak boleh memutus reproducibility template
  published.
- Penghapusan aset bersifat hard delete hanya untuk aset dengan usage 0; tidak ada soft delete.

### 12.4 Berikutnya

Slice P2 D10 sudah diimplementasikan (lihat §13). Item P2 lain (impor HTML, upload gambar,
approval maker-checker/diff, Meta WhatsApp, parser sanitizer penuh/Playwright)
belum dimulai dan memerlukan persetujuan fase masing-masing. Markdown in-app selesai
2026-11-21 (dokumen terpisah).

---

## 13. Implementasi dan verifikasi P2 (D10)

Status: **terimplementasi dan terverifikasi** pada 2026-11-16.

### 13.1 Perubahan yang diterapkan

| Area | Perubahan |
|---|---|
| Schema | `NotificationRecipient.templateId`, `templateVersion`, `templateResolvedAt` (nullable, aditif); index `templateId`; migrasi `20261116180000_recipient_template_tracking` |
| Worker | Email, in-app, dan WhatsApp mencatat template yang benar-benar di-resolve setelah `resolve`, sebelum preferensi/render/send; hanya update jika versi berubah atau belum tercatat |
| Admin API | Detail notifikasi mengembalikan `templateId`, `templateVersion`, `templateResolvedAt` per recipient |
| Console | Kolom **Template** di tabel recipient, menampilkan versi dan tautan ke editor template; baris lama menampilkan `—` |
| Kompatibilitas | Tanpa backfill; data lama tetap `null`; worker/consumer tidak berubah; resend tetap memakai template aktif saat ini |

### 13.2 Bukti verifikasi

- `npm run test:e2e -- --runInBand`: **28/28** lulus; E28 baru memverifikasi versi 1 → publish
  versi 2 → recipient baru memakai versi 2, sementara recipient lama tetap tercatat versi 1.
- `npm run test:unit`: **19/19** lulus.
- `npm run ci`: **6/6 langkah** lulus.
- `npm run console:typecheck`, `npm run console:build`: lulus; bundle 988,04 KB / 287,64 KB gzip.
- Migrasi diuji pada database **fresh**: 8/8 migrasi apply berurutan tanpa error.
- `npx prisma migrate status`: 8 migrasi, dev dan test up to date.

### 13.3 Perbaikan urutan migrasi

Migrasi telemetry P0 semula dibuat dengan timestamp `20261116074659`, lebih kecil dari migrasi
template system `20261116150000`. Akibatnya database fresh gagal apply karena
`TemplateAuditEvent` belum ada. Migrasi di-rename menjadi
`20261116170000_template_telemetry_indexes`, riwayat `_prisma_migrations` di dev/test diperbaiki,
dan urutan diverifikasi pada database fresh. Ini penting untuk deployment/CI baru.

### 13.4 Deviasi dan catatan

- Pencatatan dilakukan setelah `resolve` dan sebelum preferensi/send, sehingga recipient yang
  kemudian di-skip karena preferensi tetap memiliki jejak template. Ini bukan transaksi yang sama
  dengan `recordSuccess`/`recordFailure`.
- Jika template tidak ditemukan, metadata tetap `null`; job gagal seperti sebelumnya.
- Kolom `templateId` sengaja tanpa foreign key: versi template tidak boleh terhapus/hilang dari
  histori delivery.
- Item P2 lain (impor HTML, approval/diff, Meta WhatsApp, parser sanitizer penuh/Playwright)
  tetap ditunda karena membutuhkan RBAC, parser dependency, rilis SDK, atau perubahan provider
  WhatsApp. Markdown in-app dan upload gambar diimplementasikan terpisah (§14 dan
  `docs/design/templates/in-app-markdown-design.md`).

---

## 14. Implementasi dan verifikasi P2 (upload gambar)

Status: **terimplementasi dan terverifikasi** pada 2026-11-16.

### 14.1 Perubahan yang diterapkan

| Area | Perubahan |
|---|---|
| Schema | Model `TemplateImage` (tenantId, mimeType, size, width, height, storageKey, checksum, createdByAdminId); migrasi `20261116190000_template_images` |
| API admin | `POST /admin/template-assets/images` multipart field `file`; `GET` daftar gambar tenant |
| API publik | `GET /api/v1/template-images/:id` tanpa auth; UUID, `Content-Type` dari metadata, `nosniff`, cache immutable |
| Validasi | Magic bytes PNG/JPEG/WebP/GIF, dimensi maksimum 4000×4000, maksimum 5 MiB (env), SVG/teks ditolak |
| Storage | `TEMPLATE_IMAGE_DIR` (default `var/template-images`), nama file UUID, checksum SHA-256; volume Docker `notifhub_prod_uploads` |
| Console | Komponen unggah bersama dipakai di block `image`, logo layout, dan logo partial; URL hasil langsung mengisi field terkait; URL manual tetap didukung |
| Konfigurasi | `TEMPLATE_IMAGE_DIR`, `TEMPLATE_IMAGE_MAX_BYTES`, `TEMPLATE_IMAGE_BASE_URL` |
| Bugfix | `HttpExceptionFilter` mempertahankan `details` untuk 413 dari `PayloadTooLargeException` |

### 14.2 Bukti verifikasi

- `npm run test:unit`: **22/22** lulus (6 suite; termasuk deteksi PNG/GIF dan penolakan SVG).
- `npm run test:e2e -- --runInBand`: **29/29** lulus; E29 menguji upload PNG, serving publik,
  penolakan file menyamar, 413 oversize, dan file hilang.
- `npm run ci`: **6/6 langkah** lulus.
- `npm run console:typecheck`, `npm run console:build`: lulus; bundle 989,69 KB / 288,22 KB gzip.
- Migrasi database fresh: **9/9** apply berurutan.
- `npx prisma migrate status`: 9 migrasi, dev dan test up to date.

### 14.3 Deviasi dan catatan

- Storage lokal single-node; multi-instance membutuhkan shared volume atau object storage
  (belum diputuskan).
- Gambar disajikan publik dengan UUID unguessable, tanpa signed URL; ini kebutuhan email client.
  Tidak ada data tenant lain yang dapat di-list lewat endpoint admin.
- Belum ada EXIF stripping, re-encode/optimasi, antivirus, atau orphan cleanup. File yang
  dihapus manual dari disk akan menghasilkan 404 dan log error.
- `TEMPLATE_IMAGE_BASE_URL` perlu diisi di belakang reverse proxy agar URL absolut di email
  benar; tanpa itu dipakai origin request.
- URL-only tetap didukung; template yang sudah ada tidak berubah.
- Upload logo pada layout/partial memakai komponen yang sama dengan block image; nilai yang
  dihasilkan adalah URL publik yang disimpan di field `logoUrl` aset.

### 14.4 Berikutnya

Impor HTML ke Visual (subset kecil) **selesai dan terverifikasi 2026-11-22**; lihat
`docs/design/templates/html-import-design.md`. Impor hanya memetakan heading, paragraf, gambar,
tombol, dan divider; CSS, layout, dua kolom, dan list tidak diimpor, dan Handlebars blok/partial
ditolak.

Approval maker-checker/diff tetap menjadi item berikutnya. Item P2 lain (Meta WhatsApp, parser
sanitizer penuh/Playwright) tetap menunggu keputusan fase; markdown in-app sudah selesai 2026-11-21.
