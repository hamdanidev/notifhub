# Desain publikasi npm SDK JavaScript dan React

Status: terimplementasi dan terverifikasi sampai `npm publish --dry-run`; publish ke registry menunggu
autentikasi 2FA (lihat §11).
Basis: `docs/project-brief.md`, `docs/usage/`, kondisi `packages/js-sdk` dan `packages/react`.

---

## 1. Latar belakang

NotifHub adalah produk SDK-first. Distribusi Go SDK sudah selesai (`github.com/hamdanidev/notifhub-go`
+ tag `v0.10.0`), tetapi dua SDK JavaScript belum bisa dipasang konsumen:

| Paket | Versi | Kondisi |
|---|---|---|
| `@notifhub/js` | `0.3.0` | Built (ESM+CJS+types) tetapi belum pernah dipublish; nama di registry masih `404` |
| `@notifhub/react` | `0.2.0` | Sama, **dan** dependency `@notifhub/js` masih `file:../js-sdk` |

`file:` adalah dependency lokal: kalau `@notifhub/react` dipublish apa adanya, konsumen akan gagal
resolve karena `file:../js-sdk` tidak ada di mesin mereka. Selain itu belum ada metadata rilis
(`repository`, `publishConfig.access`), sehingga `npm publish` untuk paket scoped akan ditolak
(akses default private) atau menghasilkan paket yang tidak informatif.

Environment saat ini: `npm whoami` → `ENEEDAUTH` (belum login), npm `11.13.0`, Node `24`.
Artinya **publikasi akhir tidak bisa dilakukan dari sesi ini**; yang bisa disiapkan dan
diverifikasi adalah seluruh jalur sampai `npm publish --dry-run` dan instalasi dari tarball.

---

## 2. Ruang lingkup

### Termasuk

1. Manifest kedua paket: metadata rilis, `publishConfig`, `engines`, `repository.directory`,
   `prepack`.
2. `@notifhub/react`: dependency `file:../js-sdk` → rentang semver `^0.3.0` (workspace tetap
   me-link lokal selama versi memenuhi range).
3. Skrip/verifikasi: `npm pack --dry-run`, `npm publish --dry-run`, instalasi tarball di proyek
   bersih (ESM, CJS, TypeScript), dan pengecekan isi tarball.
4. Workflow `.github/workflows/publish-npm.yml` (`workflow_dispatch`, input paket + dry-run,
   `NPM_TOKEN`, provenance).
5. Dokumentasi: `docs/npm-publishing.md` (dokumen ini), pembaruan README paket + `docs/usage/`.

### Tidak termasuk

- Perubahan API/perilaku SDK.
- Publikasi aktual ke registry (butuh kredensial Anda; lihat §9).
- Perubahan `console` (tetap `private`, tetap memakai `file:`).
- Rename scope/paket.
- Versioning otomatis (changesets/release-please).
- Publikasi Go SDK (sudah selesai).

---

## 3. Kondisi paket saat ini

| Aspek | `@notifhub/js` | `@notifhub/react` |
|---|---|---|
| Format | ESM + CJS + `.d.ts` (tsup) | sama |
| `files` | `["dist"]` | `["dist"]` |
| Dependency | tidak ada | `@notifhub/js: file:../js-sdk` |
| Peer | — | `react`, `react-dom` (`>=18 <19`) |
| `exports` | `.` → types/import/require | sama |
| `sideEffects` | `false` | `false` |
| Metadata rilis | belum ada | belum ada |
| Nama di npm | `404` (belum dipakai) | `404` (belum dipakai) |

`@notifhub/js` tidak punya dependency runtime sehingga aman dipublish lebih dulu.

---

## 4. Perubahan manifest

### 4.1 `@notifhub/js`

