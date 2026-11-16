# Desain UI authoring template: form theme dan galeri layout

Status: **terimplementasi dan terverifikasi** pada 2026-11-16. Lihat §6.
Basis: `docs/template-system-design.md` §18, console template v2, dan keputusan untuk tidak memakai
GrapesJS pada tahap ini.

---

## 1. Masalah

Admin non-teknis masih harus:

- menulis **JSON token** saat membuat theme;
- menulis **HTML** saat membuat layout/partial;
- memahami struktur token `theme.brand.primary`, `{{{body}}}`, dan partial Handlebars.

GrapesJS tidak dipilih karena overkill: builder halaman umum, risiko kualitas email, ukuran bundle,
dan permukaan keamanan. Masalah utama sebenarnya adalah **UI terstruktur untuk aset yang sudah
punya model data jelas**.

## 2. Keputusan

| # | Keputusan | Default |
|---|---|---|
| D1 | Pendekatan | Form-based theme editor + galeri layout/partial. Tanpa GrapesJS dan tanpa dependency baru. |
| D2 | Theme | Form warna, font, ukuran, radius, dan button; token JSON tetap sumber data. Advanced JSON tetap tersedia. |
| D3 | Layout | Galeri preset (transaksional, promo, notifikasi) + parameter logo/brand/footer; HTML dihasilkan internal. Advanced HTML tetap tersedia. |
| D4 | Partial | Form header/footer/CTA/signature; HTML dihasilkan internal. Advanced HTML tetap tersedia. |
| D5 | Data model | Tidak ada perubahan schema/API. Theme tetap `tokens` JSON; layout/partial tetap `content` HTML; versi baru dibuat lewat endpoint yang ada. |
| D6 | Preview | Preview lokal di iframe `sandbox=""` untuk aset yang belum disimpan; preview email final tetap memakai server-side preview. |
| D7 | Backward compatibility | Aset lama tetap bisa dimuat ke mode advanced; template published tidak berubah. |
| D8 | Verifikasi | Typecheck/build console, route smoke, preview aset, dan regresi E1–E19 (backend tidak berubah). |

## 3. UX

- Tab **Theme**: color picker + input teks untuk token utama, select font, ukuran, radius, dan
  tombol; preview kartu email langsung; toggle **Advanced JSON**.
- Tab **Layout**: kartu preset; field logo URL, nama brand, teks footer, URL unsubscribe; preview
  penuh; toggle **Advanced HTML**.
- Tab **Partial**: preset header/footer/CTA/signature; field sesuai preset; preview; toggle
  **Advanced HTML**.
- Aksi **Muat** pada daftar aset: theme mengisi form; layout/partial masuk ke mode advanced agar
  konten lama tidak hilang.
- Pembuatan versi baru memakai key yang sama; versi dihitung backend.

## 4. Keamanan

- Field teks di-escape saat membentuk HTML layout/partial.
- URL logo/unsubscribe hanya `http`/`https`; selain itu diabaikan.
- Preview memakai iframe sandbox tanpa script.
- Validasi server (`validateEmailHtml`, ukuran, theme token) tetap menjadi gerbang publish.

## 5. Batasan

- Belum ada drag-and-drop/block builder.
- Layout dua kolom kompleks tetap memakai advanced HTML/snippet.
- Theme form hanya mengelola token yang dikenal; token kustom dipertahankan lewat advanced JSON.
- Belum ada upload gambar; logo memakai URL.
- Semua verifikasi UI tetap manual (tanpa Playwright).

## 6. Implementasi dan verifikasi

Status: terimplementasi dan terverifikasi pada 2026-11-16.

- Theme tab sekarang memakai color picker + input token + select font + ukuran/radius/button,
  dengan preview email langsung. JSON hanya muncul jika **Mode advanced** diaktifkan.
- Layout tab menyediakan preset transaksional/promo/notifikasi dan field logo/brand/footer;
  HTML dihasilkan oleh `console/src/lib/emailDesign.ts`. Mode advanced memuat HTML penuh.
- Partial tab menyediakan preset header/footer/CTA/signature dan field sesuai preset; mode
  advanced tetap tersedia.
- Aksi **Muat** mengambil detail aset lewat endpoint GET yang sudah ada; theme masuk ke form,
  layout/partial masuk ke mode advanced agar konten lama tidak hilang. Menyimpan tetap membuat
  versi baru dengan key yang sama.
- Semua teks field di-escape saat membentuk HTML; URL logo/unsubscribe hanya http/https; preview
  memakai iframe `sandbox=""`.
- Tidak ada perubahan schema/API backend dan tidak ada dependency baru.

Verifikasi:

- `npm run console:typecheck` dan `npm run console:build`: lulus.
- HTML layout/partial yang dihasilkan diuji dengan `validateEmailHtml` dan token theme dengan
  `validateThemeTokens`: 0 issue; layout memuat tepat satu `{{{body}}}` dan berukuran ±2,4 KB.
- Preview iframe memakai sandbox; build console bertambah ±23 KB (967 KB / 282 KB gzip) dan masih
  dalam warning chunk lama.
- Backend/E2E tidak berubah; regresi E1–E19 tetap berlaku dari commit `fbcdefb`.
