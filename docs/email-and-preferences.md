# Desain email, abstraksi provider, dan preferensi

Status: terimplementasi dan terverifikasi.
Basis: PART 1 (aturan 4, 15, 17, 22–24, 38–45), fondasi ingest/queue (`docs/local-setup.md`), dan implementasi in-app (`docs/in-app.md`).

---

## 1. Ruang lingkup

### Termasuk dalam dokumen ini

1. **Provider abstraction** di `src/providers/`:
   - interface `NotificationProvider`
   - `InAppProvider` (refactor dari worker in-app — lihat `docs/in-app.md`; tetap publish ke Redis)
   - `EmailProvider` (SMTP via `@nestjs-modules/mailer` + `nodemailer`)
   - `ProviderExecutor` yang membungkus setiap panggilan provider dengan circuit breaker `opossum`,
     timeout, dan logging state breaker.
2. **Worker email** (`notification:email`): resolve alamat, cek preferensi, resolve + render
   template email (Handlebars), panggil provider, update status, tulis `delivery_attempts`.
3. **Enforcement preferensi** untuk semua worker (in-app dan email):
   - `enabled=false` → status `skipped`, alasan `preference_disabled`
   - quiet hours (kecuali `priority=critical`) → job ditunda sampai akhir window
   - fallback channel bila channel utama dinonaktifkan dan template punya `fallbackChannel`
4. **Render template dengan Handlebars** untuk subject + body (menggantikan interpolasi minimal
   pada worker in-app), tetap mendukung rantai locale: `recipientOverride.locale` →
   `Subscriber.locale` → `DEFAULT_LOCALE` → error.
5. **Subscriber API** (push-sync): `PUT /api/v1/subscribers/:externalId` dan
   `GET /api/v1/subscribers/:externalId` dengan `X-API-Key`.
6. **Mode runtime** untuk email: `development` log-only (tidak pernah kirim), `staging` kirim ke
   `CATCH_ALL_RECIPIENT`, `production` kirim ke penerima asli.
7. **Rate limit provider email** memakai limiter queue yang sudah terpasang pada fondasi ingest
   (`PROVIDER_RATE_LIMIT_EMAIL_PER_SEC`).

### Tidak termasuk (dokumen lain)

- WhatsApp provider + worker (lihat `docs/whatsapp.md`).
- Admin API / ApiKey table dan topic (lihat `docs/admin-api.md`).
- End-user preference center (lihat `docs/preference-center.md`) dan UI admin
  (lihat `docs/react-and-console.md`).
- Webhook status provider dan rollup `overallStatus` (lihat `docs/webhooks.md`).
- Cleanup job idempotency & retention (lihat D7 dan `docs/webhooks.md`).
- Scheduled/delayed notification dari consumer, batch ingest, digest.

---

## 2. Alur data email

```
ingest (channels termasuk email)
  -> NotificationRecipient(status=pending, channel=email)
  -> queue notification:email
  -> EmailProcessor.process(job)
       1. readiness gate (ReadinessService)
       2. load recipient row + notification (tenant, priority, payload)
       3. jika status sent/read/skipped -> skip (idempotent)
       4. resolve template email (locale chain, versi aktif tertinggi)
       5. evaluasi preferensi (enabled, quiet hours) -> deliver | skip | defer | fallback
       6. resolve alamat: recipientOverride.email -> Subscriber.email -> skip(no_address)
       7. render subject + body (Handlebars)
       8. ProviderExecutor.execute(EmailProvider, payload)  [circuit breaker + timeout]
       9. update notification_recipients (sent, sentAt, providerMessageId, attempts+1)
      10. tulis delivery_attempts(status=success, durationMs) + metrics latency
```

Kegagalan provider: status `failed`, `lastError`, satu baris `delivery_attempts` gagal,
`notifhub_provider_errors_total`, lalu throw agar BullMQ retry (5x exponential, sudah aktif).
Circuit breaker yang terbuka melempar error retryable, sehingga retry tetap terjadi sampai
provider pulih.

---

## 3. Provider abstraction + circuit breaker

### 3.1 Interface

```ts
export interface ProviderSendInput {
  notificationId: string;
  recipientId: string;
  tenantId: string;
  priority: number;
  templateKey: string;
  subject: string | null;
  body: string;
  data: Record<string, unknown>;
  to: string;            // alamat/nomor tujuan yang sudah di-resolve (email)
}

export interface ProviderSendResult {
  providerMessageId: string | null;
}

export interface NotificationProvider {
  readonly name: string;          // 'inapp' | 'smtp'
  readonly channel: Channel;      // Channel.inapp | Channel.email
  send(input: ProviderSendInput): Promise<ProviderSendResult>;
}
```

