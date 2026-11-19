# Desain sample frontend in-app NotifHub

Status: **terimplementasi dan terverifikasi** pada 2026-11-16. Persetujuan diberikan setelah draf
D1–D6; verifikasi runtime memakai HTTP/SSE/DB dan SDK, tanpa browser automation.
Tanggal: 2026-11-16. Bahasa: Indonesia.

Dokumen ini merancang sample React 18 untuk fitur notifikasi in-app memakai paket npm yang sudah
terbit, `@notifhub/js@0.3.0` dan `@notifhub/react@0.2.0`. Sample bersifat demonstrasi lokal, bukan
starter produksi dan bukan bagian dari paket yang dipublikasikan.

**Isi dokumen**

- [1. Tujuan](#1-tujuan)
- [2. Non-tujuan](#2-non-tujuan)
- [3. Kondisi awal yang dimanfaatkan](#3-kondisi-awal-yang-dimanfaatkan)
- [4. Arsitektur](#4-arsitektur)
- [5. Keputusan desain](#5-keputusan-desain)
- [6. Kontrak middleware dev](#6-kontrak-middleware-dev)
- [7. Alur UI dan state](#7-alur-ui-dan-state)
- [8. Struktur file](#8-struktur-file)
- [9. Dependency sample](#9-dependency-sample)
- [10. TypeScript dan kualitas kode](#10-typescript-dan-kualitas-kode)
- [11. Rencana verifikasi](#11-rencana-verifikasi)
- [12. Batasan dan deviasi yang akan dicatat](#12-batasan-dan-deviasi-yang-akan-dicatat)
- [13. Kriteria penerimaan](#13-kriteria-penerimaan)
- [14. Persetujuan](#14-persetujuan)
- [15. Catatan implementasi dan hasil verifikasi](#15-catatan-implementasi-dan-hasil-verifikasi)

---

## 1. Tujuan

1. Menunjukkan integrasi end-user yang benar: browser hanya memegang **subscriber JWT**, tidak
   pernah API key atau admin JWT.
2. Mendemonstrasikan komponen headless `@notifhub/react` (`NotifHubProvider`, `NotificationBell`,
   `NotificationInbox`, `useNotifHub`, `usePreferences`) tanpa framework CSS.
3. Menunjukkan alur nyata end-to-end: sesi → SSE → notifikasi real-time → read receipt →
   preference center → enforcement preferensi di backend.
4. Menyediakan bukti bahwa API key dan secret tenant tidak masuk bundle browser.
5. Menjadi contoh yang bisa dijalankan ulang di lokal dan ikut dibangun di CI.

## 2. Non-tujuan

- Tidak mengubah backend, schema Prisma, endpoint, OpenAPI, atau perilaku lane autentikasi.
- Tidak mengubah `packages/js-sdk` maupun `packages/react`, versi, atau isi npm.
- Tidak membuat sample menjadi npm workspace atau dependency paket terbit.
- Tidak membuat UI produksi (auth nyata, refresh token, multi-device session, deployment).
- Tidak memakai Playwright/browser automation.
- Tidak menambah dependency backend.

---

## 3. Kondisi awal yang dimanfaatkan

| Hal | Nilai yang dipakai |
|---|---|
| Backend | `http://127.0.0.1:3000` (dapat dioverride lewat env sample) |
| SDK | `@notifhub/js@^0.3.0`, `@notifhub/react@^0.2.0` dari registry npm |
| React | `react@^18.3.1`, `react-dom@^18.3.1` (peer `@notifhub/react` adalah `>=18 <19`) |
| Template seed | `test.notification` untuk channel `inapp` dan `email` |
| Recipient seed | `user-test-1`, tenant `default` |
| Token dev | `scripts/dev-subscriber-token.mjs` (menandatangani dengan secret API key tenant) |
| API key dev | `SERVICE_API_KEY` di `.env` root, hanya dibaca server-side |
| Endpoint | notify, list in-app, read receipt, SSE, GET/PUT preferences (tidak ada endpoint baru) |

Sample memakai **seed dan API key tenant yang sudah ada**. Jika tenant bukan `default` atau API key
tidak punya secret subscriber, sample akan menampilkan error yang jelas; tidak ada fallback diam-diam.

---

## 4. Arsitektur

```text
Browser (http://127.0.0.1:5174)
  ├─ React 18 + Vite, tanpa Bootstrap
  ├─ @notifhub/js  ── Authorization: Bearer <subscriber JWT> ──┐
  │                                                            │
  └─ /dev/session, /dev/notify (hanya dev, same-origin)        │
             │                                                 │
             ▼                                                 ▼
  Vite dev server (:5174) ── proxy /api ───────────────► Backend NestJS (:3000)
  │                                                           │
  ├─ POST /dev/session: spawn helper token (server-side) ─────┤ Prisma/DB
  └─ POST /dev/notify: X-API-Key dari .env root ─────────────► POST /api/v1/notify

Secret yang hanya ada di proses Vite/backend:
  SERVICE_API_KEY, SUBSCRIBER_JWT_SECRET / subscriberJwtSecret tenant, DATABASE_URL.
Browser tidak pernah menerima nilai-nilai tersebut.
```

Prinsipnya:

- Browser memanggil path relatif `/api/v1/...`; Vite mem-proxy ke backend. Tidak ada perubahan CORS.
- Middleware Vite hanya hidup saat `vite` (command `serve`), bukan saat `build` maupun `preview`.
- Token diterbitkan server-side oleh helper repo yang sudah ada, sehingga aturan secret per tenant
  tetap sama dengan backend.
- API key tidak pernah dikirim ke browser dan tidak masuk bundle; middleware yang menambahkan header
  `X-API-Key` saat memanggil backend.

---

## 5. Keputusan desain

### D1 — Cara menerbitkan token subscriber

**Default: middleware Vite dev, bukan tempel token manual.**

- `GET /dev/session` (query) dan `POST /dev/session` (JSON) meminta middleware menjalankan
  `scripts/dev-subscriber-token.mjs <recipientId> <tenant>` sebagai child process.
- Helper membaca secret tenant dari `ApiKey.subscriberJwtSecret` (fallback
  `SUBSCRIBER_JWT_SECRET`), sama seperti verifikasi backend. Tidak ada duplikasi logika secret.
- Middleware mengembalikan token + `expiresAt` (dibaca dari klaim `exp`, bukan dari secret).
- Token disimpan di `sessionStorage` agar sesi bertahan saat halaman di-refresh, dan dibersihkan
  saat tombol **Keluar** ditekan. Ini bukan penyimpanan jangka panjang dan hanya untuk sample.
- Tidak ada input token manual di UI. Untuk troubleshooting, README mencantumkan fallback manual
  memakai `npm run dev:subscriber-token`, tetapi sample tetap memakai middleware.

Alasan: memenuhi aturan “token dibuat server-side”, memakai jalur secret yang benar, dan tidak
menambah dependency kripto/DB ke sample. Konsekuensi: root `npm install`, PostgreSQL, dan `.env`
harus siap saat sample dijalankan; jika tidak, endpoint sesi mengembalikan pesan yang menjelaskan
prasyaratnya.

### D2 — Cakupan preferensi

**Default: toggle enabled + quiet hours opsional, disimpan per channel; timezone hanya ditampilkan.**

- Tiga channel selalu tampil: `inapp`, `email`, `whatsapp`.
- Setiap kartu channel punya checkbox enabled, checkbox “Aktifkan quiet hours”, input `start`/`end`
  bertipe `time`, dan tombol **Simpan channel**.
- Bila quiet hours tidak dicentang, `quietHoursStart`/`quietHoursEnd` tidak dikirim (full snapshot
  menghapus nilai lama).
- Timezone tidak diedit; nilai dari `SubscriberPreferences.timezone` ditampilkan sebagai konteks.
- Untuk `inapp`, UI menjelaskan konsekuensi mematikan channel: notifikasi in-app baru tidak dikirim.
- Validasi klien: dua jam harus terisi bersama, format `HH:mm`, dan `start !== end`; backend tetap
  menjadi otoritas validasi.

Alasan: quiet hours adalah bagian penting dari preference center dan sudah didukung SDK + backend.
Mengedit timezone per channel menambah kompleksitas validasi IANA tanpa nilai demo yang sebanding.

### D3 — Test otomatis sample

**Default: tidak menambahkan Vitest; verifikasi sample = `typecheck` + `build` + skenario end-to-end
manual/protokol.**

- Helper murni (parsing error, format waktu, validasi form) dijaga kecil dan diverifikasi lewat
  typecheck serta skenario nyata.
- Vitest/Testing Library/jsdom tidak ditambahkan ke sample karena menambah dependency dan tidak
  menguji bagian paling berisiko (middleware dev, SSE, secret).
- Skenario E2E diverifikasi lewat HTTP/DB dan stream SSE nyata, bukan hanya kompilasi.

Alasan: sesuai prinsip “jangan menambah dependency tanpa alasan kuat”; nilai utama sample adalah
integrasi nyata dengan backend. Bila nanti sample tumbuh, Vitest dapat ditambahkan sebagai pekerjaan
terpisah.

### D4 — Integrasi CI

**Default: langkah sample ditambahkan ke job `packages` yang sudah ada, bukan job baru.**

Urutan baru di job `packages` setelah React bindings:

```yaml
- name: In-app sample
  run: |
    npm --prefix sample/in-app-web ci
    npm run typecheck --prefix sample/in-app-web
    npm run build --prefix sample/in-app-web
```

- Sample punya `package-lock.json` sendiri; `npm ci` memasang paket npm terbit, bukan `file:` ke
  `packages/`.
- Tidak perlu service Postgres/Redis karena CI hanya membangun sample; dev middleware tidak
  dijalankan.
- Job terpisah tidak dipakai agar tidak menambah runner dan waktu antrean.

### D5 — Styling dan struktur halaman

**Default: satu halaman, dua tab (`Kotak masuk` dan `Preferensi`), CSS biasa tanpa Bootstrap.**

- Header aplikasi: nama sample, badge status SSE, `NotificationBell`, jumlah unread, identitas sesi,
  tombol **Keluar**.
- Tab Inbox: panel pengirim notifikasi uji (dev) + daftar notifikasi headless.
- Tab Preferensi: tiga kartu channel dari `usePreferences`.
- Tanpa React Router; tab dikelola `useState` dan tombol ber-ARIA (`role="tab"`).
- CSS ditulis sendiri (variabel warna netral, layout responsif sederhana) agar terlihat jelas bahwa
  komponen `@notifhub/react` tidak membawa style.

### D6 — CORS/proxy dev

**Default: proxy Vite `/api` ke backend; tidak mengubah `CORS_ORIGINS`.**

- `NotifHubClient` dibuat dengan `baseUrl: window.location.origin`, sehingga request menjadi
  same-origin:
  `/api/v1/in-app/notifications`, `/api/v1/in-app/stream`, `/api/v1/subscriber/preferences`.
- Vite `server.proxy['/api']` menargetkan `http://127.0.0.1:3000` (dapat dioverride).
- Dev server mengikat `127.0.0.1:5174`, port berbeda dari console (`5173`), `strictPort: true`.
- Middleware `/dev/*` berada di origin yang sama, jadi tidak perlu CORS untuk sample.
- Backend URL sample dapat dioverride lewat `NOTIFHUB_SAMPLE_API_URL`; default mengikuti `PORT`
  root atau 3000.

Alasan: menghindari konfigurasi CORS tambahan, tetap memakai header `Authorization` untuk SSE, dan
tidak mengubah lingkungan backend.

---

## 6. Kontrak middleware dev

Semua endpoint hanya didaftarkan pada plugin Vite dengan `apply: 'serve'` dan hanya menerima
same-origin request dari dev server lokal. Body dibatasi (16 KB), method selain yang didukung
dibalas `405`, dan error tidak memuat stack trace, token, API key, atau isi `.env`.

### 6.1 `GET/POST /dev/session`

Request `POST`:

```json
{ "recipientId": "user-test-1", "tenant": "default" }
```

Request `GET`:

```text
/dev/session?recipientId=user-test-1&tenant=default
```

Aturan:

- `recipientId` wajib, 1–128 karakter, pola aman `[A-Za-z0-9][A-Za-z0-9._:-]*`.
- `tenant` opsional; default `DEFAULT_TENANT_ID` dari `.env` root, fallback `default`; 1–64 karakter.
- Middleware memanggil helper token dengan argumen yang sudah divalidasi (tanpa shell), cwd root repo,
  dan environment root `.env`. Token TTL mengikuti helper: 1 jam.
- `expiresAt` dihitung dari payload JWT yang baru dibuat (bukan rahasia).

Response `200`:

```json
{
  "token": "<subscriber-jwt>",
  "tokenType": "Bearer",
  "recipientId": "user-test-1",
  "tenant": "default",
  "expiresAt": "2026-11-16T12:14:38.000Z"
}
```

Error:

| Status | Kondisi |
|---|---|
| `400` | field tidak valid / JSON rusak |
| `405` | method tidak didukung |
| `413` | body terlalu besar |
| `502` | helper gagal (mis. DB tidak siap); pesan menyebut prasyarat, tanpa detail secret |

### 6.2 `POST /dev/notify`

Request:

```json
{
  "recipientId": "user-test-1",
  "channel": "inapp",
  "name": "Budi"
}
```

Aturan:

- `channel` ∈ `inapp | email | whatsapp`.
- `name` opsional, maksimal 80 karakter; dipakai sebagai `data.nama` untuk template
  `test.notification`.
- Middleware membentuk body backend sendiri:
  `idempotency_key` unik (`sample-<timestamp>-<uuid>`), `template_key: "test.notification"`,
  `recipients: [recipientId]`, `channels: [channel]`, `data: { nama }`, `priority: "normal"`.
- Header `X-API-Key` hanya ditambahkan server-side dari `SERVICE_API_KEY`.
- Tenant **tidak** dikirim di body; backend menentukan tenant dari API key. Ini menjaga aturan lane
  ingest.
- Timeout panggilan backend 10 detik. Error backend diteruskan secara terbatas: status, message,
  `requestId`; tidak ada header atau secret.

Response sukses `202` (diteruskan):

```json
{ "notification_id": "<uuid>", "status": "accepted" }
```

Response error:

```json
{
  "error": {
    "status": 503,
    "message": "Queue backend tidak tersedia",
    "requestId": "..."
  }
}
```

UI menampilkan `status`, message, dan `requestId` bila ada. Untuk channel email/WhatsApp, UI
mengingatkan bahwa development bersifat log-only; keberhasilan berarti notifikasi diterima dan
diproses, bukan email/WhatsApp benar-benar terkirim.

### 6.3 Batas keamanan middleware

- Hanya aktif di dev (`apply: 'serve'`); `vite build` tidak menyertakan middleware.
- Dev server hanya `127.0.0.1`, bukan `0.0.0.0`.
- Tidak ada reflection token/secret ke response, log, atau pesan error.
- Request body dan field divalidasi sebelum dipakai.
- Helper dijalankan via `execFile` (tanpa shell), dengan argumen tervalidasi dan `maxBuffer`/timeout.
- README menyatakan tegas: middleware ini **hanya untuk sample lokal**, bukan pola produksi.

---

## 7. Alur UI dan state

### 7.1 Gate sesi

Saat belum ada sesi:

- Form `recipientId` (default `user-test-1`) dan `tenant` (default `default`).
- Tombol **Mulai** memanggil `POST /dev/session`.
- Loading: tombol disabled + teks “Menerbitkan token…”.
- Error: pesan spesifik (mis. “Gagal menerbitkan token. Pastikan PostgreSQL, migrasi/seed, dan
  `.env` root sudah siap.”).
- Catatan keamanan: token hanya di `sessionStorage`, API key tidak ada di browser.

Saat sesi ada:

- Ringkasan `recipientId`, tenant, waktu kedaluwarsa token.
- `NotifHubClient` dibuat dari token tersebut; satu instance per sesi.
- `NotifHubProvider` di-mount dengan `key` sesi + epoch koneksi.
- Tombol **Keluar** menutup provider, memanggil `client.close()`, dan menghapus `sessionStorage`.

### 7.2 Status SSE dan reconnect

`useNotifHub()` memberi `status: 'connecting' | 'open' | 'closed'`.

| Status | UI |
|---|---|
| `connecting` | badge kuning “Menghubungkan…” + spinner kecil |
| `open` | badge hijau “SSE terhubung” |
| `closed` | badge merah “SSE terputus” + tombol **Sambungkan ulang** |

- **Sambungkan ulang** menaikkan epoch sehingga provider di-mount ulang dengan token yang sama.
- Bila error `unauthorized` (401) diterima, tampil panel “Sesi tidak valid/kedaluwarsa” dengan tombol
  **Perbarui token & sambungkan** yang memanggil ulang `/dev/session` untuk recipient/tenant yang
  sama, menyimpan token baru, lalu me-mount ulang provider.
- Ada alat uji dev **Simulasikan 401** yang mengganti token di sesi dengan token yang sengaja
  dirusak (suffix acak), lalu reconnect. Ini memverifikasi jalur 401 tanpa menunggu satu jam; jalur
  token benar-benar kedaluwarsa memakai penanganan error yang sama.
- Error 429 ditampilkan sebagai “Terlalu banyak permintaan (429)” dengan durasi tunggu bila
  `retryAfterMs` tersedia.

### 7.3 Inbox dan markRead

- `NotificationInbox` dipakai dengan `renderItem` kustom agar klik bisa menangani error.
- Setiap item menampilkan body, waktu, status baca, dan `notificationId` (untuk verifikasi DB).
- Klik item memanggil `markRead(notificationId)` dari `useNotifHub()`:
  - item masuk state pending (teks “Menandai dibaca…”),
  - sukses: provider memperbarui `status: 'read'` + `readAt`, unread count turun, muncul notice
    “Ditandai dibaca”,
  - gagal: error tampil di dekat item; item tidak berubah secara lokal.
- Read receipt bersifat idempoten; item yang sudah dibaca tetap bisa diklik dan backend mengembalikan
  waktu baca pertama.
- Keadaan kosong: “Belum ada notifikasi. Kirim notifikasi uji untuk melihat SSE bekerja.”
- Keadaan loading daftar awal ditampilkan saat provider masih `connecting` dan daftar kosong.

### 7.4 Pengiriman notifikasi uji

- Panel “Kirim notifikasi uji” berisi input nama, pilihan channel, dan tombol **Kirim**.
- Tombol memanggil `POST /dev/notify`; tidak ada API key di request browser.
- Sukses: tampilkan notification id + status `accepted`; untuk `inapp`, item harus muncul tanpa
  refresh lewat SSE.
- Error: status dan message dari backend, mis. `401` API key salah, `429` rate limit, `503` Redis
  mati.
- Tombol dinonaktifkan selama request berjalan untuk mencegah spam.

### 7.5 Preference center

- `usePreferences(client)` dipakai eksplisit, tidak perlu SSE.
- Loading: tiga skeleton/kartu “Memuat preferensi…”.
- Error: banner dengan tombol **Muat ulang**; untuk 401, tombol **Perbarui sesi**.
- Setiap channel:
  - toggle enabled (draft lokal, belum tersimpan),
  - quiet hours opsional,
  - tombol **Simpan channel** (disabled bila tidak ada perubahan/invalid),
  - status “Tersimpan” + waktu update,
  - badge “Default” bila `isDefault`.
- Setelah `update()` sukses, draft disinkronkan dengan respons backend dan snapshot hook ikut
  diperbarui.
- Catatan UI: mematikan `email` membuat notifikasi email berikutnya `skipped`
  (`preference_disabled`); mematikan `inapp` membuat notifikasi in-app baru tidak dikirim.

---

## 8. Struktur file

### 8.1 Baru — `sample/in-app-web/`

| File | Isi |
|---|---|
| `package.json` | private, script `dev/build/typecheck/preview`, dependency npm terbit, engine Vite |
| `package-lock.json` | lockfile terpisah (bukan workspace) |
| `scripts/build.mjs` | wrapper build: `NODE_ENV=production` sebelum `tsc` + Vite |
| `index.html` | entry Vite |
| `tsconfig.json` | strict, React JSX, `vite/client`, `node` (untuk config) |
| `vite.config.ts` | React plugin, proxy `/api`, dev middleware `/dev/session` dan `/dev/notify` |
| `src/main.tsx` | mount React 18 |
| `src/App.tsx` | gate sesi, client per sesi, provider, renew/reconnect/401 test |
| `src/dev-api.ts` | tipe + fetch `/dev/*`, parsing error ketat |
| `src/session.ts` | tipe sesi, baca/tulis/hapus `sessionStorage`, validasi `expiresAt` |
| `src/errors.ts` | pemetaan `NotifHubError`/error dev ke pesan UI 401/429/network |
| `src/format.ts` | format tanggal/waktu, label channel, short id |
| `src/components/Landing.tsx` | hero dan gate sesi |
| `src/components/SessionForm.tsx` | form penerbitan sesi |
| `src/components/Workspace.tsx` | header, bell, unread, status SSE, tab, logout |
| `src/components/InboxPanel.tsx` | panel kirim uji + inbox + markRead |
| `src/components/NotificationRow.tsx` | item headless, status baca, error lokal |
| `src/components/PreferenceCenter.tsx` | kartu tiga channel + quiet hours |
| `src/components/ConnectionBadge.tsx` | indikator connecting/open/closed |
| `src/components/ErrorNotice.tsx` | banner error + aksi |
| `src/styles.css` | styling CSS murni, responsif, tanpa Bootstrap |
| `README.md` | prasyarat, perintah, skenario uji, troubleshooting, peringatan dev-only |

### 8.2 Diubah di root (setelah implementasi)

| File | Perubahan |
|---|---|
| `.github/workflows/ci.yml` | langkah install/typecheck/build sample di job `packages` |
| `README.md` | baris `sample/in-app-web/` di repository layout, link desain, perintah verifikasi |
| `docs/usage/end-user.md` | tautan ke sample di bagian React |
| `docs/architecture/project-brief.md` | peta repository, status kapabilitas, perintah sample, batasan dev-only |
| `docs/design/sample-in-app-design.md` | status dan catatan implementasi/verifikasi |

Tidak ada perubahan pada `src/`, `prisma/`, `packages/`, `console/`, `sdk/go/`, atau
`openapi/notifhub.json`.

---

## 9. Dependency sample

```json
{
  "dependencies": {
    "@notifhub/js": "^0.3.0",
    "@notifhub/react": "^0.2.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/react": "^18.3.31",
    "@types/react-dom": "^18.3.7",
    "@vitejs/plugin-react": "^6.3.0",
    "typescript": "~5.9.3",
    "vite": "^8.3.8"
  }
}
```

- `@types/node` diperlukan untuk `vite.config.ts` (child process, path, buffer), bukan dependency
  runtime.
- Tidak ada `file:` ke `packages/`; sample memvalidasi artefak npm yang benar-benar dipakai
  konsumen.
- Tidak ada dependency UI/CSS/router/state management.

---

## 10. TypeScript dan kualitas kode

- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitAny: true`; tidak ada `any` eksplisit.
- Response JSON dari `/dev/*` dan error backend divalidasi dengan type guard sebelum dipakai.
- `unknown` dipakai untuk input eksternal; error dipetakan ke union type yang sempit.
- Semua tombol async memiliki state pending dan pesan error yang bisa ditindaklanjuti.
- Tidak ada `console.log` token, API key, body sensitif, atau header Authorization.
- Token tidak pernah masuk URL/query string; selalu header `Authorization`.
- `.env` root tidak di-commit; sample hanya membaca env di proses Vite, bukan di browser.

---

## 11. Rencana verifikasi

Verifikasi dilakukan setelah implementasi dan disetujui; tidak ada klaim lulus sebelum dijalankan.

### 11.1 Build dan typecheck

```powershell
npm --prefix sample/in-app-web ci
npm run typecheck --prefix sample/in-app-web
npm run build --prefix sample/in-app-web
```

Kriteria: exit code `0`, tidak ada error TypeScript, `sample/in-app-web/dist/` terbentuk.

### 11.2 Pemeriksaan bundle bebas secret

```powershell
Get-ChildItem sample/in-app-web/dist -Recurse -File |
  Select-String -Pattern 'SERVICE_API_KEY','SUBSCRIBER_JWT_SECRET','dev-api-key-change-in-prod'
```

Kriteria: tidak ada hasil. Pemeriksaan juga mencakup `SERVICE_API_KEY` dan secret tenant yang
mungkin muncul di source map; source map tidak dihasilkan pada build sample.

### 11.3 Backend dan sample berjalan

```powershell
npm run infra:up
npx prisma migrate deploy
npx prisma db seed
npm run start:dev          # terminal 1
npm --prefix sample/in-app-web run dev  # terminal 2, http://127.0.0.1:5174
```

Kriteria: `GET /health/ready` `200`; sample merender form sesi; tidak ada error startup Vite.

### 11.4 Skenario protokol/end-to-end (tanpa browser automation)

Karena Playwright tidak dipakai, verifikasi dilakukan pada kontrak yang sama dengan yang dipanggil
UI, ditambah langkah browser manual untuk tampilan:

1. **Sesi**: `POST /dev/session` dengan `user-test-1/default` → `200`, token ada, `expiresAt` wajar.
2. **SSE**: buka `GET /api/v1/in-app/stream` memakai token (Node fetch/PowerShell), lalu
   `POST /dev/notify` channel `inapp`. Bukti: event `notification` dengan body template muncul tanpa
   reconnect.
3. **markRead**: panggil endpoint read untuk notification id yang sama; bukti UI state (manual) dan
   query DB:
   ```sql
   SELECT status, "readAt" FROM "NotificationRecipient"
   WHERE "notificationId" = '<uuid>' AND channel = 'inapp';
   ```
   Kriteria: `status='read'`, `readAt` terisi.
4. **Preferensi**: PUT `email` enabled=false lewat UI/endpoint, lalu kirim email:
   ```sql
   SELECT channel, status, "lastError" FROM "NotificationRecipient"
   WHERE "notificationId" = '<uuid>';
   ```
   Kriteria: `status='skipped'`, `lastError='preference_disabled'`.
5. **401**: gunakan token yang diubah (suffix acak) ke list/SSE → `401`; token yang ditandatangani
   dengan `exp` di masa lalu juga diuji → `401`. Setelah `/dev/session` baru, request valid → `200`
   dan SSE kembali `open`.
6. **429**: kirim request preference lebih dari 60 kali dalam satu menit → `429`; UI memetakan pesan
   rate limit. Pengujian dilakukan setelah skenario lain selesai.
7. **Loading/kosong**: sesi baru tanpa notifikasi menampilkan empty state; refresh/preferensi
   menampilkan loading state.

### 11.5 Regresi

```powershell
npm run ci
npm run sdk:test
npm run react:test
npm run console:build
```

Semua harus tetap hijau dan tidak ada perubahan output paket. `npm run ci` memerlukan infra dan
database test; jika Docker tidak tersedia, dilaporkan sebagai batasan lingkungan, bukan lulus palsu.

### 11.6 CI

- Workflow YAML divalidasi secara sintaks (indentasi dan urutan langkah).
- Jalankan langkah sample secara lokal dengan perintah yang sama seperti CI.
- Tidak mengklaim GitHub Actions berjalan bila belum di-push; status remote dilaporkan apa adanya.

---

## 12. Batasan dan deviasi yang akan dicatat

1. **Dev-only**: middleware `/dev/*` dan proxy hanya ada saat `vite`. `npm run build` hanya
   memvalidasi kompilasi; hasil build statis tidak bisa dipakai sebagai aplikasi produksi tanpa
   backend token/notify yang sesungguhnya.
2. **Token di `sessionStorage`**: nyaman untuk sample, tetapi bearer token tetap rentan bila ada XSS.
   Produksi harus memakai strategi token milik aplikasi consumer.
3. **TTL token 1 jam** mengikuti helper repo. UI menampilkan waktu kedaluwarsa dan menangani 401;
   uji 401 memakai token yang diubah dan token yang ditandatangani dengan `exp` lampau, tanpa
   menunggu satu jam.
4. **Tanpa browser automation**: verifikasi UI yang terlihat dilakukan manual; bukti otomatis
   berfokus pada HTTP, SSE, dan DB. Screenshot bukan deliverable.
5. **Email/WhatsApp log-only di development**: channel dapat diuji untuk preferensi dan status,
   bukan pengiriman nyata.
6. **Tanpa pagination UI**: provider memuat maksimal 50 notifikasi; inbox menampilkan 20 terbaru.
7. **Tenant mengikuti API key**: `/dev/notify` tidak memilih tenant dari body. Sample efektif
   memakai tenant milik `SERVICE_API_KEY`; token dengan tenant lain akan ditolak backend.
8. **Sample tidak masuk npm workspace** dan tidak memengaruhi `npm install` root.
9. **Helper token butuh DB**: jika Postgres mati, sesi gagal dengan pesan prasyarat; sample tidak
   membuat token dengan secret global secara diam-diam.
10. **Rate limit 429** diuji dengan 70 request preferences berurutan: 60 mendapat `200`, 10 mendapat
    `429`; pengujian dilakukan setelah skenario lain selesai.
11. **Windows dan `npm ci`**: menjalankan `npm ci` saat dev server Vite masih hidup dapat gagal
    `EPERM` karena binary native `rolldown` terkunci. Hentikan dev server terlebih dahulu; ini
    dicatat di troubleshooting README sample.

---

## 13. Kriteria penerimaan

- [ ] `sample/in-app-web/` ada, private, punya `package-lock.json` sendiri, dan tidak masuk workspace.
- [ ] Dependency sesuai §9; tidak ada `file:` ke `packages/`.
- [ ] Form sesi memakai middleware; API key dan secret tidak ada di browser/bundle.
- [ ] Bell, unread count, status SSE, dan reconnect berfungsi.
- [ ] Notifikasi uji muncul lewat SSE tanpa refresh.
- [ ] Klik item menandai dibaca di UI dan DB.
- [ ] Tiga channel preferensi tampil; toggle + quiet hours tersimpan per channel.
- [ ] Email yang dimatikan menghasilkan `skipped`/`preference_disabled`.
- [ ] 401/429/loading/empty/error state punya pesan jelas dan aksi pemulihan.
- [ ] `typecheck` dan `build` lulus; grep bundle bersih.
- [ ] CI job `packages` membangun sample.
- [ ] README sample, README root, dan `docs/usage/end-user.md` diperbarui.
- [ ] Regresi backend/SDK/React/console tetap hijau.
- [ ] Laporan akhir memuat perintah, status, output ringkas, deviasi, batasan, dan kondisi lingkungan.

---

## 14. Persetujuan

Persetujuan diterima (balasan **“setuju”**) dan implementasi dilanjutkan sesuai D1–D6. Perubahan
keputusan setelah persetujuan dicatat di §15.

---

## 15. Catatan implementasi dan hasil verifikasi

### 15.1 Deviasi implementasi

1. **Build wrapper `scripts/build.mjs`.** Saat `NODE_ENV` tidak diset, `@vitejs/plugin-react`
   memilih runtime `jsxDEV` walau `vite build` berjalan. Wrapper menetapkan `NODE_ENV=production`
   sebelum Vite mulai, sehingga bundle memakai JSX production dan tidak memuat path source absolut.
   Tidak ada dependency baru.
2. **D3 tetap tanpa Vitest.** Skenario end-to-end dijalankan lewat HTTP/SSE/DB dan SDK, bukan test
   runner sample.
3. **Uji 401** memakai dua bentuk: token yang diubah dan token bertanda tangan valid dengan `exp`
   lampau. UI menangani keduanya lewat `NotifHubError.code === 'unauthorized'`.
4. **Verifikasi visual** tidak diotomasi (tanpa Playwright); halaman dirender oleh Vite dan
   komponen lolos typecheck/build. Interaksi browser tetap langkah manual pemilik proyek.
5. **README sample** ikut menjelaskan wrapper build dan batas dev-only. Project brief juga
   diperbarui agar peta repository tidak lagi menyatakan sample belum ada.

### 15.2 Bukti verifikasi

| Pemeriksaan | Hasil |
|---|---|
| `npm --prefix sample/in-app-web ci` | 30 paket, 0 vulnerability |
| `npm run typecheck --prefix sample/in-app-web` | exit `0`, tanpa error TS |
| `npm run build --prefix sample/in-app-web` | sukses; JS production ±185 KB, `jsxDEV` absen |
| Scan `dist/` untuk marker secret dan nilai `.env` aktual | tidak ada hasil |
| SSR smoke lewat Vite `ssrLoadModule` | landing dan workspace ter-render tanpa error |
| Runtime mapping error | `401` → “Sesi tidak valid atau kedaluwarsa”; `429` → “Terlalu banyak permintaan” + durasi |
| `POST /dev/session` | `200`, klaim `sub/tenant/exp` valid, TTL 1 jam |
| `POST /dev/notify` in-app | `202 accepted` |
| SSE melalui proxy Vite | event `notification` dengan body template muncul tanpa refresh |
| `markRead` + list | `200`; status item `read`, `readAt` terisi |
| DB `NotificationRecipient` | `status=read`, `readAt` terisi |
| SDK `@notifhub/js` lewat proxy | subscribe `open`, event diterima, `markRead`/list `read` |
| Preferensi email `enabled=false` + notify email | DB `skipped` / `preference_disabled` |
| Preferensi quiet hours `22:00–07:00` | tersimpan dan dikembalikan API; lalu dikembalikan ke default |
| Token diubah ke list/SSE | `401` / `401` |
| Token `exp` lampau | `401`; token valid baru `200` |
| 70 request preferences | 60 × `200`, 10 × `429` (mulai request ke-61) |
| `npm run ci` | lulus 5 langkah; 10/10 e2e |
| `npm run sdk:test` | 23/23 lulus |
| `npm run react:test` | 4/4 lulus |
| `npm run console:build` | sukses (warning chunk size sudah ada) |

Lingkungan: Windows, Node `v24.16.0`, npm `11.13.0`, Docker PostgreSQL 16/Redis 7 `healthy`,
backend NestJS di `127.0.0.1:3000`, sample Vite di `127.0.0.1:5174`.

### 15.3 Status kriteria penerimaan

- [x] `sample/in-app-web/` ada, private, punya `package-lock.json` sendiri, tidak masuk workspace.
- [x] Dependency sesuai §9; tidak ada `file:` ke `packages/`.
- [x] Form sesi memakai middleware; API key dan secret tidak ada di browser/bundle.
- [x] Bell, unread count, status SSE, dan reconnect terpasang; status/event SSE terverifikasi lewat SDK.
- [x] Notifikasi uji muncul lewat SSE tanpa refresh.
- [x] Klik item memanggil markRead; API dan DB terverifikasi (interaksi klik di browser manual).
- [x] Tiga channel preferensi tampil; toggle + quiet hours tersimpan per channel.
- [x] Email yang dimatikan menghasilkan `skipped`/`preference_disabled`.
- [x] 401/429/loading/empty/error state punya pesan dan aksi pemulihan di kode.
- [x] `typecheck` dan `build` lulus; scan bundle bersih.
- [x] CI job `packages` membangun sample.
- [x] README sample, README root, `docs/usage/end-user.md`, dan project brief diperbarui.
- [x] Regresi backend/SDK/React/console hijau.
- [x] Laporan akhir memuat perintah, status, output ringkas, deviasi, batasan, dan kondisi lingkungan.
