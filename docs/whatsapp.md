# Desain kanal WhatsApp (Meta Cloud API)

Status: terimplementasi dan terverifikasi.
Basis: PART 1 (aturan 4, 15, 17, 22–24, 38–45) dan fondasi platform notifikasi yang sudah
berjalan (`docs/in-app.md`, `docs/email-and-preferences.md`, `docs/webhooks.md`).

---

## 1. Ruang lingkup

### Termasuk dalam dokumen ini

1. **`WhatsAppProvider`** (Meta WhatsApp Cloud API) di `src/providers/whatsapp/`, memakai
   `ProviderExecutor` (circuit breaker) yang sudah ada.
2. **Worker WhatsApp** untuk queue `notification:whatsapp`: resolve nomor, cek preferensi,
   render template, kirim lewat provider, update status, tulis `delivery_attempts`.
3. **Webhook WhatsApp** `GET/POST /api/v1/webhooks/whatsapp`:
   - `GET` verifikasi `hub.mode`/`hub.verify_token`/`hub.challenge`,
   - `POST` dengan signature `X-Hub-Signature-256` (HMAC app secret),
   - status `sent`/`delivered`/`read`/`failed` ditulis ke `delivery_events` dan memperbarui
     `notification_recipients` (aturan 25).
4. **Mode runtime**: development log-only, staging redirect ke nomor catch-all, production
   nomor asli.
5. **Rate limit** memakai limiter queue WhatsApp yang sudah terpasang
   (`PROVIDER_RATE_LIMIT_WHATSAPP_PER_SEC`).
6. Alat verifikasi lokal `scripts/dev-whatsapp-stub.mjs` (HTTP stub Cloud API) dan `.env.example`.

### Tidak termasuk (di luar cakupan)

- WhatsApp template pesan resmi (Meta-approved templates) — butuh pemetaan template provider;
  lihat D2.
- Media/attachment, pesan interaktif, OTP flow khusus.
- Multi-provider WhatsApp (Twilio/360dialog).
- Go SDK (lihat `docs/go-sdk.md`), platform admin, end-user preference center
  (lihat `docs/preference-center.md`).
- Balasan/percakapan masuk (inbound message handling) selain status webhook.

---

## 2. Alur data

```
ingest (channels: ["whatsapp"])
  -> NotificationRecipient(status=pending, channel=whatsapp)
  -> queue notification:whatsapp
  -> WhatsAppProcessor.process(job)
       1. readiness gate
       2. load recipient + notification (tenant, priority)
       3. terminal? -> skip
       4. resolve template (akun tenant, channel whatsapp, locale)
       5. preferensi: enabled / quiet hours / fallback channel
       6. resolve nomor: recipientOverride.phone -> Subscriber.phone -> skipped(no_address)
       7. render subject/body
       8. ProviderExecutor.execute(WhatsAppProvider, ...)
       9. update recipient (sent, sentAt, providerMessageId=wamid, attempts+1)
      10. delivery_attempts(success) + metrics latency
```

Provider call gagal: status `failed`, `lastError`, satu baris `delivery_attempts` gagal,
`notifhub_provider_errors_total`, lalu BullMQ retry (5x exponential). Circuit breaker terbuka
melempar error retryable.

---

## 3. WhatsApp Cloud API

### 3.1 Endpoint provider

