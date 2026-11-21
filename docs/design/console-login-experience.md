# Pengalaman login console (tenant & platform)

Status: **draf; tiga opsi, menunggu pilihan** (2026-11-21).
Basis: `console/src/auth/LoginPage.tsx`, `console/src/auth/PlatformLoginPage.tsx`,
`console/src/styles.css` (§login), `README.md` (posisi produk), `docs/architecture/project-brief.md`
§4 (desain minimal/netral, tanpa gradient/glow), dan `docs/design/react-and-console.md` §10.

Mockup visual (buka di browser, ada pengalih opsi/lane/state):
[mockups/console-login-options.html](mockups/console-login-options.html).

**Isi dokumen**

- [1. Masalah pada halaman saat ini](#1-masalah-pada-halaman-saat-ini)
- [2. Prinsip desain](#2-prinsip-desain)
- [3. Tiga opsi](#3-tiga-opsi)
- [4. Rekomendasi](#4-rekomendasi)
- [5. Token dan komponen](#5-token-dan-komponen)
- [6. Copy dan state](#6-copy-dan-state)
- [7. Rencana implementasi](#7-rencana-implementasi)
- [8. Verifikasi](#8-verifikasi)
- [9. Risiko](#9-risiko)
- [10. Pertanyaan persetujuan](#10-pertanyaan-persetujuan)

---

## 1. Masalah pada halaman saat ini

`/login` dan `/platform/login` memakai kartu 380 px di tengah layar dengan urutan yang sama:
mark huruf `N`/`P`, judul, intro, dua field, tombol. Platform hanya dibedakan oleh warna teal dan
border atas. Akibatnya:

1. **Tidak ada karakter produk.** NotifHub adalah layanan notifikasi multi-channel dengan antrean,
   provider, status pengiriman, dan tiga lane auth; tidak ada satu pun petunjuk itu di layar masuk.
2. **Layout generik.** Pola “kartu di tengah + form” mudah ditemukan di proyek lain dan terasa
   seperti template, bukan bagian dari sistem console.
3. **Hirarki lemah.** Semua elemen berada dalam satu kolom dengan bobot visual hampir sama; brand,
   lane, dan aksi tidak dibedakan.
4. **Dua lane terasa seperti duplikat.** Platform admin dan tenant admin punya tugas berbeda, tetapi
   layarnya hanya berbeda warna.
5. **Tidak ada “sesuatu yang nyata”.** Tidak ada data, status, atau kosakata domain yang membantu
   pengguna tahu ia masuk ke produk apa.

## 2. Prinsip desain

1. **Domain-specific, bukan dekoratif.** Gunakan objek nyata NotifHub: antrean, channel, status
   kirim, tenant, audit. Bukan ilustrasi abstrak, gradient, atau glow.
2. **Flat dan editorial.** Permukaan datar, garis rambut, tipografi tegas, metadata monospace.
   Tanpa gradient/glow; bayangan hanya bila benar-benar perlu.
3. **Dua lane, satu sistem.** Struktur yang sama, penekanan berbeda: tenant memakai aksen biru dan
   bahasa operasional; platform memakai panel gelap/aksen teal dan bahasa lintas tenant.
4. **Tenang dan cepat.** Tidak ada animasi masuk yang berlebihan; `prefers-reduced-motion`
   dihormati. Fokus keyboard jelas, kontras AA.
5. **Mobile tetap utuh.** Panel konteks boleh menyusut, tetapi form, pesan error, dan tautan lane
   tidak boleh hilang.

## 3. Tiga opsi

### Opsi A — “Delivery Ledger” (rekomendasi)

Split dua kolom. Kiri: brand, satu kalimat positioning, dan **ledger pengiriman** berisi baris
monospace `waktu · channel · status` dengan titik status. Kanan: form di permukaan putih, eyebrow
lane, judul, dan footnote keamanan. Tenant memakai panel terang; platform memakai panel ink dengan
aksen teal dan baris `tenant · action`.

| Kekuatan | Risiko |
|---|---|
| Paling jelas menunjukkan domain notifikasi | Butuh ruang horizontal; di layar sempit panel harus dipadatkan |
| Hirarki kuat: narasi → bukti → aksi | Baris ledger harus terlihat seperti data nyata, bukan hiasan |
| Dua lane terasa berbeda tanpa mengubah sistem | Kontras teks di panel gelap harus diuji |

### Opsi B — “Switchboard”

Satu panel lebar dengan **status bar** gelap di atas (`API · operational`, `QUEUE · 3 workers`,
`CHANNELS · in-app/email/whatsapp`) dan grid: kiri ringkasan channel/tenant + queue depth, kanan
form. Terasa seperti panel operator; paling padat dan “teknis”.

| Kekuatan | Risiko |
|---|---|
| Memberi konteks operasional sebelum login | Lebih padat; bisa terasa berisik untuk pengguna non-teknis |
| Cocok untuk operator yang sering login | Status yang ditampilkan mockup harus nyata atau diberi label jelas |

### Opsi C — “Quiet Type”

Satu kolom maksimal 520 px dengan garis aksen vertikal, wordmark outline, judul besar
(`Masuk.`/`Platform.`), form, dan catatan kaki. Paling tenang dan cepat; paling dekat dengan
estetika dokumentasi/editorial.

| Kekuatan | Risiko |
|---|---|
| Ringan, fokus, mudah dirawat | Paling mirip halaman login umum; karakter produk lebih tipis |
| Sangat baik di mobile | Tidak menunjukkan multi-channel/antrean |

### Perbandingan

| Kriteria | A Ledger | B Switchboard | C Quiet |
|---|---|---|---|
| Karakter produk | Tinggi | Tinggi | Sedang |
| Kepadatan informasi | Sedang | Tinggi | Rendah |
| Risiko “template” | Rendah | Sedang | Sedang–tinggi |
| Biaya implementasi | Sedang | Sedang | Rendah |
| Mobile | Baik (panel menyusut) | Baik (grid menumpuk) | Sangat baik |

## 4. Rekomendasi

**Opsi A — Delivery Ledger**, dengan penyesuaian:

- Tenant: panel kiri terang `#f5f5f4`, aksen biru `#2563eb`.
- Platform: panel kiri ink `#1c1917`, aksen teal `#0f766e`, label lane eksplisit.
- Ledger di mockup adalah **contoh statis**; implementasi tidak boleh menampilkan data palsu
  seolah-olah nyata. Pilihan aman: ledger dekoratif tanpa angka yang bisa disalahartikan, atau
  label “contoh alur” yang jelas. Rekomendasi: pakai contoh generik `in-app/email/whatsapp` tanpa
  timestamp spesifik, atau ganti dengan tiga langkah konseptual (`queued → sent → delivered`).
- Jika Anda ingin nuansa operator yang lebih padat, Opsi B adalah alternatif; Opsi C jika ingin
  perubahan paling minimal.

## 5. Token dan komponen

Tidak mengubah token global console. Token login-scoped:

| Token | Nilai | Catatan |
|---|---|---|
| `--login-bg` | `var(--bg)` | Sama dengan console |
| `--login-aside` | `#f5f5f4` (tenant) / `#1c1917` (platform) | Panel konteks |
| `--login-accent` | `#2563eb` / `#0f766e` | Mewarisi accent lane |
| `--login-rule` | `var(--line)` / `#292524` | Garis pada panel gelap |
| Tipografi judul | `clamp(30px, 3.6vw, 46px)`, `-0.035em` | Hanya untuk panel kiri |
| Metadata | `ui-monospace`, 10–11 px, `0.12em` | Waktu/status/lane |

Komponen:

- `LoginShell` (baru, `console/src/auth/LoginShell.tsx`): props `lane`, `title`, `intro`,
  `aside`, `children`, `footer`; merender dua kolom dan kelas lane. Form tetap di
  `LoginPage`/`PlatformLoginPage` agar logika auth tidak berubah.
- `LoginLedger` (baru, kecil): daftar baris statis; tidak melakukan fetch.
- Tidak ada dependency baru dan tidak ada aset gambar; mark tetap huruf `N` di kotak.

## 6. Copy dan state

Tenant:

- Eyebrow: `TENANT ADMIN`; judul: `Masuk ke workspace`.
- Intro: “Gunakan akun tenant admin untuk melanjutkan.”
- Panel: “Setiap notifikasi punya jejak.” + tiga baris contoh alur.

Platform:

- Eyebrow: `PLATFORM ADMIN`; judul: `Masuk ke platform`.
- Intro: “Gunakan akun platform admin untuk mengelola tenant.”
- Panel: “Kendali lintas tenant.” + baris `tenant · action`.
- Tautan: “Kembali ke login tenant admin” (tetap).

State: normal, error (`Email atau password salah.`), `passwordChanged` (alert sukses yang ada),
loading tombol (`Spinner`), dan throttle footnote. Tidak menambah state baru.

## 7. Rencana implementasi

1. Tambah `LoginShell` + `LoginLedger` dan CSS login-scoped di `console/src/styles.css`.
2. Ubah `LoginPage` dan `PlatformLoginPage` memakai shell; pertahankan `useForm`, `login`,
   `passwordChanged`, redirect, dan `platformLoginError`.
3. Hapus CSS kartu lama yang tidak terpakai; jangan mengubah token global.
4. Tambah test console: heading lane, label field, alert error/passwordChanged, tautan platform.
5. Perbarui `docs/design/react-and-console.md` §10 dan dokumen ini (§11) setelah disetujui.

Tidak termasuk: perubahan auth/API, ilustrasi, dependency UI baru, rebranding penuh.

## 8. Verifikasi

| Pemeriksaan | Target |
|---|---|
| `npm run console:typecheck` / `console:test` / `console:build` | lulus; 18 test + test login baru |
| Bundle isolation | tenant tanpa marker platform, platform tanpa key session tenant |
| Manual | 1440 px dan 390 px; state normal/error/passwordChanged; fokus keyboard; `prefers-reduced-motion` |
| `npm run ci` / `docs:check` | lulus |
| Aksesibilitas | label terhubung, kontras AA, `aria-current` pada tab mockup tidak masuk produksi |

## 9. Risiko

1. **Ledger statis disalahartikan sebagai data nyata.** Mitigasi: label “contoh alur” atau baris
   konseptual tanpa timestamp.
2. **Panel gelap platform** menurunkan kontras teks sekunder; uji dengan nilai `#a8a29e` di atas
   `#1c1917`.
3. **Tinggi layar kecil**: panel kiri harus menyusut; ledger boleh dipotong menjadi dua baris.
4. **Duplikasi markup** tenant/platform; diatasi dengan `LoginShell` dan props.

## 10. Pertanyaan persetujuan

1. Pilih opsi: **A Delivery Ledger**, **B Switchboard**, atau **C Quiet Type**?
2. Untuk Opsi A, apakah ledger memakai contoh alur generik (tanpa timestamp) atau tiga baris
   dengan timestamp seperti mockup?
3. Apakah panel platform tetap gelap dengan aksen teal, atau tetap terang seperti tenant?
4. Setuju implementasi hanya CSS + komponen shell, tanpa perubahan auth/API dan tanpa dependency
   baru?

Setelah dipilih, implementasi mengikuti §7 dan diverifikasi sesuai §8.