```jsonc
{
  "name": "@notifhub/js",
  "version": "0.3.0",
  "description": "TypeScript SDK for NotifHub in-app notifications and the admin API",
  "license": "UNLICENSED",
  "repository": { "type": "git", "url": "git+https://github.com/hamdanidev/notifhub.git", "directory": "packages/js-sdk" },
  "homepage": "https://github.com/hamdanidev/notifhub/tree/main/packages/js-sdk#readme",
  "bugs": { "url": "https://github.com/hamdanidev/notifhub/issues" },
  "keywords": ["notifications", "in-app", "sse", "sdk", "notifhub"],
  "engines": { "node": ">=20" },
  "publishConfig": { "access": "public" },
  "scripts": { "prepack": "npm run build" }
}
```

### 4.2 `@notifhub/react`

Sama seperti di atas, ditambah:

```jsonc
{
  "dependencies": { "@notifhub/js": "^0.3.0" },
  "peerDependencies": { "react": ">=18 <19", "react-dom": ">=18 <19" },
  "repository": { "directory": "packages/react" }
}
```

Catatan: npm workspaces tetap me-link `@notifhub/js` lokal karena versi workspace (`0.3.0`)
memenuhi `^0.3.0`; tidak perlu `file:` lagi. `console` tetap memakai `file:` karena bukan
workspace dan tidak dipublikasikan.

### 4.3 Isi tarball yang diharapkan

`npm pack` harus menghasilkan hanya:

```
dist/index.js, dist/index.cjs, dist/index.d.ts, dist/index.d.cts, *.map
package.json, README.md
```

Tidak boleh ada `src/`, `test/`, `tsconfig`, atau `node_modules`.

---

## 5. Versi dan urutan rilis

- Versi paket independen dari root service: `@notifhub/js` `0.3.0`, `@notifhub/react` `0.2.0`.
- Rilis **js lebih dulu**, verifikasi registry, baru react (agar `^0.3.0` resolve).
- Tag git per paket: `js-v0.3.0`, `react-v0.2.0`. Tag root `vX.Y.Z` tetap untuk rilis service.
- Selama paket masih `0.x`, perubahan breaking boleh menaikkan minor (`0.3` → `0.4`), dan react
  harus menyesuaikan rentang dependency-nya pada rilis berikutnya.
- Bump versi manual di `package.json` kedua paket saat rilis; tidak memakai changesets dulu.

---

## 6. Alur publish

### 6.1 Manual (jalur utama untuk rilis pertama)

```bash
npm login                     # butuh akun dengan akses scope @notifhub
npm run sdk:build
npm run sdk:test

# js
npm pack --dry-run --workspace @notifhub/js
npm publish --workspace @notifhub/js --access public

# react (setelah js terlihat di registry)
npm run react:build
npm run react:test
npm pack --dry-run --workspace @notifhub/react
npm publish --workspace @notifhub/react --access public
```

Jika akun memakai 2FA, npm akan meminta OTP. `prepack` memastikan `dist` selalu baru.

### 6.2 Otomasi (workflow)

`.github/workflows/publish-npm.yml`:

- Trigger `workflow_dispatch` dengan input `package` (`js` | `react`) dan `dry_run` (boolean).
- Guard: tag `js-v<version>` / `react-v<version>` harus ada dan cocok dengan versi di
  `package.json`; jika tidak, job gagal sebelum publish.
- Auth: secret `NPM_TOKEN` (Automation token dengan akses publish ke scope `@notifhub`).
- Publish dengan `--provenance` (repo publik) dan `--access public`.
- `dry_run=true` menjalankan `npm publish --dry-run` saja.

Tidak memakai trusted publishing (OIDC) pada tahap ini karena butuh konfigurasi tambahan di
npmjs.com dan belum ada akun terautentikasi di environment ini.

---

## 7. Verifikasi

1. **Isi tarball**: `npm pack --dry-run --json` diperiksa; hanya file di §4.3.
2. **Instalasi nyata dari tarball** di proyek bersih:
   - `npm install <tarball>` lalu `require('@notifhub/js')` (CJS) dan `import` (ESM);
   - untuk react: pasang `react@18`, render `NotificationBell` via `react-dom/server`;
   - TypeScript: file `.ts`/`.tsx` yang meng-import keduanya, `tsc --noEmit`.