- Base URL `WHATSAPP_API_BASE_URL` (default `https://graph.facebook.com`).
- `POST {base}/{WHATSAPP_API_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages`.
- Header `Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}`, `Content-Type: application/json`.
- Body (teks biasa):

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "+628123456789",
  "type": "text",
  "text": { "preview_url": false, "body": "Halo Budi, ..." }
}
```

- Response sukses `200` dengan `messages[0].id` (wamid) → `providerMessageId`.
- Response non-2xx → `ProviderSendError` dengan status dan pesan dari
  `error.message`/`error.code`.
- Timeout/circuit breaker ditangani `ProviderExecutor` (10 detik, dst).

### 3.2 Batasan produk (penting)

Meta mewajibkan **approved template** untuk pesan business-initiated di luar jendela layanan
24 jam. Kanal WhatsApp mengirim `type: "text"` (cocok untuk jendela 24 jam dan testing). Pemetaan
template Meta (nama template + parameter) membutuhkan kolom baru pada `NotificationTemplate`
dan proses approval, sehingga ditunda (D2). Batasan ini didokumentasikan di README dan dokumen
ini.

---

## 4. Worker WhatsApp

- `src/workers/whatsapp.processor.ts`, `@Processor(QUEUE_NAME_WHATSAPP)`.
- Mengikuti pola `EmailProcessor` (context, preferensi, attempts, metrics) dengan perbedaan:
  alamat = nomor telepon, provider = `whatsapp`.
- **Normalisasi nomor:** buang spasi/`-`/`()`, wajib diawali `+`, 8–15 digit setelah `+`.
  Nomor invalid dianggap `no_address` (skip, bukan gagal request).
- **Preferensi & quiet hours** berlaku sama (channel `whatsapp`); fallback channel mengikuti
  `template.fallbackChannel` bila channel dinonaktifkan.
- **Mode:**
  - `development`: provider log-only (`whatsapp.log_only`), tidak memanggil API, mengembalikan
    `providerMessageId: 'dev-log-only'`.
  - `staging`: nomor tujuan diganti `WHATSAPP_CATCH_ALL_RECIPIENT` (fallback ke
    `CATCH_ALL_RECIPIENT` bila nilainya terlihat seperti nomor telepon).
  - `production`: nomor asli.
- Concurrency default (1), limiter queue WhatsApp sudah aktif di BullMQ.

---

## 5. Webhook WhatsApp

### 5.1 Verifikasi (GET)

`GET /api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`

- Cocokkan `hub.verify_token` dengan `WHATSAPP_VERIFY_TOKEN` (timing-safe).
- Jika cocok → `200 text/plain` berisi `hub.challenge`; jika tidak → `403`.

### 5.2 Event (POST)

`POST /api/v1/webhooks/whatsapp` dengan header `X-Hub-Signature-256: sha256=<hex>`.

- Signature = HMAC-SHA256(raw body, `WHATSAPP_APP_SECRET`), dibandingkan `timingSafeEqual`.
- Signature salah → `401`; body invalid → `400`.
- Body Cloud API berisi `entry[].changes[].value.statuses[]` dengan
  `id` (wamid), `status` (`sent`/`delivered`/`read`/`failed`), `timestamp`, `recipient_id`,
  dan `errors[]` untuk kegagalan.
- Untuk setiap status:
  1. cari recipient berdasarkan `providerMessageId = wamid` (fallback: `recipientId` +
     channel); tidak ditemukan → catat event dengan `notificationId` tidak diketahui?
     (lihat D5) → `202` ignored.
  2. tulis `delivery_events` (provider `whatsapp`, tipe status, raw payload).
  3. update `notification_recipients` secara monotonik (`sent`→`delivered`→`read`;
     `failed` tidak menurunkan status yang lebih tinggi).
- Response selalu `202 {"status":"accepted"}` untuk signature valid, termasuk event yang
  tidak dikenal (retry-friendly).
- Signature diverifikasi atas **raw body** (capture `req.rawBody` sudah ada sejak webhook
  provider generik — lihat `docs/webhooks.md`).

### 5.3 Idempotensi

- Duplikat event diperbolehkan (append-only); update status memakai aturan monotonik dan
  timestamp hanya diisi bila kosong.
- Event Meta yang sama dikirim ulang tidak menghasilkan perubahan status ganda.

---

## 6. Konfigurasi

Env baru (opsional; divalidasi berpasangan):

| Env | Default | Wajib bila |
|---|---|---|
| `WHATSAPP_API_BASE_URL` | `https://graph.facebook.com` | provider digunakan |
| `WHATSAPP_API_VERSION` | `v21.0` | provider digunakan |
| `WHATSAPP_PHONE_NUMBER_ID` | — | provider digunakan |
| `WHATSAPP_ACCESS_TOKEN` | — | provider digunakan |
| `WHATSAPP_APP_SECRET` | — | webhook digunakan |
| `WHATSAPP_VERIFY_TOKEN` | — | webhook digunakan |
| `WHATSAPP_CATCH_ALL_RECIPIENT` | — | staging WhatsApp |

