# Desain custom block builder email

Status: **terimplementasi dan terverifikasi** pada 2026-11-16. Lihat §7.

Basis: `docs/template-system-design.md`, `docs/email-authoring-ui-design.md`, dan keputusan untuk
tidak memakai GrapesJS pada tahap ini.

---

## 1. Masalah

Form theme/layout/partial sudah menghilangkan kebutuhan JSON/HTML untuk aset. Namun body email
masih berupa HTML/Handlebars mentah. User non-teknis belum punya cara menyusun body dari komponen
seperti heading, paragraf, gambar, tombol, divider, spacer, atau dua kolom.

## 2. Keputusan

| # | Keputusan | Default |
|---|---|---|
| D1 | Pendekatan | Custom block builder ringan di React/Bootstrap, bukan GrapesJS. Block menghasilkan HTML email table-based secara internal. |
| D2 | Cakupan | Block builder mengedit **body email** saja. Layout/theme/partial tetap memakai sistem yang ada. |
| D3 | Block MVP | Heading, text, image, button, divider, spacer, two-column text. Reorder via tombol naik/turun; belum drag-and-drop. |
| D4 | Penyimpanan | Simpan `builderData` JSON di samping `body` HTML. Worker tetap memakai `body`; builderData hanya untuk round-trip editing. |
| D5 | Schema/API | Kolom nullable `NotificationTemplate.builderData`; field opsional di create/update; disalin pada clone/rollback/legacy version. Tidak ada endpoint baru. |
| D6 | Handlebars | Text/label boleh memuat `{{var}}`; variable picker menyisipkan token dari schema. Loop/conditional tetap lewat mode HTML advanced. |
| D7 | Keamanan | Text di-escape, URL hanya http/https atau token Handlebars, preview iframe sandbox, validasi publish server tetap berlaku. |
| D8 | Kompatibilitas | Template lama tanpa builderData tetap memakai code editor. Template dengan builderData dibuka dalam mode visual; ganti ke HTML memerlukan konfirmasi. |
| D9 | Verifikasi | Typecheck/build console, validasi HTML block dengan `validateEmailHtml`, E2E create/update builderData, regresi E1–E19. |

## 3. Model data

`builderData`:

```json
{
  "version": 1,
  "blocks": [
    { "id": "b1", "type": "heading", "text": "Halo {{nama}}", "level": 1 },
    { "id": "b2", "type": "text", "text": "Pesanan Anda sudah dikirim." },
    { "id": "b3", "type": "button", "label": "Lacak pesanan", "url": "https://example.com", "align": "left" }
  ]
}
```

Body HTML dihasilkan dari block dan disimpan seperti biasa. `builderData` tidak dibaca worker.

## 4. UX

- Tab Content memiliki toggle **Visual** / **HTML**.
- Visual: palette block, daftar block, editor properti per block, tombol naik/turun/duplikat/hapus,
  variable picker, dan preview email yang sudah ada.
- HTML: textarea lama; jika beralih dari visual ke HTML, body hasil generate tetap ada dan
  builderData akan dihapus saat disimpan (dengan konfirmasi).
- Template baru default Visual dengan starter block. Template lama tanpa builderData default HTML.

## 5. Keamanan

- Semua text/label di-escape; newline menjadi `<br>`.
- URL gambar/button hanya http/https atau token `{{...}}`.
- Preview memakai iframe `sandbox=""`.
- HTML hasil builder wajib lolos `validateEmailHtml` saat publish; tidak ada script/event handler.

## 6. Batasan

- Drag-and-drop/undo-redo tersedia (P1), tetapi belum ada layer panel.
- Loop/conditional Handlebars tidak direpresentasikan secara visual.
- Two-column memakai tabel 50/50; stacking mobile bergantung pada `<style>` layout/theme dan
  divalidasi sebagai warning bila layout tidak mendukung `.nh-col`.
- Belum ada upload gambar; memakai URL.
- Belum ada impor HTML ke Visual; ekspor HTML tersedia.
- Builder tidak menggantikan mode HTML advanced.

## 7. Implementasi dan verifikasi

- Migrasi `20261116160000_template_builder_data` menambah `NotificationTemplate.builderData`
  (`JSONB`, nullable); create/update/clone/rollback/legacy version menyalin field ini. Worker tetap
  memakai `body`.
- Console: toggle **Visual/HTML** di tab Konten. Visual memakai `EmailBlockBuilder` dengan block
  heading, text, image, button, divider, spacer, dan dua kolom; reorder/duplikat/hapus; variable
  picker; preview email memakai pipeline preview server-side yang sudah ada.
- Template baru default Visual dengan starter block. Template lama tanpa `builderData` default
  HTML; beralih ke visual meminta konfirmasi karena HTML lama tidak diimpor otomatis. Beralih ke
  HTML mempertahankan body hasil builder dan menghapus `builderData` saat disimpan.
- Semua text/label block di-escape; URL hanya http/https atau token Handlebars; preview iframe
  `sandbox=""`; validasi publish server tetap berlaku.
- Roadmap P0 (2026-11-16) menambahkan validasi `builderData` di backend (schema v1, maksimum 200
  block/64 KiB) dan warning dua kolom bila layout tidak mendukung `.nh-col`; lihat
  `docs/template-limitations-roadmap.md`. Plain-text email kini digenerate otomatis oleh backend.
- Roadmap P1 (2026-11-16) menambahkan drag-and-drop native (handle `⋮⋮`), undo/redo 50 langkah
  dengan coalesce 500 ms, tombol Undo/Redo + shortcut, serta ekspor/salin HTML body. Tidak ada
  dependency baru; tombol naik/turun tetap menjadi jalur aksesibel.
- Tidak ada dependency baru.

Verifikasi:

- `npm run typecheck`, `npm run console:typecheck`, `npm run console:build`: lulus.
- `npm run test:e2e -- --runInBand`: **20/20** lulus; E20 memverifikasi builderData tersimpan,
  diperbarui, dipublish, dan diclone.
- HTML dari seluruh block (8 block, table dua kolom) divalidasi dengan `validateEmailHtml`:
  0 issue; round-trip `parseBlockDocument` mengembalikan 8 block; tidak ada `<script>`.
- Bundle console 980 KB / 285 KB gzip (naik ±13 KB dari editor aset).