`InAppProvider.send` mem-publish event ke Redis (memindahkan logika worker in-app dari processor),
`EmailProvider.send` mengirim email.

### 3.2 ProviderExecutor

- Satu instance `opossum.CircuitBreaker` per provider (dibuat lazy, disimpan di Map).
- Opsi tetap (tanpa env baru, lihat D4): `timeout: 10_000`, `errorThresholdPercentage: 50`,
  `rollingCountTimeout: 10_000`, `resetTimeout: 30_000`.
- Event breaker (`open`, `halfOpen`, `close`) di-log (`provider.circuit.open`, dst).
- Saat breaker terbuka, `fire()` ditolak → dibungkus error retryable
  (`ProviderUnavailableError`) sehingga worker gagal dan BullMQ retry.
- Tidak ada retry loop di dalam provider; retry sepenuhnya milik BullMQ (menghindari retry storm).

### 3.3 Provider registry

`ProviderRegistry` memetakan `Channel` → `NotificationProvider`. `sms` dan `whatsapp` belum punya
provider; worker untuk channel tersebut baru dirancang di `docs/whatsapp.md`, jadi job tetap
menunggu.

---

## 4. Email channel

### 4.1 Konfigurasi

- `MailerModule.forRootAsync` dengan `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
  `SMTP_FROM` dan `pool: true`.
- **Validasi env baru:** di luar `development`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_FROM` wajib
  (fail fast saat startup). Di `development` email bersifat log-only sehingga SMTP tidak dipakai.

### 4.2 Mode runtime

| Mode | Perilaku EmailProvider |
|---|---|
| `development` | Tidak menyentuh SMTP. Log structured `email.log_only` berisi `to`, `subject`, `notificationId`. Mengembalikan `providerMessageId: 'dev-log-only'`. |
| `staging` | `to` diganti `CATCH_ALL_RECIPIENT` (wajib, sudah divalidasi skema env saat startup). Dikirim lewat SMTP. |
| `production` | Dikirim ke penerima asli. |

### 4.3 Subjek dan body

- Subject dirender dari `NotificationTemplate.subject` (boleh `null` → string kosong).
- Body dirender dari `NotificationTemplate.body`.
- Handlebars default escaping; template HTML memakai `{{{var}}}` bila ingin HTML mentah.
- Variabel diambil dari `Notification.payload.data`; variabel yang tidak ada menjadi string kosong.
- Template tidak ditemukan untuk semua locale → `UnrecoverableError` (`template_not_found`),
  status `failed`, satu attempt gagal, tanpa retry 5x.

### 4.4 Alamat penerima

Urutan: `recipientOverride.email` (dari job) → `Subscriber.email` (by `tenantId` + `externalId`)
→ `skipped` dengan alasan `no_address` (PART 1 rule 39, tidak menggagalkan request).
Jika `no_address`, tidak ada panggilan provider dan tidak ada `delivery_attempts`.

---

## 5. Preferensi + quiet hours

### 5.1 Sumber data

`NotificationPreference` unik per `(recipientId, channel)`. Jika tidak ada baris:
`enabled=true`, quiet hours kosong, timezone dari `Subscriber.timezone` (fallback
`Asia/Jakarta`).

### 5.2 Algoritma keputusan

```ts
type PreferenceDecision =
  | { action: 'deliver' }
  | { action: 'skip'; reason: 'preference_disabled' }
  | { action: 'defer'; delayMs: number; untilLocal: string }
  | { action: 'fallback'; channel: Channel; reason: 'preference_disabled' };
```

1. `enabled=false`:
   - jika template punya `fallbackChannel` (dan channel berbeda, dan belum pernah fallback) →
     `fallback`
   - selain itu → `skip` (`preference_disabled`)
2. Quiet hours hanya jika `priority !== 1` (critical):
   - `quietHoursStart` / `quietHoursEnd` format `HH:mm`; jika kosong/tidak valid → tidak quiet.
   - Start == End dianggap tidak aktif (konfigurasi membingungkan).
   - Window biasa (`start < end`): quiet jika `now >= start && now < end`.
   - Window lewat tengah malam (`start > end`): quiet jika `now >= start || now < end`.
   - Jika quiet → `defer` dengan delay = sisa menit sampai `end` di timezone preferensi + 1 menit,
     dibatasi maksimum 12 jam.