Aturan validasi: jika salah satu `WHATSAPP_PHONE_NUMBER_ID`/`ACCESS_TOKEN` diisi, keduanya wajib
(D7). Jika `WHATSAPP_APP_SECRET`/`VERIFY_TOKEN` diisi, keduanya wajib. Tidak ada perubahan
`schema.prisma`; versi root `0.7.0`.

---

## 7. Daftar file

### Baru

| File | Isi |
|---|---|
| `src/providers/whatsapp/whatsapp.provider.ts` | Cloud API client + log-only + catch-all + normalisasi nomor |
| `src/providers/whatsapp/whatsapp.types.ts` | Tipe request/response Cloud API + error |
| `src/workers/whatsapp.processor.ts` | Worker WhatsApp |
| `src/webhooks/whatsapp/whatsapp-webhook.controller.ts` | GET verify + POST event |
| `src/webhooks/whatsapp/whatsapp-webhook.service.ts` | Mapping statuses → event netral + update recipient |
| `src/webhooks/whatsapp/whatsapp-signature.service.ts` | Verifikasi `X-Hub-Signature-256` |
| `src/webhooks/whatsapp/whatsapp-webhook.module.ts` | Wiring |
| `scripts/dev-whatsapp-stub.mjs` | Stub Cloud API untuk verifikasi lokal |
| `docs/whatsapp.md` | Dokumen ini |

### Diubah

| File | Perubahan |
|---|---|
| `src/providers/provider-registry.service.ts` | Daftarkan `WhatsAppProvider` |
| `src/providers/providers.module.ts` | Provider WhatsApp |
| `src/workers/workers.module.ts` | `WhatsAppProcessor` |
| `src/webhooks/webhooks.module.ts` | Import modul webhook WhatsApp |
| `src/webhooks/webhooks.service.ts` | Ekstrak helper `applyProviderStatus` agar dipakai ulang |
| `src/config/env.schema.ts` | Env WhatsApp + validasi berpasangan |
| `.env.example`, `.env` | Variabel WhatsApp (kosong di dev) |
| `package.json`, `README.md`, `docs/local-setup.md` | Versi + dokumentasi |

Tidak ada perubahan `@notifhub/js`, `@notifhub/react`, atau console (WhatsApp dikelola lewat
API/console yang sudah ada; template channel `whatsapp` bisa dibuat dari console).

---

## 8. Verifikasi

1. Typecheck/build backend, SDK test, React/console tetap hijau.
2. `scripts/dev-whatsapp-stub.mjs` berjalan di `127.0.0.1:2526`; set env WhatsApp ke stub,
   mode `staging` dengan catch-all → ingest `whatsapp`:
   - stub menerima `to = catch-all`, body ter-render;
   - recipient `sent`, `providerName=whatsapp`, `providerMessageId` = wamid dari stub.
3. Mode `production` + stub → `to` = nomor subscriber/override.
4. Mode `development` → log `whatsapp.log_only`, `providerMessageId=dev-log-only`, tanpa HTTP call.
5. Tanpa nomor (subscriber tanpa phone, tanpa override) → `skipped` (`no_address`), 0 attempt.
6. Preferensi `enabled=false` → `skipped` (`preference_disabled`); quiet hours → deferred;
   fallback channel tetap bekerja.
7. Webhook:
   - `GET` verify token benar → 200 challenge; salah → 403.
   - `POST` signature valid: `delivered`/`read`/`failed` → status & timestamp benar,
     satu baris `delivery_events` per event.
   - signature salah → 401; body invalid → 400; wamid tidak dikenal → 202 ignored.
   - duplikat event → status tidak berubah ganda.
