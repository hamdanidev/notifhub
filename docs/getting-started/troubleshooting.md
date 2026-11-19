# Troubleshooting

Kumpulan gejala yang paling sering muncul saat menjalankan atau memakai NotifHub, beserta penyebab
dan perbaikannya. Semua perbaikan di bawah sudah tercakup oleh test atau verifikasi manual di
[local setup](local-setup.md); bila gejalanya tidak ada di sini, mulai dari bagian
[Cara membaca gejalanya](#cara-membaca-gejalanya).

## Cara membaca gejalanya

Satu request menyentuh beberapa tempat. Urutan pemeriksaan yang paling cepat:

| Yang diperiksa | Cara | Menjawab |
|---|---|---|
| Respons HTTP | Status + `requestId` di body | Ditolak di pintu masuk (auth/validasi/limit)? |
| Log server | Cari `requestId` yang sama | Apa yang terjadi di dalam proses |
| `Notification` + `NotificationRecipient` | Admin API atau `psql` | Sudah ter-enqueue? Status per recipient/channel apa? |
| `DeliveryAttempt` | `psql` | Provider dipanggil? Error apa? |
| `DeliveryEvent` | `psql` | Callback provider masuk? |
| `GET /health/ready` | curl | DB dan Redis sehat? |

`NotificationRecipient.lastError` biasanya sudah menyebut penyebabnya (mis. `preference_disabled`,
`template not found: <key>`).

## Backend gagal start

**Pesan** `Invalid environment configuration:` diikuti daftar variabel.

Backend memvalidasi seluruh environment saat startup dan gagal cepat bila ada yang salah. Lihat
[configuration](configuration.md) untuk default dan aturan tiap variabel. Penyebab umum:

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| `ADMIN_PASSWORD_HASH: ...` | Bukan hash bcrypt | `npm run admin:hash-password "PasswordKuat"`, tempel dengan kutip tunggal |
| `SUBSCRIBER_JWT_SECRET`/`ADMIN_JWT_SECRET: too small` | Kurang dari 32 karakter | Pakai placeholder `.env.example` atau buat secret baru |
| `SERVICE_API_KEY: too small` | Kurang dari 16 karakter | Perpanjang nilainya |
| `CATCH_ALL_RECIPIENT is required when NOTIFHUB_MODE=staging` | Mode staging tanpa catch-all | Isi nomor/alamat tujuan uji |
| `SWAGGER_BASIC_AUTH_*` atau `SMTP_*` required | Mode non-development | Isi nilainya, atau jalankan dengan `NOTIFHUB_MODE=development` |
| `WHATSAPP_... must be set together` | Hanya satu dari pasangan diisi | Isi keduanya atau kosongkan keduanya |
| `Port 3000 is already in use` | Instance lain/port bentrok | Hentikan proses lama atau ubah `PORT` |
| Gagal konek database | Infrastruktur belum siap | Lihat [Database dan migrasi](#database-dan-migrasi) |

## Database dan migrasi

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| `Can't reach database server` saat start | Container Postgres belum `healthy` | `npm run infra:up`, lalu `docker compose -f docker-compose.dev.yml ps` sampai `(healthy)` |
| Tabel tidak ditemukan / schema tertinggal | Migrasi belum dijalankan | `npx prisma migrate deploy`, lalu `npx prisma db seed` |
| `prisma migrate status` melaporkan drift | Database diubah manual | Buat migrasi baru dari perubahan schema; jangan edit migrasi yang sudah ada |
| Ingin data bersih | Data lama/seed berubah | `npm run infra:reset` → `npx prisma migrate deploy` → `npx prisma db seed` (menghapus volume, destruktif) |
| Test e2e menolak database | Nama database tidak berakhiran `_test` | Pakai `notifhub_test`, atau set `ALLOW_NON_TEST_DB=1` bila benar-benar perlu |

Test e2e memakai database dan Redis logical DB terpisah (`TEST_DATABASE_URL`,
`TEST_REDIS_URL`), jadi aman dijalankan tanpa menghapus data development.

## Request ditolak

| Status | Arti | Perbaikan |
|---|---|---|
| `401` | Kredensial tidak ada/tidak cocok untuk lane yang dipakai | Kirim `X-API-Key` (lane consumer) atau `Authorization: Bearer` (admin/subscriber); token di query string ditolak |
| `400` dengan pesan tenant | `tenant_id` di body berbeda dengan tenant API key | Hapus `tenant_id` dari body (deprecated) |
| `403` | Kredensial valid tetapi peran tidak diizinkan (mis. `platform_admin`) | Pakai admin `tenant_admin` |
| `403 tenant_suspended` | Tenant sedang di-suspend platform admin | Minta operator platform melakukan `resume`; data tetap tersimpan dan job antre tetap diproses |
| `403 origin_not_allowed` | `Origin` browser tidak ada di `ApiKey.allowedOrigins` | Tambahkan origin tersebut ke daftar key, atau panggil dari server tanpa header `Origin` |
| Login platform `403` | Akun bukan `platform_admin` aktif, atau `tenantId` akun masih terisi | Isi `PLATFORM_ADMIN_EMAIL` + hash, pastikan akun platform punya `tenantId = NULL`; cek log `platform.login.failed` |
| `404` | Resource tidak ada **atau** milik tenant lain | Pastikan tenant token sesuai pemilik data |
| `413` | Body melebihi `INGEST_MAX_PAYLOAD_BYTES` (64 KB) | Kecilkan payload ingest |
| `429` | Rate limit | Ingest 100/menit **per IP**; login admin 5/menit per IP; preferensi 60/menit per IP |
| `503` | Redis/queue tidak tersedia saat ingest | Nyalakan Redis; `FAIL_MODE_ON_REDIS_DOWN=closed` membuat ingest gagal cepat |

Catatan soal `401` pada ingest: auth hanya menerima key dari tabel `ApiKey`. Bootstrap key dibuat
dari `SERVICE_API_KEY` **saat tabel kosong**; setelah ada key lain, mengganti `SERVICE_API_KEY` di
env tidak otomatis mengubah key yang berlaku — buat key baru lewat Admin API.

## Notifikasi tidak sampai

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| Email/WhatsApp tidak terkirim di lokal | Mode `development` bersifat log-only | Cek log `email.log_only`; untuk uji nyata pakai stub ([local setup](local-setup.md#verify-email-and-subscriber-push-sync)) atau mode staging |
| Recipient `skipped` + `lastError=preference_disabled` | Preferensi channel dimatikan | Aktifkan lewat preference center atau Admin API |
| Job tertunda, bukan gagal | Quiet hours | Periksa `quietHoursStart`/`quietHoursEnd` dan `timezone` |
| Recipient `failed` + `template not found: <key>` | Template tidak ada/tidak aktif untuk tenant itu | Buat dan publish template tenant tersebut (`/api/v1/admin/templates`) |
| `sms` tidak terkirim | Belum ada provider/worker `sms` | Diharapkan: ingest menerima, recipient `skipped` |
| WhatsApp gagal di luar uji | Pesan teks hanya valid dalam jendela 24 jam Meta | Gunakan approved template (belum didukung) atau kirim setelah user menghubungi bot |
| Notifikasi `partial` | Sebagian recipient/channel gagal | Buka detail notifikasi; status per recipient menunjukkan yang gagal |
| `idempotency_key` mengembalikan id lama | Idempotensi masih dalam TTL (default 7 hari) | Pakai key baru untuk kiriman baru |

Worker melempar `UnrecoverableError` untuk kegagalan yang tidak akan berubah (recipient tidak ada,
notifikasi sudah di-soft-delete, template tidak ditemukan), sehingga job **tidak** di-retry.
Kegagalan provider yang bersifat sementara di-retry sampai 5 percobaan dengan exponential backoff.

## Token subscriber ditolak (401)

| Penyebab | Perbaikan |
|---|---|
| Token kedaluwarsa | Terbitkan ulang: `npm run dev:subscriber-token -- <recipientId> [tenant]` |
| Token dikirim di query string | Kirim di header `Authorization: Bearer <token>` |
| Secret tenant tidak cocok | Token ditandatangani dengan secret API key tenant; `SUBSCRIBER_JWT_SECRET` hanya fallback. Lihat [preference-center §6](../design/preference-center.md#6-verifikasi-jwt-subscriber-per-tenant) |
| `api_key.bootstrap.subscriber_secret_mismatch` di log | Snapshot secret di key bootstrap berbeda dengan env; selaraskan `SUBSCRIBER_JWT_SECRET` atau pakai secret dari API key tenant |

## Console

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| Langsung balik ke halaman login | Respons `401` menghapus sesi dan mengarahkan ke `/login` | Login ulang; cek `ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH` dan masa berlaku JWT |
| Request API gagal dari browser | CORS | Daftarkan origin console di `CORS_ORIGINS` di luar development |
| Console memanggil URL yang salah | `VITE_NOTIFHUB_API_URL` (di `console/.env`) | Set ke URL backend, lalu restart `npm run console:dev` |
| Data terlihat lama | Tidak ada auto-refresh/polling | Reload halaman atau pakai aksi refresh di UI; detail di [console-needs-analysis §4](../design/console-needs-analysis.md#4-kebutuhan-refresh) |

## Test dan CI

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| `test:e2e` gagal sebelum test jalan | `pretest:e2e` butuh Postgres/Redis hidup | `npm run infra:up`, lalu ulangi |
| Test gagal karena data lama | Redis logical DB atau database test kotor | `pretest:e2e` sudah membuat/memigrasi ulang; jalankan `npm run ci` untuk urutan penuh |
| CI gagal di langkah OpenAPI drift | `openapi/notifhub.json` tidak diperbarui setelah route berubah | Jalankan backend, `npm run openapi:export`, commit hasilnya |
| Ingin meniru CI secara lokal | — | `npm run ci` (typecheck + build + unit + e2e + migrate status) |

## Docker

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| `migrate` exit ≠ 0 | Env prod belum lengkap / DB belum siap | Pastikan semua `CHANGE_ME` di `.env.prod` sudah diganti; jalankan ulang |
| `backend` tidak menjadi `healthy` | Migrasi gagal atau dependency tidak siap | `docker compose --env-file .env.prod -f docker-compose.prod.yml logs backend` |
| Console menunjuk API yang salah | `CONSOLE_API_URL` diisi saat build image | Set nilainya lalu rebuild image console |
| Data hilang setelah `down` | `down -v` menghapus volume | Jangan pakai `-v` bila data ingin dipertahankan |

Smoke stack ini untuk verifikasi (tanpa TLS/secret manager), bukan deployment produksi.

## Tooling dokumentasi

- `npm run docs:check` memeriksa tautan relatif dan anchor heading di `docs/`. Jalankan setelah
  memindahkan file atau mengganti judul bagian.
- Perintah verifikasi di [local setup](local-setup.md) memakai sintaks shell POSIX (`curl`, `export`,
  `$(...)`, `/tmp`). Di Windows jalankan lewat Git Bash atau WSL, atau terjemahkan ke PowerShell.

## Bila masih buntu

Sertakan saat melapor:

1. Status dan body respons (termasuk `requestId`).
2. Mode runtime (`NOTIFHUB_MODE`) dan versi (`package.json`).
3. Baris log dengan `requestId` yang sama.
4. Isi `NotificationRecipient` (status, `attempts`, `lastError`) dan `DeliveryAttempt` terakhir untuk
   notifikasi tersebut.