3. Selain itu → `deliver`.

Evaluasi hanya memakai jam/menit lokal (via `Intl.DateTimeFormat`), sehingga delay relatif benar
tanpa konversi wall-clock → UTC. Pergeseran DST dalam window diabaikan (didokumentasikan).

### 5.3 Deferral (quiet hours)

- Worker menambahkan kembali job yang sama ke queue channel itu dengan `delay` dan field
  `deferralCount + 1` (maksimum 3 deferral; setelah itu dikirim dengan warning
  `quiet_hours_max_deferrals`).
- Baris recipient tetap `pending`; tidak ada `delivery_attempts` karena belum ada percobaan kirim.
- Log `delivery.deferred` dengan `delay_ms`, `until_local`, `timezone`.
- Tidak ada perubahan status ke `skipped`, sehingga notifikasi tidak hilang.

### 5.4 Fallback channel

- Dari `NotificationTemplate.fallbackChannel` (kolom sudah ada sejak fondasi awal).
- Worker utama menandai baris channel asal `skipped` (`lastError='channel_disabled_fallback:<fallback>'`),
  lalu:
  1. `upsert` baris `NotificationRecipient` untuk channel fallback (status `pending`) — baris ini
     belum tentu ada karena ingest hanya membuat baris untuk channel yang diminta.
  2. enqueue job baru ke queue channel fallback dengan `fallbackFrom` di payload.
- Job hasil fallback tidak boleh fallback lagi (`fallbackFrom` terisi → skip dengan log).
- `sms`/`whatsapp` tanpa provider tidak dijadikan target fallback (log warning, tandai skipped).

---

## 6. Subscriber API

### 6.1 `PUT /api/v1/subscribers/:externalId`

- Auth: `X-API-Key` (`ApiKeyGuard`), tenant = `DEFAULT_TENANT_ID` (desain admin API di
  `docs/admin-api.md` menurunkannya per API key).
- Body (semua opsional, full replacement — lihat D10):

```json
{
  "email": "user@example.com",
  "phone": "+628123456789",
  "locale": "id",
  "timezone": "Asia/Jakarta",
  "metadata": { "plan": "pro" }
}
```

- Upsert pada `(tenantId, externalId)`; idempoten (PUT berulang menghasilkan satu baris).
- Validasi: `email` format email (maks 320), `phone` maks 32, `locale` maks 16, `timezone` harus
  IANA valid (dicek dengan `Intl.DateTimeFormat`), `metadata` objek JSON.
- `externalId` di path: string 1–128 karakter.
- Response `200`:

```json
{
  "id": "uuid",
  "tenantId": "default",
  "externalId": "user-123",
  "email": "user@example.com",
  "phone": null,
  "locale": "id",
  "timezone": "Asia/Jakarta",
  "metadata": { "plan": "pro" },
  "createdAt": "...",
  "updatedAt": "..."
}
```

### 6.2 `GET /api/v1/subscribers/:externalId`

- Auth `X-API-Key`; `200` dengan bentuk yang sama, `404` bila tidak ada.
- Catatan: ini bukan "pull" dari sistem consumer; ini baca data yang sudah di-push (PART 1 rule 39).

### 6.3 Tidak termasuk

- `DELETE` (menunggu keputusan D1).
- Endpoint preferensi end-user tidak termasuk di sini: preferensi end-user punya API self-service
  publik tersendiri — lihat `docs/preference-center.md`.

---

## 7. Perubahan schema, seed, env, dependency

- **Tidak ada perubahan `schema.prisma`** (semua kolom sudah ada: Subscriber, NotificationPreference,
  NotificationTemplate.fallbackChannel/fallbackProvider).
- **Seed** ditambah template email idempoten:
  `key=test.notification, channel=email, locale=id, version=1, active=true,
  subject="NotifHub test", body="<p>Halo {{nama}}, ini email tes dari NotifHub.</p>"`.