8. Circuit breaker: stub dimatikan → error provider, `provider.circuit.open`, retry; stub
   dihidupkan lagi → pulih.
9. Metrics `notifhub_delivery_latency_seconds{provider="whatsapp"}`, provider errors.
10. Admin/console: template channel `whatsapp` bisa dibuat; notifikasi WhatsApp tampil di
    daftar/detail beserta attempts/events.

---

## 9. Keputusan desain

| # | Keputusan | Usulan default |
|---|---|---|
| D1 | Vendor pertama: Meta WhatsApp Cloud API (Graph API) | Ya |
| D2 | Kanal WhatsApp mengirim `type: "text"`; approved-template ditunda (butuh kolom pemetaan template) | Ya |
| D3 | Normalisasi nomor: buang spasi/`-`/`()`, wajib `+` dan 8–15 digit; invalid → `no_address` | Ya |
| D4 | Staging: `WHATSAPP_CATCH_ALL_RECIPIENT` (fallback `CATCH_ALL_RECIPIENT` bila terlihat nomor) | Ya |
| D5 | Webhook Events untuk wamid tak dikenal → `202` ignored (append-only, retry-friendly) | Ya |
| D6 | Reuse `delivery_events` + update status monotonik lewat helper bersama `WebhooksService` | Ya |
| D7 | Env WhatsApp opsional tetapi divalidasi berpasangan (fail fast bila setengah diisi) | Ya |
| D8 | Tambah `scripts/dev-whatsapp-stub.mjs` untuk verifikasi lokal (bukan service compose) | Ya |
| D9 | Tanpa perubahan schema/dependency baru; versi `0.7.0` | Ya |
| D10 | Tidak ada inbound message/reply handling pada kanal WhatsApp ini | Ya |

---

## 10. Catatan implementasi

1. **Path webhook** menjadi `/api/v1/webhooks/whatsapp/events` (bukan `/webhooks/whatsapp`) agar
   tidak bertabrakan dengan `POST /webhooks/:provider` generik (lihat `docs/webhooks.md`).
2. **Wamid tak dikenal** dibalas `202` dan hanya di-log; `delivery_events` membutuhkan
   `notificationId`, sehingga event yang tidak terpetakan tidak disimpan.
3. **`ProviderConfigurationError`** diterjemahkan menjadi `UnrecoverableError` di worker, supaya
   konfigurasi yang belum diisi tidak memicu retry storm.
4. **Status webhook** memakai helper bersama `WebhooksService.applyDeliveryStatus`; transisi tetap
   monotonik (`failed` setelah `read` diabaikan, event tetap dicatat).
5. **Staging** tetap mewajibkan `CATCH_ALL_RECIPIENT` (lihat `docs/email-and-preferences.md`);
   WhatsApp memakai `WHATSAPP_CATCH_ALL_RECIPIENT`, dengan fallback ke `CATCH_ALL_RECIPIENT` bila
   nilainya berupa nomor telepon.
6. **Verifikasi:** stub menerima `to=+628999999999` (staging) dan `to=+628123456789`
   (production); webhook `delivered`/`read`/`failed` tersimpan sebagai 3 event dengan status akhir
   `read`; signature salah `401`; verify token salah `403`; wamid tak dikenal `202`.
7. **Batasan yang disengaja:** kanal WhatsApp mengirim `type: "text"`; approved template Meta dan
   inbound message handling ditunda.
8. **Versi root** `0.7.0`; tidak ada perubahan schema, `@notifhub/js`, `@notifhub/react`, atau
   dependency baru.

---

## 11. Template WhatsApp v2 (2026-11-16)

- Template WhatsApp hanya `format=text`, tanpa subject/preheader/layout/theme/partial; batas
  4.096 karakter setelah render. Provider tetap mengirim `type: "text"`.
- Schema variabel, draft/publish, preview, dan audit mengikuti `docs/template-system-design.md`.
  Pemetaan Meta approved-template tetap ditunda.
