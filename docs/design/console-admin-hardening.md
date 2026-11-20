# Hardening console tenant: password, secret API key, search, CSP

Status: **terimplementasi dan terverifikasi** (2026-11-20). Lihat §16 untuk catatan implementasi.
Basis: `docs/design/console-needs-analysis.md` §11.1, `docs/design/multi-tenant-platform-admin.md`
§19, `docs/usage/admin-and-operations.md`, `prisma/schema.prisma`, dan kode `src/admin`,
`src/auth/admin`, `console/src`.

**Isi dokumen**

- [1. Latar belakang](#1-latar-belakang)
- [2. Ruang lingkup](#2-ruang-lingkup)
- [3. Kondisi saat ini](#3-kondisi-saat-ini)
- [4. Ganti password admin](#4-ganti-password-admin)
- [5. Invalidasi sesi dengan tokenVersion](#5-invalidasi-sesi-dengan-tokenversion)
- [6. Secret API key dari console](#6-secret-api-key-dari-console)
- [7. Search notification dan page size](#7-search-notification-dan-page-size)
- [8. CSP header](#8-csp-header)
- [9. Perubahan schema dan migrasi](#9-perubahan-schema-dan-migrasi)
- [10. Daftar file](#10-daftar-file)
- [11. Verifikasi](#11-verifikasi)
- [12. Keputusan](#12-keputusan)
- [13. Risiko dan batasan](#13-risiko-dan-batasan)
- [14. Rollout](#14-rollout)
- [15. Pertanyaan persetujuan](#15-pertanyaan-persetujuan)
- [16. Catatan implementasi (2026-11-20)](#16-catatan-implementasi-2026-11-20)

---

## 1. Latar belakang

Audit console 2026-11-20 (`docs/design/console-needs-analysis.md` §11.1) menemukan empat gap P1
untuk single tenant:

1. **Tidak ada ganti password mandiri.** Password admin hanya bisa diubah dengan mengedit
   `ADMIN_PASSWORD_HASH` lalu restart backend. Untuk produksi, ini tidak praktis dan tidak aman
   (hash bocor di file env, tidak ada verifikasi password lama, semua sesi tetap hidup sampai
   token kedaluwarsa).
2. **`subscriberJwtSecret` tidak bisa diisi dari console.** Backend dan SDK sudah menerima field
   ini saat membuat API key, tetapi form console tidak menampilkannya. Akibatnya operator memakai
   fallback `SUBSCRIBER_JWT_SECRET` yang dibagi ke semua tenant/key.
3. **Tidak ada pencarian notifikasi.** Hanya filter status/template/tanggal; investigasi ID atau
   recipient tertentu memerlukan query manual.
4. **Belum ada CSP.** Console mengirim `X-Content-Type-Options`, `X-Frame-Options`, dan
   `Referrer-Policy`, tetapi belum `Content-Security-Policy`, sehingga mitigasi XSS bergantung pada
   sanitasi aplikasi saja.

Pekerjaan ini menutup keempat gap tersebut tanpa menambah dependency baru dan tanpa mengubah lane
autentikasi.

## 2. Ruang lingkup

### Termasuk

- Endpoint ganti password admin tenant + halaman `/account`.
- Invalidasi sesi setelah password berubah/reset (tokenVersion).
- Field opsional `subscriberJwtSecret` pada form buat API key.
- Pencarian notifikasi berdasarkan ID notifikasi atau recipient ID (exact) + pilihan page size.
- CSP header untuk artifact tenant dan platform, plus contoh deployment single tenant.
- Migrasi additive `AdminUser.tokenVersion`.
- Test e2e untuk password dan search; verifikasi header CSP pada image.

### Tidak termasuk

- Refresh token/session management penuh, daftar sesi, logout semua perangkat.
- Audit aksi admin tenant (tabel audit baru).
- Export CSV, resend all, compose/send.
- Perubahan model API key setelah dibuat (`allowedOrigins`/secret).
- RBAC, billing/kuota, atau perubahan lane platform selain invalidasi token.
- Browser automation permanen atau dependency test UI baru.

## 3. Kondisi saat ini

| Hal | Kondisi |
|---|---|
| Password admin | Dari `ADMIN_PASSWORD_HASH`; bootstrap upsert saat startup; tidak ada endpoint ubah |
| Token admin | JWT HS256, `ADMIN_JWT_EXPIRES_IN` (default 1h); guard query DB per request untuk active/tenant, **tidak** membandingkan versi password |
| Ganti password | Edit env + restart; sesi lama tetap valid sampai `exp` |
| API key | `CreateApiKeyDto` dan `ApiKeyInput` SDK sudah punya `allowedOrigins` + `subscriberJwtSecret`; UI hanya mengirim `name` + `allowedOrigins` |
| Search notification | `AdminListQueryDto` sudah punya `search`, SDK `NotificationQuery` extends `ListQuery` (punya `search`), tetapi `listNotifications` tidak meneruskannya dan service mengabaikannya |
| Page size | Tetap 20 di console; backend mendukung 1–100 |
| CSP | Tidak ada di `tenant.conf.template`, `platform.conf.template`, maupun panduan single tenant |

## 4. Ganti password admin

### 4.1 Kontrak API

```http
POST /api/v1/admin/auth/change-password
Authorization: Bearer <admin JWT>
Content-Type: application/json

{
  "currentPassword": "password-lama",
  "newPassword": "password-baru"
}
```

- Guard: `AdminJwtGuard` (tenant admin saja; platform admin ditolak `403`).
- Throttle: 5 percobaan/menit per IP (sama seperti login).
- Validasi:
  - `currentPassword`: string, 1–128 karakter;
  - `newPassword`: string, 8–72 karakter dan panjang byte UTF-8 ≤ 72 (batas bcrypt; tolak
    `password_too_long` agar tidak terpotong diam-diam);
  - password baru tidak boleh sama dengan password lama.
- Respons sukses: `204 No Content`.
- Error:
  - `400 invalid_current_password` — password lama salah;
  - `400 password_unchanged` — password baru sama;
  - `400` validasi DTO (pesan field jelas);
  - `401` token tidak valid/kedaluwarsa (guard);
  - `403` role bukan `tenant_admin`;
  - `429` throttle.

Catatan: error password lama **bukan** `401` agar handler global console tidak menghapus sesi saat
pengguna hanya salah mengetik password lama.

### 4.2 Perilaku

1. Ambil admin dari `adminId` di token; pastikan aktif dan role `tenant_admin`.
2. `bcrypt.compare(currentPassword, admin.passwordHash)`; jika gagal → `400`.
3. `bcrypt.hash(newPassword, 10)`; update `passwordHash` dan `tokenVersion += 1` dalam satu update.
4. Catat log terstruktur `admin.password.changed` dengan `admin_id`, `tenant_id`, `request_id`,
   `ip`; **tanpa** password/hash.
5. Respons `204`; semua token lama (termasuk token pemanggil) langsung tidak berlaku (lihat §5).

### 4.3 UI

- Route baru `/account` (di dalam `ProtectedRoute`), tautan dari email akun di topbar (menggantikan
  teks biasa).
- Halaman menampilkan email/role/tenant (read-only) dan form:
  - password saat ini,
  - password baru (min 8),
  - konfirmasi password baru.
- Validasi klien: field wajib, konfirmasi sama, panjang minimum; error API ditampilkan apa adanya
  lewat `describeError`.
- Setelah `204`: hapus session (`clearSession`), arahkan ke `/login?passwordChanged=1`, dan
  `LoginPage` menampilkan banner “Password berhasil diubah. Silakan masuk dengan password baru.”
- Tombol submit disabled saat request berjalan; tidak ada penyimpanan password di state global.

### 4.4 Alternatif yang ditolak

- **Hanya update hash tanpa invalidasi sesi:** token lama tetap valid sampai 1 jam; tidak cukup
  jika password berubah karena kompromi.
- **Endpoint tanpa password lama:** pengguna dengan token curian bisa mengganti password dan
  mengunci pemilik akun.
- **Mengandalkan platform-admin reset:** tidak tersedia di single tenant (lane platform tidak
  diaktifkan).

## 5. Invalidasi sesi dengan tokenVersion

### 5.1 Schema

```prisma
model AdminUser {
  // ...
  tokenVersion          Int     @default(0)
  bootstrapPasswordHash String?
}
```

Migrasi additive; baris lama otomatis `0`/`NULL`.

### 5.2 Token

- `AdminTokenClaims` menambah `tokenVersion: number`.
- `AdminTokenService.sign()` menulis klaim `tokenVersion`.
- `AdminTokenService.verify()` membaca klaim; bila tidak ada (token lama sebelum rilis) dianggap
  `0`.
- `AdminJwtGuard` dan `PlatformAdminGuard` memilih `tokenVersion` dari DB dan membandingkan:
  - sama → lanjut;
  - beda → `401` (log `auth.admin_token.rejected`, reason `token_revoked`).
- `AdminBootstrapService` menaikkan `tokenVersion` hanya bila `passwordHash` dari env berubah
  (bukan setiap restart).
- `PlatformTenantAdminsService.update` menaikkan `tokenVersion` saat reset password oleh platform.
- Login menyertakan `admin.tokenVersion` saat menandatangani token.

### 5.3 Kompatibilitas

- Token yang diterbitkan sebelum migrasi tidak punya klaim → dianggap `0`; akun lama juga `0`,
  sehingga token tetap berlaku sampai `exp` (tidak ada logout massal saat deploy).
- Setelah password berubah/reset/ env hash berubah, `tokenVersion` naik dan semua token lama
  ditolak seketika.
- Tidak ada perubahan pada `ADMIN_JWT_SECRET` atau masa berlaku.

### 5.4 Bootstrap versus password dari console

Bootstrap env tetap menjadi sumber untuk **rotasi** password, tetapi tidak boleh menimpa password
yang baru diubah dari console setiap restart. Karena itu `AdminUser.bootstrapPasswordHash`
menyimpan hash env terakhir yang diterapkan:

- admin dibuat: `passwordHash` dan `bootstrapPasswordHash` diisi hash env;
- restart dengan env sama: tidak ada update password (password UI tetap);
- `ADMIN_PASSWORD_HASH` berubah: hash baru diterapkan, `bootstrapPasswordHash` diperbarui, dan
  `tokenVersion` naik (sesi lama dicabut);
- reset password lewat lane platform atau console: `passwordHash` berubah, `bootstrapPasswordHash`
  tetap; restart dengan env lama tidak mengembalikannya.

Baris lama (sebelum migrasi) memiliki `bootstrapPasswordHash = NULL`; pada startup pertama
bootstrap mengisi kolom itu, dan hanya menyelaraskan password bila hash DB berbeda dari env.

## 6. Secret API key dari console

- Form buat API key menambah input **Subscriber JWT secret (opsional)** bertipe password,
  `autoComplete="new-password"`, min 32 karakter, maks 128.
- Bila diisi, console mengirim `subscriberJwtSecret` lewat `adminClient.createApiKey` (SDK sudah
  mendukung; backend sudah memvalidasi).
- Bila kosong, field tidak dikirim; perilaku fallback `SUBSCRIBER_JWT_SECRET` tetap seperti
  sekarang.
- Helper text: “Opsional. Jika kosong, verifikasi token subscriber memakai
  `SUBSCRIBER_JWT_SECRET`.”
- Tidak ada endpoint/UI untuk mengubah secret setelah key dibuat (di luar scope; dicatat sebagai
  batasan).
- Nilai secret tidak pernah ditampilkan kembali atau disimpan di state selain input form.

## 7. Search notification dan page size

### 7.1 Backend

`AdminNotificationsService.list` memakai `query.search` yang sudah ada di DTO:

```ts
const search = query.search?.trim();
const searchWhere =
  search === undefined || search.length === 0
    ? {}
    : {
        OR: [
          ...(UUID_PATTERN.test(search) ? [{ id: search }] : []),
          { recipients: { some: { recipientId: search } } },
        ],
      };
```

- **Exact match** untuk `Notification.id` (UUID) dan `NotificationRecipient.recipientId`.
- Tidak memakai `contains` agar tidak memindai tabel besar; `recipientId` sudah punya index
  `[recipientId, status]`.
- `search` digabung dengan filter tenant/status/templateKey/from/to memakai `AND` implisit.
- `count` memakai `where` yang sama sehingga pagination konsisten.
- Panjang maksimum 128 (DTO yang ada).

### 7.2 SDK

`NotifHubAdminClient.listNotifications` meneruskan `search` ke query string. Saat ini
`NotificationQuery` sudah punya `search`, tetapi method tidak mengirimnya — ini perbaikan satu
baris di source SDK.

Catatan rilis: perubahan ini masuk source workspace; `@notifhub/js` yang terbit di npm tetap
`0.3.0` sampai proses rilis patch berikutnya. Console memakai workspace (`file:../packages/js-sdk`),
jadi fitur berjalan di console tanpa menunggu npm.

### 7.3 UI

- Input **Cari** di halaman Notifications: placeholder “ID notifikasi atau recipient (exact)”.
- Tombol **Cari** + **Reset** memperbarui filter dan mengembalikan offset ke 0.
- Query key menyertakan `search` dan `limit`.
- Select **Baris per halaman**: 20/50/100 (default 20); backend sudah membatasi maksimum 100.
- Empty state membedakan “tidak ada hasil untuk pencarian” dan “belum ada notifikasi” bila mudah;
  minimal pesan kosong tetap jelas.
- Search tidak fuzzy; UI menampilkan contoh format agar pengguna tidak mengira substring.

## 8. CSP header

### 8.1 Policy

Tambahkan header berikut pada artifact tenant dan platform, serta contoh deployment single tenant:

```
Content-Security-Policy: default-src 'self'; base-uri 'self'; frame-ancestors 'none';
object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:;
form-action 'self'
```

Alasan:

- `script-src 'self'`: Vite menghasilkan file JS eksternal; tidak ada inline script di produksi.
- `style-src 'unsafe-inline'`: React/Bootstrap memakai style attribute dan CSS-in-JS ringan;
  menghapusnya berisiko memecah tampilan.
- `img-src https:`: URL gambar template dapat berasal dari API/origin lain.
- `connect-src 'self' https:`: console tenant dan platform memanggil API yang bisa berada di origin
  berbeda (split host) dan selalu HTTPS di produksi.
- `frame-ancestors 'none'` + `X-Frame-Options: DENY`: pertahanan berlapis.
- `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`: mengurangi vector klasik.

### 8.2 Pemasangan

- `console/nginx/tenant.conf.template` dan `console/nginx/platform.conf.template`:
  `add_header Content-Security-Policy "..." always;`
- Panduan `docs/operations/single-tenant-deployment.md`: header yang sama di Caddy dan nginx.
- Tidak ada perubahan pada HTML/JS; CSP hanya header runtime.

### 8.3 Verifikasi

- `curl -I` kedua image memuat header dan policy persis.
- Halaman login, dashboard, notifikasi, template (termasuk preview/test send), dan API key dimuat
  tanpa error CSP di browser (manual; tidak ada browser automation baru).
- Bila ada pelanggaran, longgarkan direktif spesifik (mis. `img-src`) — jangan hapus seluruh CSP.

## 9. Perubahan schema dan migrasi

| Perubahan | Detail |
|---|---|
| Kolom baru | `AdminUser.tokenVersion Int @default(0)` dan `AdminUser.bootstrapPasswordHash String?` |
| Migrasi | `20261120120000_admin_token_version` dan `20261120123000_admin_bootstrap_password_hash` |
| Backfill | `tokenVersion = 0`; `bootstrapPasswordHash = NULL` lalu diisi bootstrap berikutnya |
| Rollback | Kolom additive; drop manual hanya jika benar-benar perlu (Prisma tidak menyediakan down otomatis). Token tanpa klaim tetap kompatibel |

Tidak ada perubahan pada tabel tenant/notifikasi/API key.

## 10. Daftar file

### Backend

| File | Perubahan |
|---|---|
| `prisma/schema.prisma` | `AdminUser.tokenVersion` |
| `prisma/migrations/<timestamp>_admin_token_version/` | Migrasi additive |
| `src/admin/dto/auth.dto.ts` | `ChangePasswordDto` |
| `src/admin/controllers/admin-auth.controller.ts` | `POST /admin/auth/change-password` |
| `src/admin/services/admin-auth.service.ts` | Verifikasi password lama, update hash + tokenVersion, log |
| `src/auth/admin/admin.types.ts` | `tokenVersion` di claims/principal |
| `src/auth/admin/admin-token.service.ts` | Sign/verify klaim `tokenVersion` |
| `src/auth/admin/admin-jwt.guard.ts` | Bandingkan tokenVersion |
| `src/auth/admin/platform-admin.guard.ts` | Bandingkan tokenVersion |
| `src/auth/admin/admin-bootstrap.service.ts` | Naikkan tokenVersion bila hash env berubah |
| `src/platform/services/platform-tenant-admins.service.ts` | Naikkan tokenVersion saat reset password |
| `src/admin/services/admin-notifications.service.ts` | Filter `search` |
| `src/admin/dto/list-query.dto.ts` | Dokumentasi `search` (field sudah ada) |
| `test/app.e2e-spec.ts` | E2E password + search |

### Console

| File | Perubahan |
|---|---|
| `console/src/pages/AccountPage.tsx` (baru) | Profil + form ganti password |
| `console/src/lib/adminAccount.ts` (baru) | Wrapper `HttpTransport` untuk change-password |
| `console/src/App.tsx` | Route `/account` |
| `console/src/layout/AppLayout.tsx` | Tautan akun di topbar |
| `console/src/pages/LoginPage.tsx` | Banner `passwordChanged=1` |
| `console/src/pages/ApiKeysPage.tsx` | Input `subscriberJwtSecret` |
| `console/src/pages/NotificationsPage.tsx` | Search + page size |
| `packages/js-sdk/src/admin-client.ts` | Teruskan `search` di `listNotifications` |

### Deployment dan dokumentasi

| File | Perubahan |
|---|---|
| `console/nginx/tenant.conf.template` | CSP |
| `console/nginx/platform.conf.template` | CSP |
| `docs/operations/single-tenant-deployment.md` | CSP di contoh Caddy/nginx |
| `docs/design/console-admin-hardening.md` | Dokumen ini |
| `docs/README.md`, `docs/design/README.md`, `docs/design/console-needs-analysis.md`, `docs/architecture/project-brief.md` | Status dan tautan |

## 11. Verifikasi

### Backend dan migrasi

- `npx prisma migrate deploy` di dev/test; `npx prisma migrate status` bersih.
- E2E baru:
  1. buat admin khusus lewat Prisma (email unik, password awal);
  2. login → token A;
  3. `POST /auth/change-password` dengan password lama salah → `400 invalid_current_password`;
  4. password baru sama → `400 password_unchanged`;
  5. sukses → `204`;
  6. token A dipakai lagi → `401` (tokenVersion mismatch);
  7. login dengan password lama → `401`; password baru → `200`;
  8. bersihkan admin.
- E2E search:
  1. notifikasi dari E3 dicari berdasarkan ID → total 1;
  2. search recipient ID → total ≥ 1;
  3. tenant B search ID tenant A → total 0;
  4. search digabung filter status → konsisten.
- `npm run ci` (typecheck, build, unit, e2e, migrate status).

### Console

- `npm run console:typecheck` dan `npm run console:build`.
- Uji protokol (tanpa browser automation): login admin kedua, buka `/account`, ubah password,
  pastikan diarahkan ke `/login?passwordChanged=1`, login baru berhasil.
- Buat API key dengan `subscriberJwtSecret`; pastikan token subscriber ditandatangani secret itu
  diterima dan fallback tidak dipakai.
- Search notification dan page size 50 menghasilkan request `limit=50&search=...`.
- Dashboard tetap memakai `adminClient` tanpa perubahan perilaku.

### CSP dan image

- `docker build` kedua target console; jalankan container; `curl -I` memuat
  `Content-Security-Policy`.
- Muat halaman utama dan halaman template di browser; tidak ada error CSP di console devtools.
- `npm run docs:check`.

## 12. Keputusan

| # | Keputusan | Default |
|---|---|---|
| D1 | Tambah endpoint `POST /admin/auth/change-password` dengan verifikasi password lama | Ya |
| D2 | Tambah `AdminUser.tokenVersion` + klaim JWT; naikkan saat password berubah/reset | Ya |
| D3 | Setelah ganti password, semua sesi (termasuk sesi saat ini) logout | Ya |
| D4 | UI ganti password di route `/account` + tautan topbar | Ya |
| D5 | `subscriberJwtSecret` opsional di form buat API key; tidak ada edit setelah create | Ya |
| D6 | Search notification exact ID/recipient; page size 20/50/100 | Ya |
| D7 | Perbaiki SDK `listNotifications` untuk meneruskan `search`; rilis npm patch menyusul | Ya |
| D8 | CSP dengan `connect-src 'self' https:`; `style-src 'self' 'unsafe-inline'` | Ya |
| D9 | Tanpa dependency baru; tanpa browser automation permanen | Ya |
| D10 | P1 tidak mencakup audit admin tenant, export, resend all, compose | Ya |

## 13. Risiko dan batasan

1. **TokenVersion menyentuh auth core.** Guard tenant dan platform berubah; regresi auth harus
   diuji (login, suspend, role mismatch, old token). Mitigasi: E2E E1–E37 tetap dijalankan.
2. **Password berubah = logout semua sesi.** Ini perilaku yang diinginkan, tetapi harus
   dikomunikasikan di UI.
3. **Batas bcrypt 72 byte.** Validasi panjang mencegah password terpotong diam-diam.
4. **Search exact, bukan fuzzy.** Pengguna yang mengetik sebagian ID tidak mendapat hasil; UI
   menjelaskan format.
5. **CSP dapat memecah UI** bila ada inline script/style yang belum terdeteksi. Mitigasi: uji
   halaman utama + template; longgarkan direktif spesifik, bukan menghapus header.
6. **`connect-src https:` masih luas.** Pengetatan per origin membutuhkan env tambahan; dicatat
   sebagai penyempurnaan.
7. **Tidak ada audit persisten untuk ganti password.** Hanya log terstruktur; audit aksi admin
   tenant tetap backlog P2.
8. **Rate limit per IP**; di belakang proxy tanpa `trust proxy` limit praktis global (batasan lama).
9. **SDK npm belum diperbarui.** Console berjalan dari workspace; konsumen npm baru mendapat
   `search` setelah patch release.

## 14. Rollout

1. Migrasi + backend (tokenVersion). Token lama tetap valid sampai `exp` bila password tidak
   berubah.
2. Console build/deploy. Pengguna melihat menu akun dan field secret API key.
3. Rebuild/redeploy image console dengan CSP; verifikasi header dan halaman.
4. Perbarui panduan single tenant dan dokumentasi status.
5. Regression: `npm run ci`, console build, docs check, smoke image.

## 15. Pertanyaan persetujuan

Disetujui 2026-11-20: D1–D10 (pertanyaan di bawah dipertahankan sebagai catatan keputusan).

1. Setuju **tokenVersion + migrasi** (D2), sehingga ganti password mereset semua sesi?
2. Setuju password baru 8–72 karakter dan error password lama `400` (bukan `401`)?
3. Setuju UI di route **`/account`** + tautan topbar (D4)?
4. Setuju **search exact** ID/recipient dan page size 20/50/100 (D6)?
5. Setuju memperbaiki **source SDK** `listNotifications` sekarang dan menunda rilis npm patch (D7)?
6. Setuju CSP dengan `connect-src 'self' https:` (D8)?
7. Setuju P1 **tanpa** audit admin tenant, export, resend all, dan compose (D10)?

Setelah disetujui, implementasi dilakukan berurutan: migrasi/tokenVersion → endpoint password →
UI akun → secret API key → search → CSP → verifikasi dan commit.

## 16. Catatan implementasi (2026-11-20)

D1–D10 disetujui dan diimplementasikan.

Yang sudah berjalan:

- Migrasi `20261120120000_admin_token_version` menambah `AdminUser.tokenVersion`, dan
  `20261120123000_admin_bootstrap_password_hash` menambah `bootstrapPasswordHash`; keduanya
  diterapkan di database dev dan test (total 13 migrasi).
- `AdminTokenService` menandatangani/membaca klaim `tokenVersion`; token lama tanpa klaim dianggap
  `0`. `AdminJwtGuard` dan `PlatformAdminGuard` menolak token yang versinya tidak cocok.
- `POST /api/v1/admin/auth/change-password` (guard tenant + throttle 5/menit, `204`, error
  `invalid_current_password`/`password_unchanged`/`password_too_long` dengan `details.code`).
- Bootstrap menaikkan `tokenVersion` hanya saat hash env berubah; `bootstrapPasswordHash`
  membedakan rotasi env dari perubahan password UI sehingga restart tidak mengembalikan password
  lama. Reset password oleh platform juga menaikkan `tokenVersion`.
- Halaman `/account` (profil + form ganti password) dan tautan email di topbar; setelah sukses
  sesi dibersihkan dan diarahkan ke `/login?passwordChanged=1` dengan banner.
- Form API key menambah field opsional `subscriberJwtSecret` (min 32); SDK dan backend sudah
  mendukung.
- `AdminNotificationsService.list` mencari **exact** `Notification.id` (UUID) atau
  `recipientId`, tenant-scoped; SDK `listNotifications` meneruskan `search`; UI punya input cari
  dan pilihan 20/50/100 baris.
- CSP ditambahkan ke `tenant.conf.template`, `platform.conf.template`, serta contoh Caddy/nginx di
  panduan single tenant.

Verifikasi:

| Pemeriksaan | Hasil |
|---|---|
| `npm run typecheck` (backend) | lulus |
| `npm run test:unit` | 29 test lulus (7 suite), termasuk unit tokenVersion |
| `npm run test:e2e` | 40 test lulus; E38 password, E39 search, E40 bootstrap tidak menimpa password UI |
| `npm run console:typecheck` / `console:build` | lulus; dua artifact |
| `docker build` target `runner-tenant` / `runner-platform` | lulus |
| `curl -I` image tenant & platform | `Content-Security-Policy` persis sesuai §8.1, halaman `200` |
| Render login dengan headless Edge di bawah CSP | form tampil (script/style tidak diblokir) |
| `npm run ci` | lulus 86 s: typecheck, build, 29 unit, 40 e2e, 13 migrasi, `Database schema is up to date!` |
| `npm run docs:check` | lulus |

Catatan/deviasi:

1. **Test E38 tidak memakai login** untuk admin uji: token ditandatangani langsung dengan
   `ADMIN_JWT_SECRET` (`tokenVersion: 0`). Ini menghindari throttle login 5/menit yang sudah
   terpakai E6/E32/E33 dan tetap menguji guard, endpoint, serta invalidasi token.
2. **Halaman `/account` belum diuji dengan browser automation.** Verifikasi UI: build/typecheck,
   route tersaji `200`, dan render login di bawah CSP. Perilaku form mengikuti komponen yang sama.
3. **CSP `connect-src 'self' https:` masih luas**; pengetatan per origin memerlukan env tambahan
   (dicatat sebagai penyempurnaan).
4. **Tidak ada audit persisten** untuk perubahan password; hanya log terstruktur
   `admin.password.changed`. Audit aksi admin tenant tetap backlog P2.
5. **Token lama tetap berlaku saat deploy** (klaim tidak ada = 0, DB 0); setelah password berubah
   atau hash env berubah, semua token lama langsung ditolak.
6. **SDK npm belum dirilis ulang**; console memakai workspace, jadi `search` berjalan. Patch
   release `@notifhub/js` perlu dilakukan agar konsumen npm mendapatkannya.
7. **Tidak ada dependency baru.** OpenAPI publik tidak berubah (endpoint admin tidak masuk subset
   publik).
8. **Bootstrap env tidak menimpa password UI.** `bootstrapPasswordHash` menyimpan hash env terakhir;
   rotasi `ADMIN_PASSWORD_HASH` tetap diterapkan dan mencabut sesi, sedangkan perubahan dari console
   bertahan setelah restart. E40 menguji perilaku ini.
