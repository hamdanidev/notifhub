# Provider WhatsApp WAHA

Status: **terimplementasi; verifikasi otomatis lulus; smoke test WAHA nyata belum dijalankan**
(2026-11-20). Lihat §15.
Basis: `docs/design/whatsapp.md` (provider Meta, worker, webhook), `docs/design/webhooks.md`
(pipeline status), `src/providers/`, `src/workers/whatsapp.processor.ts`, dan dokumentasi resmi
WAHA: [Send messages](https://waha.devlike.pro/docs/how-to/send-messages/),
[Events](https://waha.devlike.pro/docs/how-to/events/), [Security](https://waha.devlike.pro/docs/how-to/security/),
[WAHA Plus](https://waha.devlike.pro/docs/how-to/waha-plus/).

**Isi dokumen**

- [1. Latar belakang dan tujuan](#1-latar-belakang-dan-tujuan)
- [2. Ruang lingkup](#2-ruang-lingkup)
- [3. Keputusan desain](#3-keputusan-desain)
- [4. Arsitektur dan alur](#4-arsitektur-dan-alur)
- [5. Integrasi pengiriman (sendText)](#5-integrasi-pengiriman-sendtext)
- [6. Webhook status](#6-webhook-status)
- [7. Pemetaan status](#7-pemetaan-status)
- [8. Konfigurasi](#8-konfigurasi)
- [9. Keamanan, privasi, dan operasi](#9-keamanan-privasi-dan-operasi)
- [10. Multi-tenant dan batasan](#10-multi-tenant-dan-batasan)
- [11. Perubahan kode dan daftar file](#11-perubahan-kode-dan-daftar-file)
- [12. Verifikasi](#12-verifikasi)
- [13. Risiko](#13-risiko)
- [14. Pertanyaan persetujuan](#14-pertanyaan-persetujuan)
- [15. Catatan implementasi](#15-catatan-implementasi)

---

## 1. Latar belakang dan tujuan

Kanal WhatsApp saat ini hanya memakai **Meta WhatsApp Cloud API** dan mengirim `type: "text"`.
Meta mewajibkan **approved template** untuk pesan business-initiated di luar jendela 24 jam, dan
nomor harus terdaftar di WhatsApp Business Platform. Untuk deployment **single tenant** yang ingin
memakai nomor WhatsApp biasa tanpa proses Meta Business, WAHA (WhatsApp HTTP API, self-hosted)
adalah alternatif yang menarik: WAHA menjalankan sesi WhatsApp Web/multi-device dan menyediakan
HTTP API untuk mengirim teks serta webhook untuk status pengiriman.

Tujuan fase ini: menambah **provider WAHA sebagai opsi** untuk channel `whatsapp`, tanpa
mengubah perilaku default (Meta), tanpa migrasi schema, dan tanpa dependency baru.

Catatan lisensi/biaya: sejak versi **2026.6.1** seluruh fitur yang dulu ada di WAHA Plus
(multi-session, media, security) menyatu ke **WAHA Core** yang gratis; image publiknya
`devlikeapro/waha` ([WAHA Plus](https://waha.devlike.pro/docs/how-to/waha-plus/)).

Yang **tidak** diselesaikan fase ini: media, pesan masuk/reply, group, template Meta, pemilihan
provider per tenant, dan UI QR/session di console.

## 2. Ruang lingkup

### Termasuk

1. `WahaProvider` di `src/providers/waha/` yang memakai abstraksi `NotificationProvider` dan
   `ProviderExecutor` (circuit breaker) yang sudah ada.
2. Pemilihan provider lewat env `WHATSAPP_PROVIDER=meta|waha` (default `meta`) di
   `ProviderRegistry`; worker dan test send otomatis memakai provider yang dipilih.
3. Webhook status baru `POST /api/v1/webhooks/waha/events` dengan verifikasi **HMAC-SHA512**
   (`X-Webhook-Hmac`, `X-Webhook-Hmac-Algorithm: sha512`) atas raw body.
4. Pemetaan `message.ack` WAHA ke event netral `sent`/`delivered`/`read`/`failed` dan penulisan ke
   `delivery_events` + update `notification_recipients` lewat `WebhooksService.applyDeliveryStatus`.
5. Mode runtime tetap: `development` log-only, `staging` catch-all, `production` nomor asli.
6. Unit test provider/signature/parser, e2e E46 untuk webhook, dan panduan smoke test manual
   dengan container WAHA.

### Tidak termasuk

- Media/gambar/dokumen, voice note, sticker, poll, tombol, dan pesan interaktif.
- Pesan masuk (`message`, `message.any`), balasan, grup, channel, status/story.
- Pemetaan template Meta (nama template + parameter) dan approval Meta.
- Pemilihan provider/session **per tenant**; sesi WAHA per tenant butuh tabel mapping dan UI.
- QR/session management di console NotifHub; operator memakai dashboard WAHA.
- Perubahan `@notifhub/js`, `@notifhub/react`, console, Go SDK, dan kontrak HTTP publik.
- Penambahan WAHA ke `docker-compose.prod.yml` (deployment WAHA tetap milik operator).

## 3. Keputusan desain

| # | Keputusan | Default | Alasan |
|---|---|---|---|
| D1 | WAHA adalah provider **opsional**; default tetap Meta Cloud API | Ya | WAHA tidak resmi dan berisiko banned; Meta tetap jalur aman |
| D2 | Satu sesi WAHA per deployment lewat env `WAHA_SESSION`, bukan per tenant | Ya | Menghindari tabel mapping + UI; cukup untuk single tenant |
| D3 | Pemilihan vendor lewat `WHATSAPP_PROVIDER=meta\|waha`; tanpa perubahan schema | Ya | Konfigurasi deploy sederhana, reversal cukup ubah env |
| D4 | Webhook baru `POST /api/v1/webhooks/waha/events`, bukan memperluas endpoint Meta | Ya | Signature dan payload berbeda; memisahkan trust boundary |
| D5 | Verifikasi HMAC-SHA512 atas raw body; algoritma selain `sha512` ditolak | Ya | Sesuai mekanisme HMAC WAHA; tidak mencampur secret Meta |
| D6 | `PENDING` (ack 0) diabaikan; `PLAYED` (ack 4) dipetakan ke `read` | Ya | Tidak ada status `pending`/`played` di pipeline; hindari downgrade |
| D7 | `providerName` yang disimpan adalah `waha` (channel tetap `whatsapp`) | Ya | Observability membedakan vendor di attempts/metrics/delivery_events |
| D8 | Error 401/403/404/422 = non-retryable; 429/5xx/timeout/network = retryable | Ya | Retry storm saat session/QR belum siap harus dihindari |
| D9 | Payload event yang disimpan hanya field status; `_data`/body tidak disimpan | Ya | `_data` besar dan memuat data pribadi; audit cukup status |
| D10 | Tanpa dependency baru: `fetch` + `node:crypto`; tanpa migrasi | Ya | Stack tidak berubah, `fetch` sudah dipakai provider Meta |
| D11 | Deployment WAHA (image, volume, QR, TLS) adalah tanggung jawab operator | Ya | Bukan bagian runtime NotifHub; menjaga scope |

## 4. Arsitektur dan alur

```
POST /api/v1/notify (channels: ["whatsapp"])
  -> NotificationRecipient(status=pending, channel=whatsapp)
  -> queue notification-whatsapp
  -> WhatsAppProcessor
       1. readiness gate, load recipient/notification
       2. resolve template + preferensi + nomor (tidak berubah)
       3. provider = ProviderRegistry.getOrThrow(Channel.whatsapp)
            WHATSAPP_PROVIDER=meta -> WhatsAppProvider (Cloud API)
            WHATSAPP_PROVIDER=waha -> WahaProvider
       4. ProviderExecutor.execute(provider, input)  (circuit breaker 10 s)
       5. simpan providerMessageId (id pesan WAHA)
       6. delivery_attempts(providerName=waha) + metrics

WAHA (container terpisah)
  -> event message.ack
  -> POST https://notifhub.example.com/api/v1/webhooks/waha/events
       - verifikasi X-Webhook-Hmac (HMAC-SHA512, raw body)
       - petakan ack -> event netral
       - WebhooksService.applyDeliveryStatus(providerName=waha, channel=whatsapp)
       - delivery_events append-only + update status monotonik
```

Pemilihan provider terjadi **sekali saat boot** di `ProviderRegistry`; tidak ada percabangan di
worker. `WhatsAppProcessor` dan test send (`AdminTemplateTestSendService`) tidak perlu diubah karena
keduanya memakai registry yang sama.

## 5. Integrasi pengiriman (sendText)

### 5.1 Request

`POST {WAHA_BASE_URL}/api/sendText`

Header:

```http
X-Api-Key: <WAHA_API_KEY>
Content-Type: application/json
```

Body:

```json
{
  "session": "default",
  "chatId": "628123456789@c.us",
  "text": "Halo Budi, ...",
  "linkPreview": false
}
```

- `chatId` = nomor E.164 tanpa `+` + `@c.us`; nomor dinormalisasi dengan helper
  `normalizeWhatsAppNumber` yang sudah ada (buang spasi/`-`/`()`, wajib `+`, 8–15 digit).
- `linkPreview: false` agar perilaku deterministik seperti provider Meta (`preview_url: false`).
- Body teks adalah hasil render template; batas 4.096 karakter sudah ditegakkan publish gate.
- `development`: tidak ada HTTP call, log `waha.log_only`, `providerMessageId=dev-log-only`.
- `staging`: nomor diganti `WHATSAPP_CATCH_ALL_RECIPIENT` (fallback `CATCH_ALL_RECIPIENT` bila
  berupa nomor), sama seperti provider Meta.
- Timeout request 9 detik (`AbortSignal.timeout`) supaya tetap di bawah timeout circuit breaker.

### 5.2 Response dan error

- Response 2xx dianggap sukses; ambil `id` (string) sebagai `providerMessageId`.
  Jika `id` tidak ada → error 502 retryable (kontrak WAHA tidak terpenuhi).
- Bentuk error WAHA: `{ "message": "...", "statusCode": 4xx|5xx }`; pesan dipotong 500 karakter
  sebelum masuk log/`lastError`.
- Klasifikasi:

| Kondisi | Perlakuan |
|---|---|
| 2xx + `id` | sukses, simpan `providerMessageId` |
| 401/403 | `ProviderConfigurationError` (API key salah) → `UnrecoverableError` |
| 404 | `ProviderConfigurationError` (session tidak ada) → `UnrecoverableError` |
| 422 | `ProviderConfigurationError` (session belum `WORKING`/perlu QR) → `UnrecoverableError` |
| 429/5xx | error retryable → BullMQ retry exponential |
| timeout/network | error retryable |
| 2xx tanpa `id` | error 502 retryable |

Catatan: worker sudah menerjemahkan `ProviderConfigurationError` menjadi `UnrecoverableError`, jadi
tidak perlu perubahan di processor.

## 6. Webhook status

### 6.1 Endpoint

`POST /api/v1/webhooks/waha/events` (di luar subset OpenAPI publik, seperti webhook Meta).
Body maksimum mengikuti `INGEST_MAX_PAYLOAD_BYTES` (64 KB) dan raw body sudah ditangkap
`bootstrap.ts`.

### 6.2 Verifikasi

- Header wajib: `X-Webhook-Hmac` (hex) dan `X-Webhook-Hmac-Algorithm` (harus `sha512`).
- HMAC-SHA512 atas **raw body** memakai `WAHA_WEBHOOK_HMAC_KEY`; dibandingkan dengan
  `timingSafeEqual`.
- Gagal verifikasi → `401`; body bukan JSON valid → `400`.
- `WAHA_WEBHOOK_HMAC_KEY` kosong → `401` (fail closed) dan log
  `waha.webhook.config_missing`; produksi dengan provider `waha` wajib mengisinya (fail fast saat
  startup).

### 6.3 Payload yang dipakai

Envelope WAHA:

```json
{
  "id": "evt_01...",
  "timestamp": 1741249702485,
  "event": "message.ack",
  "session": "default",
  "payload": {
    "id": "true_628123456789@c.us_AAAAAAAAAAAAAAAAAAAA",
    "fromMe": true,
    "ack": 2,
    "ackName": "DEVICE"
  }
}
```

- Hanya `event = "message.ack"` yang diproses. Event lain diabaikan dan tetap dibalas `202`.
- `providerMessageId` = `payload.id`; `occurredAt` = envelope `timestamp` (milidetik) atau `now`
  bila tidak ada.
- `ackName` dipakai bila ada; fallback ke angka `ack` (kompatibilitas engine).
- `rawPayload` yang disimpan: `{ event, session, id, ack, ackName, from, fromMe, timestamp }` —
  **tanpa** `_data`, body, media, atau nomor pengirim penuh bila tidak diperlukan.
- `messageId` tidak dikenal → dihitung `ignored`, tidak menulis `delivery_events` (tabel
  membutuhkan `notificationId`), tetap `202` agar WAHA tidak retry tanpa henti.
- Duplikat `message.ack` aman: `delivery_events` append-only, transisi status monotonik
  (`failed` tidak menurunkan `sent`/`read`).

### 6.4 Respons dan retry

Selalu `202 {"status":"accepted"}` untuk signature valid (termasuk event tak dikenal). WAHA
dikonfigurasi dengan retry `exponential` (2 detik, 5 percobaan) untuk kegagalan jaringan; endpoint
harus idempoten.

### 6.5 Konfigurasi di sisi WAHA

Contoh session webhook (dokumentasi operator):

```json
{
  "name": "default",
  "config": {
    "webhooks": [
      {
        "url": "https://notifhub.example.com/api/v1/webhooks/waha/events",
        "events": ["message.ack"],
        "hmac": { "key": "<nilai WAHA_WEBHOOK_HMAC_KEY>" },
        "retries": { "policy": "exponential", "delaySeconds": 2, "attempts": 5 }
      }
    ]
  }
}
```

Alternatif global env WAHA: `WHATSAPP_HOOK_URL`, `WHATSAPP_HOOK_EVENTS=message.ack`,
`WHATSAPP_HOOK_HMAC_KEY`. Jangan memakai `WHATSAPP_HOOK_EVENTS=*`.

## 7. Pemetaan status

| `ackName` | `ack` | event NotifHub | Efek pada recipient |
|---|---|---|---|
| `ERROR` | -1 | `failed` | status `failed` bila belum `sent`/`read`; pesan error generik/`payload.error` |
| `PENDING` | 0 | — (diabaikan) | tidak ada perubahan |
| `SERVER` | 1 | `sent` | status `sent`, isi `sentAt` |
| `DEVICE` | 2 | `delivered` | isi `deliveredAt` |
| `READ` | 3 | `read` | status `read`, isi `readAt` |
| `PLAYED` | 4 | `read` | status `read` (tidak ada status `played`) |

`PENDING` tidak dipetakan ke `sent` karena WAHA baru mengirim `SERVER` setelah pesan diterima
server WhatsApp; memetakan `PENDING` akan membuat status terlalu optimistis. Nilai `ack` yang tidak
dikenal diabaikan dan dihitung `ignored`.

## 8. Konfigurasi

Env baru (semua opsional secara schema; wajib bila `WHATSAPP_PROVIDER=waha`):

| Env | Default | Catatan |
|---|---|---|
| `WHATSAPP_PROVIDER` | `meta` | `meta` atau `waha` |
| `WAHA_BASE_URL` | — | Contoh `http://waha:3000` (tanpa slash akhir) |
| `WAHA_API_KEY` | — | Dikirim sebagai `X-Api-Key`; jangan pernah di-log |
| `WAHA_SESSION` | `default` | Nama sesi yang sudah `WORKING` |
| `WAHA_WEBHOOK_HMAC_KEY` | — | Secret HMAC-SHA512; minimal 32 karakter |

Validasi `superRefine` di `src/config/env.schema.ts`:

- `WHATSAPP_PROVIDER=waha` → `WAHA_BASE_URL`, `WAHA_API_KEY`, `WAHA_WEBHOOK_HMAC_KEY` wajib;
  `WAHA_SESSION` minimal 1 karakter.
- `WHATSAPP_PROVIDER=meta` → env WAHA diabaikan; aturan pasangan Meta yang sudah ada tetap.
- `WAHA_WEBHOOK_HMAC_KEY` minimal 32 karakter.

Contoh `.env`:

```dotenv
WHATSAPP_PROVIDER=waha
WAHA_BASE_URL=http://127.0.0.1:3001
WAHA_API_KEY=ganti-dengan-key-acak-minimal-16-karakter
WAHA_SESSION=default
WAHA_WEBHOOK_HMAC_KEY=ganti-dengan-secret-acak-minimal-32-karakter
WHATSAPP_CATCH_ALL_RECIPIENT=+628999999999
```

Dokumentasi tabel ditambahkan ke `docs/getting-started/configuration.md` pada bagian WhatsApp
(opsional), termasuk peringatan bahwa `WAHA_BASE_URL` di NotifHub berbeda dari env `WAHA_BASE_URL`
milik container WAHA (yang hanya memengaruhi URL media).

## 9. Keamanan, privasi, dan operasi

1. **API key WAHA** hanya dikirim ke `WAHA_BASE_URL`; tidak masuk log, error message, audit, atau
   `lastError`. Error HTTP dari WAHA dipotong dan tidak boleh memuat URL berkunci.
2. **HMAC** memakai secret terpisah dari Meta; rotasi cukup ganti `WAHA_WEBHOOK_HMAC_KEY` di
   NotifHub dan session WAHA.
3. **Webhook tidak memakai JWT/API key NotifHub**; trust boundary adalah HMAC + HTTPS. Endpoint
   tetap terkena body limit dan request-id middleware.
4. **Data minimal**: `delivery_events.rawPayload` hanya field status; body pesan dan `_data` tidak
   disimpan. Log hanya berisi `notification_id`, `session`, `ack`, dan jumlah event.
5. **Session persistence**: volume WAHA harus persisten; QR dipindai sekali oleh operator. Jika
   session `FAILED`/logout, operator harus scan ulang; NotifHub tidak mengelola QR.
6. **Mode staging** tetap memakai catch-all sehingga uji produksi tidak mengirim ke nomor asli.
7. **Readiness**: `/ready` NotifHub tidak bergantung pada WAHA (sama seperti Meta); kegagalan WAHA
   terlihat dari provider error metrics, `delivery_attempts`, dan log `waha.api_error`.
8. **WAHA wajib di belakang HTTPS** dan tidak diekspos publik tanpa API key; dashboard/Swagger WAHA
   dilindungi kredensial operator.

## 10. Multi-tenant dan batasan

- Semua tenant memakai **satu nomor WAHA** yang sama pada fase ini. Ini bukan kebocoran data
  (pesan tetap tenant-scoped di DB), tetapi identitas pengirim tidak per-tenant.
- Untuk komersialisasi multi-tenant, diperlukan tabel mapping `tenantId -> WAHA session/nomor`
  dan UI pengelolaan; itu fase terpisah.
- WAHA mengirim pesan ke nomor apa pun (tidak ada aturan 24 jam/template Meta), tetapi justru
  karena itu risiko banned lebih tinggi; lihat §13.
- Nomor khusus (mis. Brazil/Mexico) yang butuh `chatId` hasil lookup tidak ditangani; kirim dengan
  nomor E.164 standar.

## 11. Perubahan kode dan daftar file

### Baru

| File | Isi |
|---|---|
| `src/providers/waha/waha.provider.ts` | `sendText`, normalisasi nomor, catch-all, error mapping |
| `src/providers/waha/waha.types.ts` | Tipe request/response/error + helper `toWahaChatId` |
| `src/webhooks/waha/waha-webhook.controller.ts` | `POST /webhooks/waha/events` |
| `src/webhooks/waha/waha-webhook.service.ts` | Parse `message.ack` + panggil `applyDeliveryStatus` |
| `src/webhooks/waha/waha-signature.service.ts` | HMAC-SHA512 + timing-safe |
| `src/webhooks/waha/waha-webhook.module.ts` | Wiring |
| `test/waha.provider.unit-spec.ts` | Payload, chatId, log-only, staging, error |
| `test/waha-signature.unit-spec.ts` | Signature valid/salah/algoritma |
| `test/waha-webhook.unit-spec.ts` | Mapping ack, event asing, payload minimal |
| `docs/design/whatsapp-waha-provider.md` | Dokumen ini |

### Diubah

| File | Perubahan |
|---|---|
| `src/providers/provider-registry.service.ts` | Pilih `WahaProvider`/`WhatsAppProvider` dari `WHATSAPP_PROVIDER` |
| `src/providers/providers.module.ts` | Daftarkan `WahaProvider` |
| `src/app.module.ts` | Import `WahaWebhookModule` |
| `src/config/env.schema.ts` | Env WAHA + `superRefine` |
| `.env.example`, `.env.prod.example` | Variabel WAHA (opsional, berkomentar) |
| `test/env.ts` | `WAHA_WEBHOOK_HMAC_KEY` untuk E46 (provider tetap `meta`) |
| `test/app.e2e-spec.ts` | E46 webhook WAHA |
| `docs/getting-started/configuration.md` | Tabel env WAHA |
| `docs/README.md`, `docs/design/README.md` | Indeks dokumen |
| `docs/architecture/project-brief.md`, `docs/operations/production-readiness.md` | Status setelah implementasi |

Tidak ada perubahan `prisma/schema.prisma`, `package.json`, `@notifhub/js`, `@notifhub/react`,
console, Go SDK, atau `docker-compose.prod.yml`.

## 12. Verifikasi

### 12.1 Otomatis (CI)

| Test | Cakupan |
|---|---|
| `waha.provider.unit-spec.ts` | `development` tidak memanggil HTTP; `staging` memakai catch-all; `production` memakai nomor asli; body/header `sendText`; `chatId` tanpa `+`; 2xx tanpa `id` → 502; 401 → config error; 500 → retryable; timeout |
| `waha-signature.unit-spec.ts` | HMAC-SHA512 valid; signature salah; algoritma salah; secret kosong |
| `waha-webhook.unit-spec.ts` | `SERVER`/`DEVICE`/`READ`/`PLAYED`/`ERROR`/`PENDING`; event `message` diabaikan; `rawPayload` tanpa `_data`; id tak dikenal `ignored` |
| E46 (`test/app.e2e-spec.ts`) | Seed recipient dengan `providerMessageId` unik; ack `DEVICE` → `deliveredAt`, `READ` → `read`; HMAC salah → 401; event asing → 202; id tak dikenal → 202 tanpa event baru |
| Regresi | `npm run ci` tetap lulus; e2e 45 → 46; unit bertambah dengan 3 spec baru; 14 migrasi |

E2E tidak memanggil WAHA sungguhan: `NOTIFHUB_MODE=development` membuat provider log-only, dan
webhook diuji langsung dengan HMAC yang dihitung test. Ini pola yang sama dengan webhook Meta.

### 12.2 Smoke test manual (wajib sebelum dianggap selesai)

1. Jalankan WAHA (container, volume persisten) dengan API key + HMAC key; buat session `default`
   dan scan QR sampai `WORKING`.
2. Isi env NotifHub (`WHATSAPP_PROVIDER=waha`, `WAHA_*`) dan restart backend; pastikan startup log
   menyebut provider `waha` tanpa membocorkan key.
3. Kirim notifikasi WhatsApp uji ke nomor sendiri (mode `staging` + catch-all, lalu `production`
   bila aman); cek `waha.sent`, `providerMessageId` terisi, `delivery_attempts` sukses.
4. Amati `message.ack` di dashboard WAHA/Event Monitor: `SERVER` → `sent`, `DEVICE` → `delivered`,
   `READ` → `read` di detail notifikasi.
5. Matikan WAHA → kirim → error retryable + circuit breaker; hidupkan → pulih.
6. Signature salah → `401`; event asing → `202`; id tak dikenal → `202`.

Smoke test ini tidak masuk CI karena membutuhkan nomor WhatsApp nyata dan scan QR; hasilnya dicatat
di §Catatan implementasi saat fase ini dikerjakan.

## 13. Risiko

1. **Tidak resmi dan berisiko banned.** Dokumentasi WAHA sendiri menyatakan proyek tidak
   berafiliasi dengan WhatsApp dan tidak menjamin nomor tidak diblokir. Gunakan hanya untuk
   deployment yang menerima risiko ini; Meta Cloud API tetap default dan direkomendasikan untuk
   produksi kritis.
2. **Session rapuh.** QR harus dipindai ulang setelah logout/`FAILED`; volume harus persisten;
   upgrade image WAHA dapat mengubah perilaku engine.
3. **Satu nomor untuk semua tenant.** Tidak ada isolasi identitas pengirim; pelanggan melihat nomor
   yang sama.
4. **At-least-once.** Retry BullMQ dapat mengirim ulang pesan setelah timeout; status webhook
   monotonik mencegah downgrade, tetapi duplikat pesan mungkin terjadi (sama seperti provider Meta).
5. **Perbedaan engine.** Format `id`, ketersediaan `ack`, dan perilaku `message.ack` dapat berbeda
   antar engine WAHA; pilih satu engine, pin versi image, dan uji ulang saat upgrade.
6. **Endpoint webhook publik.** Hanya dilindungi HMAC; tanpa rate limit tambahan. Body limit 64 KB
   dan signature wajib membatasi penyalahgunaan.
7. **Tidak ada media/pesan masuk.** Kebutuhan tersebut tetap harus memakai jalur lain.

## 14. Pertanyaan persetujuan

1. Setuju menambahkan WAHA sebagai **provider opsional** dengan default tetap `meta` (D1–D3)?
2. Setuju fase ini memakai **satu sesi per deployment** (bukan per tenant) (D2)?
3. Setuju **endpoint webhook baru** `/api/v1/webhooks/waha/events` dengan HMAC-SHA512 dan
   `providerName=waha` (D4–D7)?
4. Setuju pemetaan ack: `PENDING` diabaikan, `PLAYED` → `read`, dan error 401/403/404/422
   non-retryable (D5, D8)?
5. Apakah Anda menerima risiko **tidak resmi/banned** dan bersedia menyediakan nomor + scan QR
   untuk smoke test manual (D1)?
6. Setuju tanpa dependency baru, tanpa migrasi, dan media/pesan masuk di luar cakupan (D9–D11)?

Setelah disetujui, implementasi dimulai dari provider + unit test, lalu webhook + E46, lalu
smoke test manual dan dokumentasi status.

## 15. Catatan implementasi

Implementasi selesai pada 2026-11-20 dan disetujui dengan D1–D11. Status verifikasi: **otomatis
lulus**; smoke test WAHA nyata belum dijalankan karena membutuhkan nomor WhatsApp dan scan QR
(lihat §15.3).

Yang sudah berjalan:

- `WahaProvider` (`name = waha`, channel `whatsapp`) memakai `POST {WAHA_BASE_URL}/api/sendText`
  dengan `X-Api-Key`, `chatId` tanpa `+` + `@c.us`, `linkPreview: false`, timeout 9 detik, dan mode
  `development`/`staging`/`production` yang sama dengan provider Meta.
- `ProviderRegistry` memilih provider dari `WHATSAPP_PROVIDER` (default `meta`) dan menulis log
  boot `provider.whatsapp.selected` tanpa secret. Worker dan test send otomatis memakai pilihan
  tersebut.
- Webhook `POST /api/v1/webhooks/waha/events` dengan HMAC-SHA512 atas raw body, pemetaan
  `message.ack` (`SERVER`/`DEVICE`/`READ`/`PLAYED`/`ERROR`; `PENDING` diabaikan), dan payload
  minimal tanpa `_data`/body.
- Env `WHATSAPP_PROVIDER`, `WAHA_BASE_URL`, `WAHA_API_KEY`, `WAHA_SESSION`, dan
  `WAHA_WEBHOOK_HMAC_KEY` masuk schema (validasi wajib bila provider `waha`, HMAC minimal 32
  karakter), `.env.example`, `.env.prod.example`, dan `docs/getting-started/configuration.md`.

Verifikasi:

| Pemeriksaan | Hasil |
|---|---|
| `npm run test:unit` | **62** test lulus (13 suite); 32 test baru untuk WAHA |
| `npm run test:e2e` | **46** test lulus; E46 lulus (ack DEVICE/READ, duplikat, PENDING, event asing, id tak dikenal, HMAC salah, algoritma hilang) |
| `npm run ci` | lulus **95 s**; typecheck, build, 62 unit, 46 e2e, 14 migrasi, `Database schema is up to date!` |
| Perubahan schema/migrasi | tidak ada (tetap 14) |
| Dependency baru | tidak ada |
| `npm run docs:check` | lulus (511 tautan/anchor, 42 file) |
| `console:typecheck`/`console:build`, `sdk:typecheck`/`sdk:test` | lulus; tidak ada perubahan pada console/SDK |

Deviasi dan catatan:

1. **Fallback `_data.id`.** Respon `sendText` diambil dari `id`; bila engine tidak menyediakannya,
   `_data.id` dipakai sebagai fallback sebelum dianggap gagal 502. Ini defensif terhadap perbedaan
   engine yang didokumentasikan WAHA.
2. **Log boot** `provider.whatsapp.selected` ditambahkan agar operator bisa memastikan provider
   yang aktif tanpa membaca secret.
3. **E2E tidak memanggil WAHA nyata.** E46 membuat notification/recipient langsung lewat Prisma,
   lalu mengirim webhook bertanda tangan; provider HTTP diuji unit dengan `fetch` mock. Ini
   menghindari ketergantungan pada nomor WhatsApp di CI.
4. **Smoke test WAHA nyata belum dijalankan.** Langkah §12.2 tetap menjadi gate operator: jalankan
   container WAHA, scan QR, isi env, kirim pesan uji, dan amati `waha.sent` serta `message.ack`.
   Status dokumen ini akan diperbarui setelah smoke test dilakukan.
5. Tidak ada perubahan kontrak HTTP publik, console, SDK, atau `docker-compose.prod.yml`; deployment
   WAHA tetap terpisah di sisi operator.