- **Env schema:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` wajib di luar `development`
  (superRefine baru). Variabel lain tidak berubah.
- **Dependency:** tidak ada yang baru — `@nestjs-modules/mailer`, `nodemailer`, `handlebars`,
  `opossum` sudah terpasang. `@types/nodemailer` dan `@types/opossum` juga sudah ada.
- **Root version** naik ke `0.3.0`.

---

## 8. Daftar file

### Backend — baru

| File | Isi |
|---|---|
| `src/providers/provider.interface.ts` | Interface + tipe `ProviderSendInput/Result`, error provider |
| `src/providers/provider-executor.service.ts` | Circuit breaker opossum + logging + timeout |
| `src/providers/provider-registry.service.ts` | Map channel → provider |
| `src/providers/in-app/in-app.provider.ts` | Provider in-app (publish Redis) |
| `src/providers/email/email.provider.ts` | Provider SMTP + log-only/dev + catch-all/staging |
| `src/providers/providers.module.ts` | MailerModule + provider wiring |
| `src/preferences/preferences.service.ts` | Baca preferensi + keputusan enabled/quiet hours |
| `src/preferences/quiet-hours.ts` | Parsing `HH:mm`, evaluasi window, delay |
| `src/preferences/preferences.module.ts` | Modul preferensi |
| `src/subscribers/subscribers.controller.ts` | `PUT` + `GET` subscriber |
| `src/subscribers/subscribers.service.ts` | Upsert/get subscriber |
| `src/subscribers/subscribers.module.ts` | Modul subscriber |
| `src/subscribers/dto/upsert-subscriber.dto.ts` | DTO + validasi timezone |
| `src/subscribers/dto/subscriber-response.dto.ts` | Schema response Swagger |
| `src/workers/email.processor.ts` | Worker email |
| `src/workers/delivery-worker.support.ts` | Helper bersama: load row, locale, preferensi, attempt, fallback |
| `scripts/dev-smtp-sink.mjs` | SMTP sink lokal untuk verifikasi staging/production (D8) |

### Backend — diubah

| File | Perubahan |
|---|---|
| `src/templates/template.service.ts` | Channel-aware (in-app + email), Handlebars, locale dari Subscriber |
| `src/workers/in-app.processor.ts` | Pakai provider + preferensi + fallback |
| `src/workers/workers.module.ts` | Daftarkan `EmailProcessor` |
| `src/app.module.ts` | `ProvidersModule`, `PreferencesModule`, `SubscribersModule` |
| `src/config/env.schema.ts` | SMTP wajib di luar development |
| `prisma/seed.ts` | Template email |
| `package.json` | versi 0.3.0 |
| `docs/local-setup.md`, `README.md` | Bagian email dan preferensi |

### SDK — tidak berubah

`@notifhub/js` tidak terpengaruh perubahan ini.

---

## 9. Verifikasi

1. `npm run typecheck`, `npm run build`, `npm run sdk:test` — semua hijau.
2. `PUT /api/v1/subscribers/user-test-1` dengan email + timezone → `200`; ulangi → baris tetap satu
   (`SELECT count(*)`), `updatedAt` berubah.
3. `GET` subscriber → `200`; externalId tidak ada → `404`; tanpa API key → `401`;
   email/timezone invalid → `400`.
4. Ingest notifikasi channel `email` untuk `user-test-1` (development) → worker selesai,
   recipient `sent`, `providerName='smtp'`, `providerMessageId='dev-log-only'`,
   satu `delivery_attempts` sukses, log `email.log_only` (tidak ada koneksi SMTP).
5. Template email tidak ada → status `failed`, satu attempt, `UnrecoverableError`, tanpa retry.
6. Recipient tanpa alamat email (subscriber tanpa email, tanpa override) → status `skipped`,
   alasan `no_address`, tidak ada attempt.
7. Preferensi `enabled=false` (insert via SQL): ingest email → status `skipped`
   (`preference_disabled`), tidak ada attempt.
8. Preferensi `enabled=false` + template `fallbackChannel='inapp'`: ingest email →
   baris email `skipped`, job in-app masuk dan notifikasi in-app terkirim (stream Redis bertambah).
9. Quiet hours: insert preferensi dengan window yang saat ini aktif di timezone tertentu →
   worker menunda (`delivery.deferred`, job `delayed` di BullMQ), status tetap `pending`,
   tidak ada attempt; ubah window agar tidak aktif lalu jalankan ulang → terkirim.
10. `priority=critical` menembus quiet hours → langsung terkirim.
11. Staging + SMTP sink lokal (`node scripts/dev-smtp-sink.mjs`): ingest email dengan
    `NOTIFHUB_MODE=staging` → sink menerima pesan dengan `to = CATCH_ALL_RECIPIENT`.
12. Production + SMTP sink: `to` = alamat penerima asli (bukan catch-all).
13. Circuit breaker: hentikan SMTP sink, ingest 3 email → log `provider.circuit.open` dan job
    retry/failed; nyalakan sink kembali → breaker `halfOpen`/`close` dan pengiriman pulih.
14. Metrics: `notifhub_delivery_latency_seconds{provider="smtp"}`, `notifhub_provider_errors_total`.
15. In-app tetap berjalan (regresi in-app — lihat `docs/in-app.md`): SSE replay/live, catch-up,
    read receipt.

---

## 10. Keputusan desain

| # | Keputusan | Pilihan yang diambil |
|---|---|---|
| D1 | Subscriber API hanya `PUT` + `GET`, tanpa `DELETE` | Ya (hapus data menyentuh audit; dibahas nanti) |
| D2 | Quiet hours = **tunda** job sampai akhir window (bukan skip), cap 12 jam, maks 3 deferral | Ya |
| D3 | Fallback channel hanya saat preferensi `enabled=false`; `fallbackProvider` reserved | Ya |
| D4 | Opsi circuit breaker sebagai konstanta (timeout 10s, 50%, reset 30s), tanpa env baru | Ya |
| D5 | Handlebars default escaping; HTML memakai `{{{ }}}` | Ya |
| D6 | `SMTP_*` wajib saat startup di staging/production, `development` log-only | Ya |
| D7 | Cleanup job idempotency/retention dijadwalkan bersama cleanup job webhook (`docs/webhooks.md`), butuh keputusan semantik arsip | Ya |
| D8 | Tambah `scripts/dev-smtp-sink.mjs` sebagai alat verifikasi lokal (bukan service compose) | Ya |
| D9 | Tidak menambah framework unit test backend; verifikasi lewat E2E + SQL (SDK tetap vitest) | Ya |
| D10 | `PUT` subscriber = full replacement (field yang tidak dikirim menjadi `null`, timezone default `Asia/Jakarta`) | Ya |

---

## 11. Catatan implementasi

1. **`MailerModule` berada di `ProvidersModule`**, bukan `AppModule`, agar konfigurasi SMTP
   melekat pada provider email. Transport dibuat lazy oleh nodemailer sehingga tidak ada koneksi
   SMTP saat development.
2. **`InAppProvider` mengembalikan stream id Redis sebagai `providerMessageId`.** Nilai ini
   sekarang ikut tersimpan di `notification_recipients.providerMessageId`, sehingga event in-app
   dapat dilacak dari database ke stream.
3. **Helper worker digabung** dalam `src/workers/delivery-worker.support.ts`
   (`DeliveryContextService`, `DeliveryAttemptsService`, `PreferenceEnforcementService`) sesuai
   daftar file desain; kedua processor memakai helper yang sama.
4. **`metadata` subscriber yang dikosongkan disimpan sebagai `Prisma.DbNull`** (SQL NULL), bukan
   JSON `null`.
5. **Prioritas timezone:** `NotificationPreference.timezone` (jika baris ada) → `Subscriber.timezone`
   → `Asia/Jakarta`. Subscriber timezone hanya dipakai bila preferensi belum ada.
6. **Job deferral quiet hours** membawa `deferralCount` di payload job (maksimum 3). Job yang
   ditunda tidak menulis `delivery_attempts` karena belum ada panggilan provider.
7. **Verifikasi** mencakup: Subscriber API, email log-only, `no_address`, preferensi nonaktif,
   fallback channel ke in-app, quiet hours + bypass critical, staging catch-all, production ke
   alamat asli, dan circuit breaker buka/tutup dengan SMTP sink lokal.
8. **Tidak ada perubahan `schema.prisma`** dan tidak ada dependency baru.

---

## 12. Template email kaya (2026-11-16)

Desain ada di `docs/template-system-design.md`.

- Body email adalah fragmen HTML Handlebars; layout opsional membungkus dengan `{{{body}}}`.
  Theme token JSON dan partial versioned direferensikan eksplisit oleh template.
- Subject email dirender sebagai teks header (tanpa HTML escaping, CR/LF dibuang); body/preheader
  memakai escaping HTML. Channel teks memakai `noEscape` agar `&`/`'` tidak menjadi entity.
- Publish memvalidasi sintaks Handlebars, variabel/sample, ukuran, dan HTML/CSS/URL berbahaya.
  Sanitizer output runtime menangani data dinamis dari `{{{ }}}`.
- Baris lama tetap terkirim lewat jalur body-only; tidak ada perubahan pada `EmailProvider`.