3. **Dry-run publish** untuk kedua paket (`npm publish --dry-run --workspace ...`).
4. **Workflow**: YAML diparse (`js-yaml`), daftar step diperiksa; tidak dieksekusi karena butuh
   `NPM_TOKEN` dan repo sudah publik (bisa dieksekusi manual via `workflow_dispatch`).
5. **Regresi**: `npm run ci`, `sdk:test`, `react:test`, `console:build`, `go test` tetap hijau,
   serta `openapi:export` tidak berubah (tidak ada perubahan API).
6. **Dokumentasi**: tautan valid; README paket menyebut `npm install @notifhub/js` /
   `@notifhub/react` sebagai jalur resmi.

---

## 8. Keputusan bernomor

| # | Keputusan | Default |
|---|---|---|
| D1 | Scope pekerjaan: kesiapan publish kedua paket; tanpa perubahan API/perilaku | Ya |
| D2 | `@notifhub/react` memakai `@notifhub/js: ^0.3.0` (bukan `file:`); console tetap `file:` | Ya |
| D3 | Metadata rilis: `repository.directory`, `homepage`, `bugs`, `keywords`, `engines`, `publishConfig.access=public` | Ya |
| D4 | Lisensi **tetap `UNLICENSED`**; jika ingin MIT, tambahkan file LICENSE + ubah field (keputusan Anda) | Ya (tidak diubah) |
| D5 | Versi rilis pertama: js `0.3.0`, react `0.2.0`; tag `js-v0.3.0` dan `react-v0.2.0` | Ya |
| D6 | Urutan rilis: js dulu, verifikasi, baru react | Ya |
| D7 | `prepack: npm run build` di kedua paket | Ya |
| D8 | Workflow `workflow_dispatch` + `NPM_TOKEN` + `--provenance`; tanpa trusted publishing dulu | Ya |
| D9 | Publish manual tetap didokumentasikan sebagai jalur utama rilis pertama | Ya |
| D10 | Tanpa changesets/versioning otomatis | Ya |
| D11 | `files` tetap `["dist"]`; source/test tidak ikut | Ya |
| D12 | Dokumen rilis baru `docs/npm-publishing.md`; README paket + `docs/usage/` diperbarui | Ya |

Bila ada nomor yang ingin diubah (misalnya D4 lisensi, atau D7 menambah `prepublishOnly`), sebutkan.

---

## 9. Risiko dan batasan

1. **Publikasi akhir tidak dapat dilakukan dari sesi ini** (`npm whoami` → belum login). Saya
   menyiapkan manifest, skrip, workflow, dan memverifikasi sampai `npm pack`/`npm publish --dry-run`
   serta instalasi dari tarball. Publikasi nyata dijalankan Anda (manual) atau lewat workflow
   dengan `NPM_TOKEN`.
2. **Scope `@notifhub` harus tersedia.** Nama `@notifhub/js` dan `@notifhub/react` belum terdaftar
   (404), tetapi publish scoped package tetap memerlukan akses ke org/scope `@notifhub`. Kalau
   scope itu tidak bisa dipakai, opsi fallback adalah scope lain (mis. `@hamdanidev/...`) yang
   berarti **mengubah nama paket dan contoh import** — keputusan terpisah.
3. **Lisensi `UNLICENSED`** membuat paket publik tanpa izin pakai yang jelas; sebagian konsumen
   menghindarinya. Tidak diubah tanpa keputusan Anda.
4. **Npm publish bersifat permanen-ish**: unpublish hanya diizinkan dalam 72 jam dan dengan syarat
   ketat. Karena itu dry-run + instalasi tarball wajib lulus sebelum publish.
5. **2FA/OTP** pada akun npm dapat menghentikan publish manual; workflow dengan token otomatis
   menghindari ini, tetapi token harus disimpan sebagai secret dan dirotasi.
6. **Provenance** hanya bermakna untuk repo publik dan build dari CI; publikasi manual tidak
   menghasilkan attestation.
