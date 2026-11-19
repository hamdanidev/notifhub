# Panduan penggunaan NotifHub

Dokumentasi ini menjelaskan **cara memakai** NotifHub. Untuk alasan desain dan keputusan
arsitektur, lihat [indeks dokumen desain](../design/README.md) (mis. `docs/design/in-app.md`,
`docs/design/webhooks.md`).

## Pilih jalur baca

| Peran | Yang biasanya dikerjakan | Mulai dari |
|---|---|---|
| Integrator backend (consumer) | Kirim notifikasi, push subscriber, kelola topik, terima webhook | [integration.md](integration.md) |
| Frontend / aplikasi end-user | Tampilkan in-app, SSE, preference center, SDK JS/React | [end-user.md](end-user.md) |
| Tenant admin / operator | Admin API, console, deployment, monitoring | [admin-and-operations.md](admin-and-operations.md) |
| Platform operator | Kelola tenant lintas tenant, admin tenant, audit | [platform-admin.md](platform-admin.md) |
| Baru pertama kali | Konsep, siklus hidup notifikasi, quickstart 5 menit | [overview.md](overview.md) |

## Empat lane autentikasi

NotifHub memisahkan empat jenis pemanggil. Kredensial **tidak bisa ditukar** antar lane, dan tidak
ada satu lane yang menerima kredensial lane lain.

| Lane | Kredensial | Tenant berasal dari | Dipakai untuk |
|---|---|---|---|
| Ingest (consumer) | header `X-API-Key: nhk_...` | API key | `POST /api/v1/notify`, subscriber, topik |
| Admin (tenant) | `Authorization: Bearer <admin JWT>` (`ADMIN_JWT_SECRET`) | klaim token | `/api/v1/admin/*` |
| Subscriber (end-user) | `Authorization: Bearer <subscriber JWT>` (secret per tenant) | klaim token | in-app, SSE, preference center |
| Platform | `Authorization: Bearer <platform admin JWT>` (role `platform_admin`) | tidak ada (lintas tenant) | `/api/v1/platform/*` |

Konsekuensi penting: **tenant tidak pernah dikirim di body** untuk ingest/admin. Di ingest,
`tenant_id` hanya boleh sama dengan tenant API key (kalau berbeda → `400`).

## Konvensi API

- Base URL development: `http://localhost:3000`. Semua endpoint bisnis memakai prefix `/api/v1`;
  pengecualian: `/health/live`, `/health/ready`, `/metrics`, `/api/docs`, `/api/docs-json`.
- Request dan response berformat JSON, kecuali SSE (`text/event-stream`) dan `/metrics`
  (`text/plain`).
- Kontrak lengkap dan selalu terbaru ada di Swagger: `GET /api/docs` (UI) dan `GET /api/docs-json`.
  Di luar mode development, keduanya dilindungi basic auth (`SWAGGER_BASIC_AUTH_USER/PASS`).
- Semua error memakai bentuk yang sama:

  ```json
  {
    "statusCode": 400,
    "message": "topics or recipients must not be empty",
    "error": "Bad Request",
    "timestamp": "2026-11-16T09:00:00.000Z",
    "path": "/api/v1/notify",
    "requestId": "6f1c..."
  }
  ```

  Sertakan `requestId` saat melaporkan masalah; ID itu juga ada di log server.

| Status | Arti umum |
|---|---|
| `200` | Berhasil (GET/PUT/POST yang tidak membuat resource baru) |
| `202` | Diterima untuk diproses asinkron (`/notify`, webhook provider) |
| `400` | Validasi gagal (field, format, kombinasi tidak valid) |
| `401` | Kredensial hilang/salah untuk lane yang dipakai |
| `403` | Kredensial valid tetapi perannya tidak diizinkan (mis. `platform_admin`) |
| `404` | Resource tidak ada **atau** bukan milik tenant Anda |
| `413` | Body melebihi `INGEST_MAX_PAYLOAD_BYTES` (default 64 KB) |
| `429` | Rate limit terlampaui |
| `503` | Redis/queue tidak tersedia saat ingest |

## Batas yang perlu diketahui sejak awal

- **Rate limit**: ingest dibatasi per **IP** (`INGEST_RATE_LIMIT_PER_KEY` ×
  `INGEST_RATE_LIMIT_WINDOW_SECONDS`, default 100/menit) walau nama env menyebut "per key";
  login admin 5/menit per IP; endpoint preference 60/menit per IP.
- **Payload**: maksimum 64 KB per request ingest.
- **Recipients**: maksimum 1.000 per request; topik maksimum 50.
- **Idempotency**: `idempotency_key` yang sama dalam `IDEMPOTENCY_TTL_DAYS` (default 7 hari)
  mengembalikan notification id yang sama.
- **Development**: email dan WhatsApp **tidak dikirim** (log-only). Lihat
  [overview.md](overview.md) untuk tabel perilaku per channel.

## Prasyarat lokal

```bash
npm install
npm run infra:up          # PostgreSQL + Redis
cp .env.example .env
npx prisma migrate deploy
npx prisma db seed
npm run start:dev         # http://localhost:3000
```

Detail lengkap (termasuk verifikasi tiap fitur dan Docker) ada di
[docs/getting-started/local-setup.md](../getting-started/local-setup.md).

> Semua contoh di dokumentasi ini memakai nilai development (`dev-api-key-change-in-prod`,
> `user-test-1`). Jangan memakai nilai tersebut di produksi.
