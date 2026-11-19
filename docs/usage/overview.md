# Konsep dan quickstart

## Model data singkat

| Konsep | Arti | Catatan |
|---|---|---|
| **Tenant** | Ruang isolasi data | Ditentukan oleh API key (ingest) atau token (admin/subscriber); tidak pernah dari body |
| **API key** | Kredensial consumer | Hanya hash SHA-256 yang disimpan; raw key ditampilkan sekali. Metadata opsional: `subscriberJwtSecret` |
| **Subscriber** | Profil end-user milik consumer | Kunci: `(tenantId, externalId)`. Berisi `email`, `phone`, `locale`, `timezone` |
| **recipientId** | ID penerima | Sama dengan `externalId`; **hanya unik per tenant** |
| **Template** | Isi pesan per channel | Kunci: `(tenantId, key, channel, locale, version)`; `active` dan `fallbackChannel` |
| **Notification** | Satu permintaan kirim | Menyimpan `idempotencyKey`, `templateKey`, `payload`, `priority`, `targetType`, `overallStatus` |
| **NotificationRecipient** | Satu baris per penerima × channel | Sumber kebenaran status pengiriman per channel |
| **Topic** | Grup penerima | Dibuat otomatis saat membership di-push; bisa time-bound (`expiresAt`) |
| **Preference** | Pilihan end-user per channel | `enabled`, quiet hours, timezone; tenant-scoped |
| **DeliveryAttempt / DeliveryEvent** | Audit percobaan kirim & callback provider | Dipakai halaman detail notifikasi di console |

## Siklus hidup notifikasi

```
POST /api/v1/notify                       (consumer, X-API-Key)
  → validasi + cek idempotency
  → simpan Notification + satu NotificationRecipient per (recipient × channel)
  → enqueue satu job BullMQ per baris recipient
  → 202 { notification_id, status: "accepted" }

worker per channel
  → resolve template (key + channel + locale aktif)
  → evaluasi preferensi penerima (enabled, quiet hours)
  → kirim ke provider (email/WhatsApp) atau publish event (in-app)
  → update status baris recipient + catat DeliveryAttempt

callback provider (opsional)
  → POST /api/v1/webhooks/:provider (HMAC)
  → DeliveryEvent + update status monotonik (delivered/read tidak bisa diturunkan)

tiap menit
  → rollup overallStatus dari status semua recipient
```

### Status per recipient

| Status | Arti |
|---|---|
| `pending` | Sudah masuk queue, belum selesai diproses |
| `sent` | Berhasil dikirim ke provider / dipublikasikan ke in-app |
| `failed` | Provider menolak atau error setelah retry |
| `skipped` | Sengaja tidak dikirim (preferensi mati, tidak ada alamat, channel tanpa provider) |
| `read` | Dibaca (in-app: read receipt; email/WA: event `read` dari provider) |

### Status keseluruhan notification (`overallStatus`)

`pending` → `partial` / `sent` / `failed`, dihitung ulang tiap menit dari status recipient.

## Perilaku per channel

| Channel | Provider | Development | Syarat alamat | Mendukung preferensi & quiet hours |
|---|---|---|---|---|
| `inapp` | Redis Stream + Pub/Sub + SSE | aktif penuh | tidak perlu | ya (termasuk read receipt) |
| `email` | SMTP | **log-only** (`providerMessageId=dev-log-only`) | `Subscriber.email` atau `recipient.email` inline | ya |
| `whatsapp` | Meta Cloud API (teks) | **log-only**, bisa diuji dengan stub lokal | nomor telepon (E.164) | ya |
| `sms` | — | tidak ada provider | — | baris ditandai `skipped` (`provider_not_available`) |

Fallback: jika template punya `fallbackChannel` dan channel utama di-skip karena preferensi,
job dikirim ulang ke channel fallback (satu kali, tanpa fallback berantai).

## Preferensi dan quiet hours

- `enabled=false` → channel di-`skip` dengan `lastError=preference_disabled` (atau pindah ke
  `fallbackChannel` bila ada).
- Quiet hours (mis. `22:00–07:00`) → job ditunda sampai jendela berakhir; maksimum **3 kali**
  penundaan, setelah itu tetap dikirim.
- Prioritas `critical` **melewati** quiet hours.
- Timezone evaluasi: `preference.timezone` → `Subscriber.timezone` → `Asia/Jakarta`.
- Baris preferensi yang tidak ada berarti "aktif, tanpa quiet hours".

## Quickstart 5 menit

Prasyarat: backend berjalan dan seed sudah dijalankan (lihat
[docs/getting-started/local-setup.md](../getting-started/local-setup.md)).

```bash
# 1. Kirim notifikasi in-app ke recipient yang ada di seed
curl -i -X POST http://localhost:3000/api/v1/notify \
  -H 'X-API-Key: dev-api-key-change-in-prod' \
  -H 'Content-Type: application/json' \
  -d '{
    "idempotency_key": "quickstart-1",
    "template_key": "test.notification",
    "recipients": ["user-test-1"],
    "channels": ["inapp"],
    "data": { "nama": "Budi" }
  }'
```

Expected: `202` dengan `{"notification_id":"<uuid>","status":"accepted"}`.

```bash
# 2. Buat token subscriber (ditandatangani dengan secret tenant)
TOKEN=$(npm run --silent dev:subscriber-token -- user-test-1)

# 3. Baca notifikasi yang sudah dikirim (catch-up)
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:3000/api/v1/in-app/notifications?limit=20'

# 4. Lihat preferensi end-user
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/subscriber/preferences
```

```bash
# 5. Login admin (untuk console / Admin API)
curl -s -X POST http://localhost:3000/api/v1/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@notifhub.local","password":"<password dari ADMIN_PASSWORD_HASH>"}'
```

Langkah berikutnya:

- Kirim ke banyak penerima, topik, atau dengan override inline → [integration.md](integration.md)
- Tampilkan in-app + SSE + preference center di aplikasi Anda → [end-user.md](end-user.md)
- Kelola template, API key, dan pantau pengiriman → [admin-and-operations.md](admin-and-operations.md)

## Glosarium singkat

| Istilah | Arti |
|---|---|
| **Consumer** | Sistem Anda yang memanggil NotifHub dengan API key |
| **Ingest** | Proses menerima dan menyimpan permintaan kirim (`POST /notify`) |
| **Fan-out** | Pembuatan satu baris recipient per penerima × channel |
| **Idempotency key** | Kunci unik per permintaan agar retry tidak menggandakan notifikasi |
| **Inline override** | Data penerima yang dikirim di body dan hanya berlaku untuk request itu |
| **Quiet hours** | Jendela waktu lokal saat notifikasi non-kritis ditunda |
| **Read receipt** | Penanda bahwa notifikasi in-app sudah dibaca |