7. **`packages/react/package-lock.json`** saat ini ada dan menunjuk `file:`; setelah dependency
   diubah, file itu menjadi usang. Rencana: biarkan (tidak dipakai oleh workspace) atau hapus pada
   implementasi — akan dicatat sebagai deviasi bila dihapus.
8. Publikasi perdana tidak bisa diuji terhadap konsumen nyata selain instalasi tarball lokal.

---

## 10. Minta persetujuan

Belum ada kode yang diubah. Bila setuju, balas **"setuju"**; saya implementasikan D1–D12, menjalankan
seluruh verifikasi di §7, lalu melaporkan hasil beserta deviasi. Publikasi ke npm tetap langkah Anda
(atau workflow dengan `NPM_TOKEN`).

---

## 11. Catatan implementasi

1. **Org `notifhub` sudah dibuat di npm** oleh pemilik akun; `npm org ls notifhub` mengembalikan
   `hamdanidev - owner`, sehingga scope `@notifhub` dapat dipakai.
2. **Manifest diperbarui** sesuai §4: metadata rilis, `engines`, `publishConfig.access=public`,
   `prepack`, dan `keywords` pada kedua paket. `@notifhub/react` sekarang memakai
   `"@notifhub/js": "^0.3.0"`, bukan `file:`.
3. **Workspace tetap me-link lokal**: `npm ls @notifhub/js` menunjukkan
   `@notifhub/js@0.3.0 -> packages/js-sdk` dan react memakai versi yang sama (deduped).
4. **`packages/react/package-lock.json` dihapus.** File itu masih menunjuk `file:../js-sdk` dan
   tidak dipakai karena `packages/react` adalah workspace (lockfile root yang berlaku). Ini deviasi
   kecil dari §9.7 (opsi "hapus" dipilih).
5. **Isi tarball** (8 file, tanpa `src`/`test`/`tsconfig`):
   - `@notifhub/js` 46,0 kB (`index.js`, `index.cjs`, kedua `.d.ts`, sourcemap, README, package.json)
   - `@notifhub/react` 9,2 kB (struktur sama)
6. **Uji konsumen dari tarball** (proyek bersih, bukan workspace):
   - js: `require('@notifhub/js')` (CJS), `import` (ESM), dan `tsc --noEmit` dengan tipe
     `NotifHubClient`/`SubscriberPreferences` → lulus.
   - react: `require`/`import` mengekspor `NotifHubProvider`, `NotificationBell`, `NotificationInbox`,
     `useNotifHub`, `usePreferences`; SSR `renderToStaticMarkup(<NotificationBell />)` menghasilkan
     markup dengan jumlah unread; `tsx` + `tsc --noEmit` → lulus.
7. **Dry-run publish** kedua paket lulus (`npm publish --dry-run --workspace ... --access public`),
   termasuk `prepack` yang membangun `dist`.
8. **Publish nyata tertahan 2FA**: `npm publish` mengembalikan
   `E403 Two-factor authentication or granular access token with bypass 2fa enabled is required`.
   Akun `hamdanidev` memakai 2FA, jadi publish memerlukan salah satu dari:
   - OTP saat publish: `npm publish ... --otp=<kode>`;
   - granular access token dengan izin publish + bypass 2FA (token ini yang dipakai sebagai
     `NPM_TOKEN` di workflow);
   - mengubah mode 2FA menjadi auth-only (tidak disarankan).
9. **Workflow** `.github/workflows/publish-npm.yml` ditambahkan: `workflow_dispatch` dengan input
   `package` (`js`/`react`) dan `dry_run`, guard tag `js-v<version>`/`react-v<version>`,
   `--provenance`, dan `NPM_TOKEN` sebagai kredensial.
10. **Sisa langkah**: publish `@notifhub/js` 0.3.0 lalu `@notifhub/react` 0.2.0 (urutan ini wajib),
    buat tag `js-v0.3.0` dan `react-v0.2.0`, lalu verifikasi `npm view` + instalasi dari registry.
