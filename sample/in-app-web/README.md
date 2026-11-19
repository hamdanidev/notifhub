# NotifHub in-app sample (React 18 + Vite)

Sample lokal untuk fitur notifikasi in-app NotifHub: sesi end-user, bell, inbox, SSE, read
receipt, preference center, dan pengiriman notifikasi uji. Sample memakai paket npm yang sudah
terbit, bukan `file:` ke `packages/`:

- `@notifhub/js@0.3.0`
- `@notifhub/react@0.2.0` (peer React `>=18 <19`)
- React 18 + TypeScript strict + Vite
- CSS biasa; komponen `@notifhub/react` tetap headless

> **Hanya untuk lokal.** Middleware `/dev/*`, proxy Vite, dan sesi `sessionStorage` adalah alat
> demo. Jangan memakai pola ini di produksi. API key dan secret tenant hanya boleh berada di
> server aplikasi consumer.

---

## Prasyarat

1. Node.js `^20.19.0` atau `>=22.12.0` (repo dan CI memakai Node 24), npm.
2. Dependency root sudah terpasang:
   ```bash
   npm install
   ```
3. PostgreSQL dan Redis berjalan:
   ```bash
   npm run infra:up
   docker compose -f docker-compose.dev.yml ps
   ```
   Keduanya harus `healthy`.
4. `.env` root tersedia dan berisi minimal:
   - `DATABASE_URL`
   - `SERVICE_API_KEY` (API key tenant untuk lane ingest)
   - `SUBSCRIBER_JWT_SECRET` **atau** `subscriberJwtSecret` pada API key tenant
   - `DEFAULT_TENANT_ID` (opsional; fallback `default`)
5. Schema dan seed sudah diterapkan:
   ```bash
   npx prisma migrate deploy
   npx prisma db seed
   ```
6. Backend berjalan:
   ```bash
   npm run start:dev
   ```
   Cek `http://127.0.0.1:3000/health/ready` → `200`.

Sample membaca `.env` root lewat `loadEnv()` di proses Vite. File `.env` tidak di-commit dan
nilainya tidak pernah dikirim ke browser.

---

## Install dan jalankan

```bash
npm --prefix sample/in-app-web install
npm --prefix sample/in-app-web run dev
```

Buka **http://127.0.0.1:5174**. Port `5173` dipakai console; sample memakai `5174` dan
`strictPort: true`.

Default form:

- `recipientId`: `user-test-1`
- `tenant`: `default`

Klik **Mulai**. Token ditandatangani oleh helper repo `scripts/dev-subscriber-token.mjs` yang
dijalankan middleware Vite di server, memakai secret API key tenant (fallback
`SUBSCRIBER_JWT_SECRET`). Browser hanya menerima token dan waktu kedaluwarsanya.

Override alamat backend bila perlu:

```bash
$env:NOTIFHUB_SAMPLE_API_URL = 'http://127.0.0.1:3001'
npm --prefix sample/in-app-web run dev
```

Default target mengikuti `PORT` di `.env` root, lalu fallback `http://127.0.0.1:3000`.

---

## Yang bisa dicoba

### 1. Notifikasi in-app lewat SSE

1. Buka tab **Kotak masuk**.
2. Isi nama, pilih channel **In-app**, klik **Kirim notifikasi uji**.
3. Dalam beberapa detik item muncul di daftar tanpa refresh.
4. Badge SSE berubah menjadi **SSE terhubung**.

Middleware memanggil `POST /api/v1/notify` dengan header `X-API-Key` dari `.env` root. Browser
tidak pernah menerima API key.

### 2. MarkRead dan verifikasi DB

Klik item notifikasi. Provider memanggil `POST /api/v1/in-app/notifications/{id}/read`, unread
count turun, dan status item berubah menjadi **Dibaca**.

Verifikasi database:

```bash
docker exec -it notifhub-postgres psql -U notifhub -d notifhub_dev
```

```sql
SELECT status, "readAt"
FROM "NotificationRecipient"
WHERE "notificationId" = '<notification-id>' AND channel = 'inapp';
```

Harapan: `status = read`, `readAt` terisi.

### 3. Preferensi dan enforcement email

1. Buka tab **Preferensi**.
2. Pada kartu **Email**, matikan **Aktifkan channel ini**, lalu klik **Simpan channel**.
3. Kembali ke **Kotak masuk**, pilih channel **Email**, klik **Kirim notifikasi uji**.
4. Tunggu worker, lalu periksa DB:

```sql
SELECT channel, status, "lastError"
FROM "NotificationRecipient"
WHERE "notificationId" = '<notification-id>';
```

Harapan: `status = skipped`, `lastError = preference_disabled`.

Di development, email/WhatsApp bersifat **log-only**. Keberhasilan channel tersebut berarti
notifikasi diproses worker, bukan email/WhatsApp benar-benar terkirim.

### 4. Quiet hours

Di kartu channel, centang **Tunda notifikasi non-kritis pada jam tertentu**, isi jam mulai dan
selesai, lalu simpan. Quiet hours dikirim sebagai satu paket `quietHoursStart`/`quietHoursEnd`;
menghapus centang akan mengosongkan keduanya pada channel tersebut. Timezone mengikuti profil
subscriber/preferensi dan hanya ditampilkan di UI.

### 5. Menguji 401 dan pemulihan

Buka **Alat uji dev** di bawah ringkasan sesi, lalu klik **Simulasikan 401 (token diubah)**.
Token di sesi sengaja dirusak dan provider di-mount ulang. Backend membalas `401`, badge menjadi
**SSE terputus**, dan UI menampilkan panel sesi tidak valid.

