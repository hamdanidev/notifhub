# Integrasi consumer (backend)

Panduan untuk sistem Anda yang mengirim notifikasi lewat NotifHub memakai **API key**.

**Isi dokumen**

- [Ringkasan endpoint](#ringkasan-endpoint)
- [1. Mengirim notifikasi](#1-mengirim-notifikasi)
- [2. Push-sync subscriber](#2-push-sync-subscriber)
- [3. Topik dan keanggotaan](#3-topik-dan-keanggotaan)
- [4. Webhook provider](#4-webhook-provider)
- [5. Error, limit, dan praktik aman](#5-error-limit-dan-praktik-aman)
- [6. Go SDK](#6-go-sdk)

---

## Ringkasan endpoint

| Method & path | Fungsi |
|---|---|
| `POST /api/v1/notify` | Kirim notifikasi (penerima langsung dan/atau topik) |
| `PUT /api/v1/subscribers/{externalId}` | Push-sync snapshot subscriber (upsert) |
| `GET /api/v1/subscribers/{externalId}` | Baca snapshot yang tersimpan |
| `PUT /api/v1/topics/{key}/members` | Ganti seluruh keanggotaan topik |
| `POST /api/v1/topics/{key}/members` | Tambah/perbarui sebagian anggota |
| `GET /api/v1/topics/{key}/members` | Daftar anggota (`?includeExpired=true` opsional) |
| `POST /api/v1/webhooks/{provider}` | Endpoint callback dari provider (bukan dipanggil consumer) |

Semua memakai header `X-API-Key: <raw key>`. Raw key hanya ditampilkan sekali saat dibuat lewat
Admin API atau console.

## 1. Mengirim notifikasi

```bash
curl -i -X POST http://localhost:3000/api/v1/notify \
  -H 'X-API-Key: dev-api-key-change-in-prod' \
  -H 'Content-Type: application/json' \
  -d '{
    "idempotency_key": "order-1234-confirmed",
    "template_key": "test.notification",
    "recipients": [
      "user-1",
      { "id": "user-2", "email": "user2@example.com", "locale": "id" }
    ],
    "channels": ["inapp", "email"],
    "priority": "high",
    "data": { "nama": "Budi", "order_id": "1234" }
  }'
```

Response `202`:

```json
{ "notification_id": "0b0d8f6e-...", "status": "accepted" }
```

### Field body

| Field | Wajib | Aturan |
|---|---|---|
| `idempotency_key` | ya | Maks 128 karakter, hanya huruf/angka/`.`/`_`/`:`/`-` |
| `template_key` | ya | Maks 128 karakter; harus ada template aktif untuk channel & locale yang dipakai |
| `data` | ya | Objek apa pun; diteruskan ke renderer template |
| `recipients` | salah satu dari `recipients`/`topics` | Maks 1.000; string atau objek inline |
| `topics` | salah satu dari `recipients`/`topics` | Maks 50; topik harus sudah ada (kalau tidak → `400`) |
| `channels` | tidak | Default `["inapp"]`; nilai: `inapp`, `email`, `whatsapp`, `sms` |
| `priority` | tidak | `low`, `normal` (default), `high`, `critical` |
| `scheduled_at` | tidak | Diterima & disimpan, tetapi **tidak** menjadwalkan pengiriman |
| `tenant_id` | tidak | Deprecated; kalau diisi harus sama dengan tenant API key |

Recipient inline hanya berlaku untuk request itu dan **menimpa** data `Subscriber` yang tersimpan
(`email`, `phone`, `locale`, `timezone`). Untuk data yang bertahan, gunakan push-sync subscriber.

### Recipients + topics = union

Keduanya digabung dan di-dedupe berdasarkan `id`. Ini berguna untuk "semua anggota topik plus
beberapa orang tambahan":

```json
{
  "idempotency_key": "shift-broadcast-2026-11-16",
  "template_key": "shift.reminder",
  "recipients": [{ "id": "supervisor-1", "phone": "+628111222333" }],
  "topics": ["shift:gudang"],
  "channels": ["inapp", "whatsapp"],
  "data": { "shift": "pagi" }
}
```

### Idempotency

Kirim ulang dengan `idempotency_key` yang sama dalam `IDEMPOTENCY_TTL_DAYS` (default 7 hari) akan
mengembalikan `notification_id` yang sama **tanpa** membuat baris baru. Karena itu aman melakukan
retry pada error jaringan/5xx selama key-nya sama.

Gunakan key yang deterministik dan bermakna, mis. `order-<id>-confirmed`, bukan UUID acak per
percobaan.

### Prioritas

`low` → 4, `normal` → 3, `high` → 2, `critical` → 1 (semakin kecil semakin didahulukan). Hanya
`critical` yang melewati quiet hours.

## 2. Push-sync subscriber

NotifHub tidak pernah menarik data dari sistem Anda; data subscriber harus di-push.

```bash
curl -i -X PUT http://localhost:3000/api/v1/subscribers/user-1 \
  -H 'X-API-Key: dev-api-key-change-in-prod' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "user1@example.com",
    "phone": "+628123456789",
    "locale": "id",
    "timezone": "Asia/Jakarta",
    "metadata": { "plan": "pro" }
  }'
```

- **Full replacement**: field yang tidak dikirim akan dikosongkan. `timezone` jatuh ke
  `Asia/Jakarta` bila tidak dikirim.
- Upsert idempoten berdasarkan `(tenantId, externalId)`.
- `GET /api/v1/subscribers/{externalId}` mengembalikan snapshot yang tersimpan, atau `404` bila
  belum ada.
- Locale subscriber dipakai sebagai default resolusi template (fallback `DEFAULT_LOCALE`, default
  `id`).

## 3. Topik dan keanggotaan

Topik dibuat otomatis pada push pertama; tidak ada endpoint "create topic" terpisah.

```bash
# Ganti seluruh anggota (anggota lama yang tidak ada di body dihapus)
curl -i -X PUT 'http://localhost:3000/api/v1/topics/shift:gudang/members' \
  -H 'X-API-Key: dev-api-key-change-in-prod' \
  -H 'Content-Type: application/json' \
  -d '{"members":[{"recipientId":"user-1"},{"recipientId":"user-2"}]}'

# Tambah/perbarui sebagian anggota (anggota lain dipertahankan)
curl -i -X POST 'http://localhost:3000/api/v1/topics/shift:gudang/members' \
  -H 'X-API-Key: dev-api-key-change-in-prod' \
  -H 'Content-Type: application/json' \
  -d '{"members":[{"recipientId":"user-3"}]}'

# Daftar anggota (default tanpa yang sudah kedaluwarsa)
curl -s 'http://localhost:3000/api/v1/topics/shift:gudang/members?includeExpired=true' \
  -H 'X-API-Key: dev-api-key-change-in-prod'
```

| Field | Arti |
|---|---|
| `members[].recipientId` | Wajib, maks 128 karakter |
| `members[].expiresAt` | Expiry per anggota (ISO 8601) |
| `expiresAt` | Expiry default untuk anggota yang tidak punya expiry sendiri |
| `isTimeBound` | Hanya dihormati saat topik **dibuat**; topik time-bound mewajibkan expiry di setiap operasi |

Untuk topik time-bound, anggota yang `expiresAt`-nya lewat otomatis tidak dipakai saat fan-out
`POST /notify`, dan tidak muncul di daftar anggota kecuali `includeExpired=true`.

Response mutasi berisi `{ topic, memberCount, removed }` (PUT) atau
`{ topic, memberCount, added, updated }` (POST).

## 4. Webhook provider

Endpoint ini dipanggil **oleh provider** (SMTP gateway/WhatsApp), bukan oleh consumer. NotifHub
memakainya untuk memperbarui status pengiriman.

- Path: `POST /api/v1/webhooks/{provider}` dengan `provider` ∈ `smtp`, `whatsapp`, `sms`.
- Header wajib: `X-NotifHub-Signature: t=<unix seconds>,v1=<hex hmac sha256>`.
- Payload yang ditandatangani: `<t>.<raw body>` dengan `WEBHOOK_SIGNING_SECRET`; toleransi
  timestamp 5 menit.
- `eventType` ∈ `delivered`, `failed`, `bounced`, `read`, `opened`.

Contoh membuat signature (Node.js) untuk pengujian lokal:

```js
import { createHmac } from 'node:crypto';

const body = JSON.stringify({
  eventId: 'evt_1',
  eventType: 'delivered',
  notificationId: '<uuid>',
  recipientId: 'user-1',
  channel: 'email',
});

const t = Math.floor(Date.now() / 1000);
const v1 = createHmac('sha256', process.env.WEBHOOK_SIGNING_SECRET)
  .update(`${t}.${body}`)
  .digest('hex');

// header: X-NotifHub-Signature: t=<t>,v1=<v1>
```

Perilaku:

- `202 {"status":"accepted"}` untuk event valid (termasuk bila notification/recipient tidak
  ditemukan — event tetap dicatat di `delivery_events` lalu diabaikan).
- `401` bila signature hilang/format salah/kedaluwarsa/tidak cocok.
- `404` bila provider tidak dikenal.
- `400` bila `channel` di body tidak sesuai dengan provider (mis. `channel: "whatsapp"` ke
  `/webhooks/smtp`).
- Transisi status monotonik: `delivered`/`read` tidak bisa diturunkan oleh event `failed` yang
  datang terlambat.

## 5. Error, limit, dan praktik aman

| Kasus | Respons | Tindakan |
|---|---|---|
| API key hilang/salah | `401` | Periksa header `X-API-Key` |
| Field tidak valid / `topics` kosong / topik tidak dikenal | `400` | Perbaiki body; pastikan topik sudah dibuat |
| Body > 64 KB | `413` | Kecilkan payload; kirim data besar lewat referensi |
| Rate limit | `429` | Hormati `Retry-After`; retry dengan backoff |
| Redis/queue down | `503` | Retry dengan `idempotency_key` yang sama |

Praktik yang disarankan:

1. Selalu isi `idempotency_key` yang deterministik.
2. Simpan `notification_id` yang dikembalikan agar bisa dicocokkan dengan webhook/detail admin.
3. Jangan mengandalkan `scheduled_at` (belum ada penjadwalan).
4. Gunakan `topics` untuk kohort dinamis; gunakan `recipients` untuk penerima spesifik.
5. Jangan mengirim API key ke browser/aplikasi end-user — browser memakai lane subscriber
   ([end-user.md](end-user.md)).
6. Untuk kontrak lengkap (field opsional, enum, contoh), buka `/api/docs` atau `/api/docs-json`.

## 6. Go SDK

SDK Go membungkus endpoint consumer di atas (`notify`, subscriber, topik membership). Status
distribusi: module path `github.com/hamdanidev/notifhub-go`, dipublikasikan dari repo mirror
`notifhub-go`; sampai tag rilis pertama dibuat, gunakan `replace` ke folder `sdk/go` repo ini.

```go
client, err := notifhub.New(baseURL, apiKey, notifhub.WithRetry(notifhub.DefaultRetryPolicy()))
result, err := client.Notify(ctx, notifhub.NotifyRequest{
    IdempotencyKey: "order-123-confirmed",
    TemplateKey:    "order.confirmed",
    Recipients:     []notifhub.Recipient{{ID: "user-1"}},
    Channels:       []string{"inapp", "email"},
    Data:           map[string]any{"order_id": "123"},
})
```

Detail lengkap (opsi, error, retry, regenerasi client) ada di
[`sdk/go/README.md`](../../sdk/go/README.md).
