# Desain in-app: pengiriman, SSE, catch-up, dan SDK JavaScript

Status: **terimplementasi dan terverifikasi**.
Basis: PART 1 (aturan 29, 38–45) dan implementasi ingest yang sudah ada di repo ini.

**Isi dokumen**

- [1. Ruang lingkup](#1-ruang-lingkup)
- [2. Alur data](#2-alur-data)
- [3. Kontrak HTTP](#3-kontrak-http)
- [4. Auth subscriber](#4-auth-subscriber)
- [5. Redis](#5-redis)
- [6. Worker in-app](#6-worker-in-app)
- [7. Template in-app (minimal)](#7-template-in-app-minimal)
- [8. `@notifhub/js`](#8-notifhubjs)
- [9. Perubahan konfigurasi proyek](#9-perubahan-konfigurasi-proyek)
- [10. Daftar file](#10-daftar-file)
- [11. Rencana verifikasi](#11-rencana-verifikasi)
- [12. Keputusan desain](#12-keputusan-desain)
- [13. Catatan implementasi (penyesuaian saat implementasi)](#13-catatan-implementasi-penyesuaian-saat-implementasi)
- [14. Template in-app v2 (2026-11-16)](#14-template-in-app-v2-2026-11-16)

---

## 1. Ruang lingkup

### Termasuk dalam cakupan

1. **Worker in-app**: mengonsumsi queue `notification-inapp`, meresolve + merender template in-app,
   mem-publish event ke Redis, memperbarui status pengiriman, dan menulis `delivery_attempts`.
2. **Redis event bus**: Pub/Sub untuk push langsung + Redis Stream untuk replay maksimal 5 menit.
3. **SSE endpoint** `GET /api/v1/in-app/stream` dengan auth JWT subscriber.
4. **Catch-up API** `GET /api/v1/in-app/notifications` (keyset pagination).
5. **Read receipt** `POST /api/v1/in-app/notifications/:notificationId/read`.
6. **Auth subscriber**: `SubscriberJwtGuard` + verifikasi HS256 dengan secret API key tenant
   (fallback `SUBSCRIBER_JWT_SECRET` untuk tenant tanpa secret, lihat
   `docs/design/preference-center.md`), terpisah penuh dari `ApiKeyGuard` (ingest) dan admin JWT
   (`docs/design/admin-api.md`).
7. **Package `@notifhub/js`**: SDK headless, fetch-based SSE, retry, reconnect, typed error, cancellation.

### Tidak termasuk (dokumen lain)

- Provider email/WhatsApp dan worker-nya (`docs/design/email-and-preferences.md`, `docs/design/whatsapp.md`).
- Enforcement preferensi + quiet hours (`docs/design/email-and-preferences.md`).
- Topic, group ack, admin API (`docs/design/admin-api.md`), `@notifhub/react` + console
  (`docs/design/react-and-console.md`), `sdk/go` (`docs/sdk/go-sdk.md`), workflow engine.
- Scheduled/delayed notification, billing logic, digest, campaign.

---

## 2. Alur data

### 2.1 Jalur tulis (worker)

```
POST /api/v1/notify (ingest)
  -> queue notification-inapp
  -> InAppProcessor.process(job)
       1. tunggu ReadinessService.untilReady() (DB sudah connect)
       2. ambil NotificationRecipient + Notification (channel=inapp)
       3. jika status sudah sent/read/skipped -> skip (idempotent)
       4. resolve template in-app (locale) + render body
       5. publish ke Redis: XADD stream + PUBLISH channel (satu pipeline)
       6. update notification_recipients: status=sent, sentAt, attempts+1, providerName='inapp'
       7. tulis satu baris delivery_attempts (status='success')
       8. metrics: notifhub_delivery_latency_seconds{provider="inapp",channel="inapp"}
```

Kegagalan: status `failed`, `lastError` diisi, satu baris `delivery_attempts` (`status='failed'`,
`errorStack` dipotong 4000 karakter), metric `notifhub_provider_errors_total`, lalu error dilempar
agar BullMQ retry (5x, exponential 2 detik, konfigurasi queue yang sudah ada). Error yang tidak bisa
sembuh (template tidak ada, recipient row tidak ada) dilempar sebagai `UnrecoverableError` agar tidak
retry 5x.

### 2.2 Jalur baca (SSE)

```
GET /api/v1/in-app/stream (JWT)
  -> verifikasi JWT -> { recipientId, tenant }
  -> daftar koneksi di SseConnectionRegistry (key tenant:recipient)
  -> replay XRANGE stream setelah Last-Event-ID (maks 500 entri)
  -> flush buffer live yang masuk selama replay (dedupe berdasarkan id)
  -> stream live dari Pub/Sub
  -> heartbeat komentar ":\n" setiap 15-30 detik
  -> saat klien putus: unregister + metrics sse_connections_active--
```

---

## 3. Kontrak HTTP

Semua error memakai bentuk response error yang sudah ada:
`{ statusCode, message, error, timestamp, path, requestId }`.

### 3.1 SSE stream

```http
GET /api/v1/in-app/stream
Authorization: Bearer <subscriber-jwt>
Accept: text/event-stream
Last-Event-ID: 1731732000000-0        (opsional, untuk replay)
```

Response `200`:

```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

Body (contoh):

```text
retry: 5000

id: 1731732000000-0
event: notification
data: {"notificationId":"a0f7...","templateKey":"test.notification","subject":null,"body":"Halo Budi, ini notifikasi tes dari NotifHub.","data":{"nama":"Budi"},"priority":3,"createdAt":"2026-11-15T15:41:13.000Z"}

: heartbeat
```

- `id` = Redis Stream ID (`<ms>-<seq>`), dipakai klien untuk `Last-Event-ID`.
- `event` = `notification`.
- `data` = satu baris JSON (newline di-escape).
- Heartbeat berupa komentar SSE (`:\n\n`), bukan event.
- `retry: 5000` dikirim sekali agar klien EventSource generik pun punya fallback.

### 3.2 Catch-up

```http
GET /api/v1/in-app/notifications?limit=20&cursor=<opaque>
Authorization: Bearer <subscriber-jwt>
```

- `limit`: default 20, maksimum 100.
- `cursor`: opaque, hasil dari response sebelumnya. Cursor tidak valid -> `400`.
- Urutan: `Notification.createdAt DESC, Notification.id DESC`.
- Hanya `channel = inapp`, `recipientId = sub`, `Notification.deletedAt IS NULL`.

Response `200`:

```json
{
  "items": [
    {
      "notificationId": "a0f77fac-dcb8-4af4-8118-cd6929c1969e",
      "templateKey": "test.notification",
      "subject": null,
      "body": "Halo Budi, ini notifikasi tes dari NotifHub.",
      "data": { "nama": "Budi" },
      "priority": 3,
      "status": "sent",
      "createdAt": "2026-11-15T15:41:13.000Z",
      "readAt": null
    }
  ],
  "nextCursor": "eyJjIjoiMjAyNi0xMS0xNVQxNTo0MToxMy4wMDBaIiwibiI6ImEwZjcuLi4ifQ"
}
```

`nextCursor` = `null` jika tidak ada halaman berikutnya.
Body dirender saat query; jika template hilang, `body` = `null` (item tetap dikembalikan, warning di log).

### 3.3 Read receipt

```http
POST /api/v1/in-app/notifications/:notificationId/read
Authorization: Bearer <subscriber-jwt>
```

Response `200`:

```json
{ "notificationId": "a0f7...", "readAt": "2026-11-15T16:02:00.000Z" }
```

- Idempoten: pemanggilan ulang mengembalikan `readAt` yang sama, tidak mengubah data.
- `404` jika notifikasi tidak ada, sudah dihapus, atau bukan milik `sub`/`tenant` (tidak membocorkan keberadaan).
- Update: `status = read`, `readAt = now()` untuk baris `(notificationId, recipientId, inapp)`.

---

## 4. Auth subscriber

- Algoritma **HS256**, secret `SUBSCRIBER_JWT_SECRET` (`docs/design/admin-api.md`: per API key).
- Claims wajib: `sub` (recipientId), `tenant`, `exp`. `iat` opsional.
- Token **hanya** dibaca dari header `Authorization: Bearer <token>`. Query param diabaikan
  sepenuhnya (permintaan dengan `?token=` tanpa header tetap `401`).
- Guard menempelkan `req.subscriber = { recipientId, tenant }`; controller tidak memverifikasi ulang.
- Semua kegagalan auth -> `401` seragam (`Invalid or missing subscriber token`), detail hanya di log.
- Verifikasi memakai `jsonwebtoken` langsung di `SubscriberTokenService` (bukan `@nestjs/jwt`),
  agar admin JWT (`docs/design/admin-api.md`) bisa memakai instance + secret admin yang terpisah tanpa
  risiko tercampur. Opsi verifikasi: `algorithms: ['HS256']`, `clockTolerance: 5` detik.
- Tenant pada token harus sama dengan `Notification.tenantId` pada saat query (filter di DB).

---

## 5. Redis

Prefix tetap `notifhub` (konsisten dengan queue BullMQ yang sudah ada).

| Kunci | Tipe | Isi | Masa hidup |
|---|---|---|---|
| `notifhub:inapp:events:<tenant>:<recipient>` | Pub/Sub channel | JSON envelope | ephemeral |
| `notifhub:inapp:stream:<tenant>:<recipient>` | Stream | field `payload` = JSON envelope | `MAXLEN ~ 500`, `EXPIRE SSE_REPLAY_BUFFER_SECONDS` (default 300) |

Envelope:

```json
{
  "tenantId": "default",
  "recipientId": "user-test-1",
  "event": {
    "notificationId": "a0f7...",
    "templateKey": "test.notification",
    "subject": null,
    "body": "Halo Budi, ...",
    "data": { "nama": "Budi" },
    "priority": 3,
    "createdAt": "2026-11-15T15:41:13.000Z"
  }
}
```

Catatan implementasi:

- `tenantId` dan `recipientId` untuk routing diambil dari **envelope**, bukan hasil parsing nama channel
  (nilai bisa mengandung `:`).
- Publish memakai satu pipeline: `XADD` -> `EXPIRE` -> `PUBLISH`, dan mengembalikan stream id.
- Dua koneksi Redis terpisah di `InAppEventBus`:
  1. subscriber (pattern `PSUBSCRIBE notifhub:inapp:events:*`), dipakai bersama semua koneksi SSE;
  2. command (XRANGE/XADD/PUBLISH).
- Replay memakai `XRANGE key (lastId +` dengan `COUNT 500`, lalu filter id yang lebih besar dari
  `lastId` (perbandingan numerik `<ms>-<seq>`, bukan string).
- `EXPIRE` di-refresh setiap publish agar stream hanya menyimpan buffer 5 menit terakhir.
- Error koneksi Redis di-log (`redis.inapp.*`) dan tidak mematikan proses.

---

## 6. Worker in-app

- `src/workers/in-app.processor.ts`, `@Processor(QUEUE_INAPP)` + `WorkerHost`, didaftarkan `WorkersModule`.
- Payload job = `DeliveryJobData` yang sudah ada (tidak berubah).
- **Readiness gate**: `ReadinessService.untilReady()` — promise yang resolve setelah
  `PrismaService.onModuleInit` selesai `$connect()`. Worker tidak memproses sebelum itu.
- **Idempotensi**: baris `notification_recipients` dengan status `sent`/`read`/`skipped` -> skip
  (log `delivery.skipped_duplicate`). Publish dilakukan sebelum update DB (at-least-once);
  duplikat dikenali klien lewat `notificationId`.
- **Locale**: `recipientOverride.locale` -> `DEFAULT_LOCALE`. (Locale per subscriber menyusul
  bersama Subscriber CRUD.)
- **Concurrency**: default BullMQ (1). Tidak ada env baru.
- **Graceful shutdown**: `app.enableShutdownHooks()` sudah aktif; `onApplicationShutdown` BullMQ
  memanggil `worker.close()` yang menunggu job in-flight selesai.

---

## 7. Template in-app (minimal)

- Resolusi `(key, channel=inapp, locale)`: versi `active` tertinggi untuk locale exact;
  jika tidak ada -> locale `DEFAULT_LOCALE`; jika tidak ada juga -> `template_not_found`.
- Render: substitusi `{{var}}` dari `Notification.payload.data` (string/number/boolean).
  Tanpa helper/block/partials Handlebars penuh — itu bagian dari `docs/design/email-and-preferences.md`.
- Variabel yang tidak ada diganti string kosong dan dicatat `debug` (bukan error).
- `subject` opsional (saat ini `null` untuk in-app), `body` wajib.

---

## 8. `@notifhub/js`

### 8.1 Package

- Lokasi `packages/js-sdk`, nama `@notifhub/js`, versi `0.1.0`.
- npm workspace (`"workspaces": ["packages/*"]` di root).
- Build `tsup`: ESM + CJS + `.d.ts`, target ES2022, `platform: neutral`, sourcemap.
- SSE memakai parser sendiri di `src/sse-transport.ts` (fetch + `ReadableStream` + `TextDecoder`),
  tetap fetch-based dan tidak pernah memakai `EventSource`.
- `README.md` placeholder diganti dokumentasi singkat + contoh pemakaian.

### 8.2 API publik

```ts
export interface NotifHubClientOptions {
  baseUrl: string;                                  // mis. https://notifhub.example.com
  getToken: () => string | Promise<string>;         // dipanggil per request & saat reconnect
  fetch?: typeof fetch;                             // injection untuk test/SSR
  retry?: Partial<RetryOptions>;                    // maxAttempts, baseDelayMs, maxDelayMs
  logger?: (event: NotifHubLogEvent) => void;
}

export class NotifHubClient {
  constructor(options: NotifHubClientOptions);
  subscribe(
    handlers: {
      onNotification: (notification: InAppNotification) => void;
      onOpen?: () => void;
      onError?: (error: NotifHubError) => void;
    },
    options?: { signal?: AbortSignal; lastEventId?: string },
  ): Subscription;
  getNotifications(params?: { limit?: number; cursor?: string; signal?: AbortSignal }): Promise<NotificationPage>;
  markRead(notificationId: string, options?: { signal?: AbortSignal }): Promise<ReadReceipt>;
  close(): void;
}

export interface Subscription {
  close(): void;
  readonly closed: boolean;
}
```

### 8.3 Perilaku wajib

| Perilaku | Rancangan |
|---|---|
| Injeksi token | `getToken()` dipanggil setiap request dan setiap reconnect; header `Authorization: Bearer` |
| Retry 5xx | GET/POST diulang untuk `5xx`, `429`, dan network error; backoff eksponensial + jitter, maks 3 percobaan; `Retry-After` dihormati untuk 429; tidak retry `4xx` lain |
| Reconnect SSE | Loop manual: setelah stream putus, tunggu backoff 1s x2 maks 30s + jitter, reconnect dengan `Last-Event-ID` terakhir; backoff direset setelah `onopen` sukses |
| Typed error | `NotifHubError` dengan `code`: `unauthorized`, `forbidden`, `not_found`, `bad_request`, `rate_limited`, `server_error`, `network_error`, `aborted`, `invalid_response`, `sse_closed`; plus `status`, `requestId`, `retryable` |
| Cancellation | `AbortSignal` pada `subscribe` dan setiap method; abort -> `NotifHubError('aborted')`, koneksi ditutup, timer dibersihkan |
| Dedupe | Set `id` event terakhir (maks 500, FIFO) dan `notificationId` terakhir (maks 500) untuk mencegah duplikat saat replay |
| Auth gagal | `401/403` -> error fatal, tidak reconnect (menunggu token baru dari pemanggil) |
| Heartbeat | Komentar SSE diabaikan otomatis oleh parser |
| Larangan | Tidak ada import/ pemakaian `EventSource`; token tidak pernah di query param |

### 8.4 Contoh pemakaian

```ts
const client = new NotifHubClient({
  baseUrl: 'http://localhost:3000',
  getToken: () => session.accessToken,
});

const subscription = client.subscribe({
  onNotification: (n) => console.log(n.notificationId, n.body),
  onError: (e) => console.error(e.code),
});

const page = await client.getNotifications({ limit: 20 });
await client.markRead(page.items[0].notificationId);
subscription.close();
```

---

## 9. Perubahan konfigurasi proyek

- Root `package.json`: tambah `"workspaces": ["packages/*"]`, script `sdk:build`, `sdk:typecheck`,
  `sdk:test`; tambah dependency backend `jsonwebtoken@^9`, devDependency `@types/jsonwebtoken`.
- `packages/js-sdk/package.json` baru (dependency `@microsoft/fetch-event-source`,
  devDependency `tsup`, `typescript`, `vitest` bila test disetujui).
- **Tidak ada perubahan `schema.prisma`** dan **tidak ada env baru**; memakai
  `SUBSCRIBER_JWT_SECRET`, `SSE_HEARTBEAT_INTERVAL_SECONDS`, `SSE_REPLAY_BUFFER_SECONDS`,
  `DEFAULT_LOCALE`, `DEFAULT_TENANT_ID` yang sudah ada.
- `SSE_HEARTBEAT_INTERVAL_SECONDS` di-clamp 15–30 detik saat dipakai.

---

## 10. Daftar file

### Backend — baru

| File | Isi |
|---|---|
| `src/auth/auth.module.ts` | Modul auth subscriber (export guard + token service) |
| `src/auth/subscriber/subscriber-token.service.ts` | Verifikasi HS256 + mapping claims |
| `src/auth/subscriber/subscriber-jwt.guard.ts` | Guard `CanActivate`, menempelkan `req.subscriber` |
| `src/auth/subscriber/subscriber.types.ts` | `SubscriberPrincipal`, `RequestWithSubscriber` |
| `src/common/readiness.service.ts` | Promise readiness (global) |
| `src/templates/template.service.ts` | Resolusi fallback + render `{{var}}` minimal |
| `src/in-app/in-app.module.ts` | Wiring controller + service + event bus |
| `src/in-app/in-app-stream.controller.ts` | Endpoint SSE (delegasi ke service) |
| `src/in-app/in-app.controller.ts` | Catch-up + read receipt |
| `src/in-app/in-app.service.ts` | Query list/read + render per halaman |
| `src/in-app/in-app-event-bus.service.ts` | Redis Stream + Pub/Sub, replay, publish |
| `src/in-app/sse-connection-registry.service.ts` | Registry koneksi, heartbeat global, metrics gauge |
| `src/in-app/dto/list-in-app-notifications.dto.ts` | `limit`, `cursor` |
| `src/in-app/dto/in-app-notification.ts` | Tipe item + page (dipakai Swagger & service) |
| `src/workers/workers.module.ts` | Registrasi processor |
| `src/workers/in-app.processor.ts` | Worker in-app |

### Backend — diubah

| File | Perubahan |
|---|---|
| `src/app.module.ts` | import `AuthModule`, `InAppModule`, `WorkersModule`, `ReadinessModule`/provider |
| `src/prisma/prisma.service.ts` | menandai readiness setelah `$connect()` sukses |
| `package.json` | `jsonwebtoken`, `@types/jsonwebtoken`, workspaces, script SDK |
| `README.md` | satu paragraf status fitur in-app (opsional, tetap 12–15 baris) |

### SDK — baru/menggantikan placeholder

`packages/js-sdk/package.json`, `tsconfig.json`, `tsup.config.ts`, `src/index.ts`, `src/client.ts`,
`src/http.ts`, `src/sse.ts`, `src/errors.ts`, `src/types.ts`, `README.md`,
serta `test/*.test.ts` bila unit test disetujui.

---

## 11. Rencana verifikasi

1. `npm install` (workspace ikut terpasang), `npm run typecheck`, `npm run build`,
   `npm run sdk:build`, `npm run sdk:typecheck` — semua harus 0 error.
2. Jalankan aplikasi, kirim ingest in-app untuk `user-test-1` dengan template `test.notification`.
3. DB: `notification_recipients.status=sent`, `sentAt` terisi, `attempts=1`,
   satu baris `delivery_attempts` (`status='success'`, `providerName='inapp'`).
4. Redis: `XLEN notifhub:inapp:stream:default:user-test-1` = 1, `XRANGE` menampilkan payload;
   `PUBSUB CHANNELS notifhub:inapp:*` menunjukkan channel.
5. `curl -N` SSE dengan JWT: menerima event `notification` (replay), lalu event baru saat ingest
   berikutnya, plus baris `:` heartbeat dalam 25–30 detik.
6. Reconnect: putuskan koneksi, ingest 2 notifikasi, sambung ulang dengan `Last-Event-ID` ->
   hanya 2 event terlewat yang dikirim.
7. Catch-up: `limit=2` mengembalikan 2 item + `nextCursor`; halaman kedua memakai cursor tersebut.
8. Read receipt: `POST .../read` -> `200` + `readAt`; ulangi -> `readAt` sama; DB terupdate.
9. Auth negatif: tanpa token `401`, token di query param `401`, token kedaluwarsa `401`,
   token dengan secret salah `401`, tenant beda -> `404` pada read receipt dan list kosong.
10. SDK: skrip Node memakai `dist` untuk `getNotifications`, `markRead`, `subscribe`
    (event masuk, lalu `close()`), dan skenario `401` menghasilkan `NotifHubError.code='unauthorized'`.
11. Metrics: `notifhub_sse_connections_active` naik saat koneksi dan kembali 0 setelah putus;
    `notifhub_delivery_latency_seconds` punya sampel; `notifhub_provider_errors_total` hanya naik saat gagal.
12. Graceful shutdown: worker berhenti dan `delivery_attempts` tidak menggantung.

---

## 12. Keputusan desain

| # | Keputusan | Pilihan yang diambil |
|---|---|---|
| D1 | Read receipt masuk cakupan in-app | Ya (kecil, dibutuhkan `@notifhub/react` nanti) |
| D2 | Group ack ditunda | Ya (`docs/design/admin-api.md`, butuh mekanisme group) |
| D3 | Enforcement preferensi + quiet hours | Ditunda ke `docs/design/email-and-preferences.md` sesuai PART 1 |
| D4 | Worker in-app menulis `delivery_attempts` | Ya (satu baris per attempt) |
| D5 | Render template minimal `{{var}}` di worker in-app | Ya; alternatif: kirim data mentah dan render di `docs/design/email-and-preferences.md` |
| D6 | Pagination keyset dengan cursor opaque | Ya; alternatif: offset (lebih sederhana, kurang stabil) |
| D7 | Concurrency worker default (1), tanpa env baru | Ya |
| D8 | Unit test SDK (vitest) untuk retry/backoff/error mapping | Ya, minimal 3–4 test |
| D9 | Nama event SSE `notification` | Ya |
| D10 | `MAXLEN ~ 500` untuk stream replay (hardcode) | Ya; bisa dijadikan env nanti bila perlu |
| D11 | Verifikasi JWT memakai `jsonwebtoken` langsung (tanpa `@nestjs/jwt`) | Ya, agar secret admin (`docs/design/admin-api.md`) tidak tercampur |

---

## 13. Catatan implementasi (penyesuaian saat implementasi)

1. **Parser SSE sendiri, bukan `@microsoft/fetch-event-source`.** Library tersebut mengakses
   `document`/`window` tanpa syarat (termasuk pada `abort`), sehingga SDK gagal dipakai di
   Node/SSR dan tidak bisa diuji otomatis. Aturan PART 1 mewajibkan fetch-based SSE (contohnya
   library itu), bukan library tertentu; parser sendiri di `src/sse-transport.ts` memenuhi
   persyaratan yang sama, mendukung heartbeat komentar, `event`/`data`/`id`/`retry`, dan
   diuji di `test/sse-parser.test.ts`.
2. **`TemplatesModule` terpisah** ditambahkan agar `TemplateService` bisa dipakai worker tanpa
   membuat siklus modul dengan `InAppModule`.
3. **`ReadinessModule` global** ditambahkan agar `PrismaService` dan worker berbagi sinyal
   readiness yang sama.
4. **Swagger** mendapat skema keamanan tambahan `subscriber-jwt` (Bearer) di `main.ts`.
5. **Versi root** dinaikkan menjadi `0.2.0` dan root `package.json` memakai npm workspaces
   untuk `packages/*`.

---

## 14. Template in-app v2 (2026-11-16)

- Format in-app adalah `text`; HTML/markdown belum didukung karena SDK terbit menampilkan body
  sebagai teks. Template baru dengan HTML ditolak; baris lama tetap dikirim.
- Variabel memakai escaping `noEscape` (teks polos), schema variabel opsional, dan
  `strictVariables` dapat diaktifkan per template. Detail di `docs/design/templates/template-system-design.md`.