Klik **Perbarui token & sambungkan**. Middleware menerbitkan token baru untuk recipient/tenant
yang sama, lalu koneksi SSE dibuka kembali. Token asli berlaku 1 jam; penanganan token yang
benar-benar kedaluwarsa memakai jalur `401` yang sama.

---

## Perintah build dan typecheck

```bash
npm --prefix sample/in-app-web ci
npm run typecheck --prefix sample/in-app-web
npm run build --prefix sample/in-app-web
```

`npm run build` memakai wrapper `scripts/build.mjs` yang menetapkan `NODE_ENV=production` sebelum
Vite mulai. Tanpa itu, `@vitejs/plugin-react` dapat memilih `jsxDEV` dan menyertakan path source
absolut di bundle.

`npm run preview` hanya menyajikan hasil build statis; `/dev/*` dan proxy `/api` tidak tersedia di
preview. Sample ini memang hanya berfungsi penuh lewat `npm run dev`.

---

## Bukti bundle tidak memuat secret

```powershell
$markers = 'SERVICE_API_KEY','SUBSCRIBER_JWT_SECRET','subscriberJwtSecret','dev-api-key-change-in-prod'
foreach ($marker in $markers) {
  Get-ChildItem sample/in-app-web/dist -Recurse -File |
    Select-String -Pattern $marker -SimpleMatch
}
```

Harapan: tidak ada hasil. Untuk pemeriksaan yang lebih kuat, bandingkan nilai aktual
`SERVICE_API_KEY` dan `SUBSCRIBER_JWT_SECRET` dari `.env` dengan isi `dist/`; jangan pernah
menempelkan nilai secret ke laporan atau issue.

---

## Arsitektur middleware dev

| Endpoint | Fungsi |
|---|---|
| `GET /dev/session?recipientId=...&tenant=...` | Menerbitkan subscriber JWT |
| `POST /dev/session` | Sama, body JSON `{ recipientId, tenant }` |
| `POST /dev/notify` | Memanggil `POST /api/v1/notify` dengan API key server-side |

- Hanya didaftarkan oleh plugin Vite dengan `apply: 'serve'`; tidak ikut `vite build`.
- Dev server mengikat `127.0.0.1:5174`, bukan `0.0.0.0`.
- Body dibatasi 16 KB; field divalidasi; error tidak memuat token, API key, atau stack trace.
- Token dibuat dengan menjalankan helper repo sebagai child process (tanpa shell), cwd root repo,
  environment `.env` root.
- `/dev/notify` tidak mengirim tenant dari body. Backend menentukan tenant dari `SERVICE_API_KEY`.
- Proxy `/api` meneruskan list, read receipt, SSE, dan preferences. Tidak ada perubahan CORS
  backend.

---

## Troubleshooting

| Gejala | Penyebab umum | Tindakan |
|---|---|---|
| **Gagal menerbitkan token (502)** | PostgreSQL mati, migrasi/seed belum jalan, `.env` tidak ada | `npm run infra:up`, `npx prisma migrate deploy`, `npx prisma db seed` |
| **SERVICE_API_KEY belum diisi (503)** | `.env` root tidak lengkap | Isi `SERVICE_API_KEY`, restart Vite/backend |
| **401 setelah token baru** | Tenant punya secret API key yang berbeda dari `SUBSCRIBER_JWT_SECRET` | Helper membaca secret key tenant; samakan key/env atau pakai tenant yang benar. Lihat `docs/design/preference-center.md` §6.1 |
| **429** | Batas 60 request/menit per IP untuk preferences | Tunggu satu menit; UI menampilkan durasi bila header tersedia |
| **Notifikasi tidak muncul** | Backend/Redis mati, worker belum selesai, atau template seed tidak ada | Cek `/health/ready`, log backend, dan `NotificationRecipient` |
| **Koneksi SSE tidak terbuka** | Proxy/backend tidak berjalan | Pastikan `npm run start:dev` dan `GET /health/live` |
| **Port 5174 dipakai** | Instance sample lain | Hentikan proses lama; `strictPort` mencegah pindah port diam-diam |
| **`npm ci` gagal `EPERM` pada `rolldown-binding...node`** | Dev server Vite masih memegang binary native di Windows | Hentikan `npm run dev`, jalankan `npm ci`, lalu mulai dev server lagi |
| **`preview` tidak punya `/dev`** | Middleware hanya aktif saat serve | Gunakan `npm run dev` |

Log backend tetap sumber utama untuk `requestId` pada error. UI menampilkan `requestId` jika
respons menyertakannya.

---

## Batasan

- Dev-only: middleware, proxy, dan helper token tidak untuk produksi.
- Token disimpan di `sessionStorage`; XSS pada origin ini tetap berisiko. Produksi harus memakai
  strategi token milik aplikasi consumer.
- TTL token 1 jam mengikuti helper dev.
- Tanpa browser automation/Playwright; verifikasi visual dilakukan manual.
- Email/WhatsApp log-only di development.
- Provider in-app memuat hingga 50 notifikasi; inbox menampilkan 20 terbaru, tanpa UI pagination.
- Tenant notify mengikuti API key, bukan field tenant pada form sesi.
- Sample tidak berada di npm workspace dan tidak memengaruhi instalasi root.

## Dokumen terkait

- [Panduan integrasi end-user](../../docs/usage/end-user.md)
- [Preference center](../../docs/design/preference-center.md)
- [Local setup dan verifikasi](../../docs/getting-started/local-setup.md)
- [Desain sample](../../docs/design/sample-in-app-design.md)
