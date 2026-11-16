# Integrasi end-user (in-app & preference center)

Panduan untuk aplikasi tempat end-user berinteraksi: inbox in-app, stream real-time, dan
preferensi notifikasi. Lane ini memakai **subscriber JWT**, bukan API key.

> API key **tidak boleh** dipakai di browser. Aplikasi Anda (backend consumer) yang memegang API
> key; browser hanya menerima subscriber JWT berumur pendek.

## 1. Token subscriber

Token dibuat oleh backend Anda, bukan oleh NotifHub. Syaratnya:

| Aspek | Nilai |
|---|---|
| Algoritma | HS256 |
| Klaim wajib | `sub` (recipientId), `tenant`, `exp` |
| Secret | `subscriberJwtSecret` milik API key tenant; fallback `SUBSCRIBER_JWT_SECRET` hanya bila tenant belum punya secret |
| Pengiriman | Header `Authorization: Bearer <token>` — **tidak pernah** query string |

Contoh membuat token saat login end-user (Node.js):

```js
import jwt from 'jsonwebtoken';

const token = jwt.sign(
  { sub: 'user-test-1', tenant: 'default' },
  process.env.SUBSCRIBER_JWT_SECRET, // atau secret API key tenant
  { algorithm: 'HS256', expiresIn: '1h' },
);
```

Di lokal, token bisa dibuat dengan helper repo:

```bash
npm run dev:subscriber-token -- user-test-1
```

Token yang ditandatangani dengan secret global **ditolak** untuk tenant yang punya secret sendiri
(tidak ada downgrade). Token yang tenant-nya tidak cocok dengan klaim juga ditolak.

## 2. In-app: catch-up dan read receipt

| Method & path | Fungsi |
|---|---|
| `GET /api/v1/in-app/notifications` | Daftar notifikasi in-app milik token (terbaru dulu) |
| `POST /api/v1/in-app/notifications/{notificationId}/read` | Tandai sudah dibaca (idempoten) |
| `GET /api/v1/in-app/stream` | Stream SSE |

Query list: `limit` (1–100, default 20) dan `cursor` (nilai `nextCursor` dari halaman sebelumnya).

```bash
TOKEN=$(npm run --silent dev:subscriber-token -- user-test-1)

curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:3000/api/v1/in-app/notifications?limit=20'
```

```json
{
  "items": [
    {
      "notificationId": "0b0d8f6e-...",
      "templateKey": "test.notification",
      "subject": null,
      "body": "Halo Budi, ini notifikasi tes.",
      "data": { "nama": "Budi" },
      "priority": 3,
      "status": "sent",
      "createdAt": "2026-11-16T09:00:00.000Z",
      "readAt": null
    }
  ],
  "nextCursor": null
}
```

- `body` bernilai `null` bila template sudah tidak ada (notifikasi lama tetap ditampilkan).
- `POST .../read` mengembalikan `{ "notificationId": "...", "readAt": "..." }`; memanggil dua kali
  aman (waktu baca pertama yang dipertahankan).
- `404` bila notifikasi bukan milik subscriber tersebut.

## 3. SSE real-time

```bash
curl -N -H "Authorization: Bearer $TOKEN" \
  -H 'Accept: text/event-stream' \
  http://localhost:3000/api/v1/in-app/stream
```

Format event:

```
id: 1731747600000-0
event: notification
data: {"notificationId":"0b0d8f6e-...","templateKey":"test.notification","subject":null,"body":"Halo Budi","data":{"nama":"Budi"},"priority":3,"createdAt":"2026-11-16T09:00:00.000Z"}
```

- Nama event selalu `notification`; `id` adalah ID stream yang bisa dipakai sebagai `Last-Event-ID`.
- Untuk melanjutkan setelah putus, kirim header `Last-Event-ID: <id terakhir>`; server memutar
  ulang event yang terlewat hingga `SSE_REPLAY_BUFFER_SECONDS` (default 300 detik).
- Heartbeat dikirim sebagai komentar setiap 15–30 detik agar proxy tidak menutup koneksi.
- Gunakan `fetch` + streaming (bukan `EventSource`) karena `EventSource` tidak bisa mengirim header
  `Authorization`. SDK JS sudah menangani ini, termasuk reconnect dengan backoff dan dedupe.

## 4. Preference center

| Method & path | Fungsi |
|---|---|
| `GET /api/v1/subscriber/preferences` | Snapshot 3 channel + konteks profil |
| `PUT /api/v1/subscriber/preferences/{channel}` | Ganti preferensi satu channel (full snapshot) |

`channel` ∈ `inapp`, `email`, `whatsapp`. Nilai `sms` ditolak `400` (belum ada provider).

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/subscriber/preferences
```

```json
{
  "recipientId": "user-test-1",
  "locale": "id",
  "timezone": "Asia/Jakarta",
  "channels": [
    {
      "channel": "inapp",
      "enabled": true,
      "quietHoursStart": null,
      "quietHoursEnd": null,
      "timezone": "Asia/Jakarta",
      "isDefault": true,
      "updatedAt": null
    },
    { "channel": "email", "enabled": true, "quietHoursStart": null, "quietHoursEnd": null, "timezone": "Asia/Jakarta", "isDefault": true, "updatedAt": null },
    { "channel": "whatsapp", "enabled": true, "quietHoursStart": null, "quietHoursEnd": null, "timezone": "Asia/Jakarta", "isDefault": true, "updatedAt": null }
  ]
}
```

- Tiga channel **selalu** dikembalikan. `isDefault: true` berarti belum ada baris tersimpan dan
  nilai yang tampil adalah default efektif.
- `locale` bisa `null` bila profil subscriber belum pernah di-push.

```bash
# Matikan email
curl -i -X PUT -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":false}' \
  http://localhost:3000/api/v1/subscriber/preferences/email

# Aktifkan in-app dengan quiet hours 22:00-07:00
curl -i -X PUT -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":true,"quietHoursStart":"22:00","quietHoursEnd":"07:00"}' \
  http://localhost:3000/api/v1/subscriber/preferences/inapp
```

Aturan:

- `enabled` wajib di setiap PUT.
- `quietHoursStart` dan `quietHoursEnd` harus dikirim **bersama**; `HH:mm` 24 jam. Jika dihilangkan,
  quiet hours dihapus (PUT bersifat full snapshot).
- `timezone` opsional (IANA). Bila dihilangkan, mewarisi `Subscriber.timezone`, fallback
  `Asia/Jakarta`.
- `start === end` dianggap quiet hours mati.

## 5. SDK JavaScript (`@notifhub/js`)

```bash
npm install @notifhub/js
```

```ts
import { NotifHubClient, isNotifHubError } from '@notifhub/js';

const client = new NotifHubClient({
  baseUrl: 'https://notifhub.example.com',
  getToken: () => session.accessToken, // dipanggil per request & per reconnect SSE
});

const subscription = client.subscribe({
  onNotification: (notification) => console.log(notification.body),
  onError: (error) => {
    if (isNotifHubError(error) && error.code === 'unauthorized') {
      // token kedaluwarsa: refresh lalu subscribe lagi
    }
  },
});
```

| Method | Fungsi |
|---|---|
| `getNotifications({ limit?, cursor?, signal? })` | Catch-up page |
| `markRead(notificationId)` | Read receipt |
| `subscribe(handlers, { lastEventId?, signal? })` | SSE + reconnect otomatis |
| `getPreferences()` | Snapshot preference center |
| `updatePreference(channel, input)` | Ubah satu channel |
| `close()` | Tutup semua koneksi |

Perilaku bawaan: retry `5xx`/`429`/network, tidak retry `4xx`, error bertipe (`NotifHubError.code`),
dukungan `AbortSignal`, dan dedupe event SSE.

## 6. React (`@notifhub/react`)

```bash
npm install @notifhub/react @notifhub/js react react-dom
```

```tsx
import { NotifHubClient } from '@notifhub/js';
import { NotifHubProvider, NotificationBell, NotificationInbox, useNotifHub } from '@notifhub/react';

const client = new NotifHubClient({ baseUrl, getToken: () => session.accessToken });

export function App() {
  return (
    <NotifHubProvider client={client} limit={50}>
      <NotificationBell />
      <NotificationInbox limit={20} />
      <Unread />
    </NotifHubProvider>
  );
}

function Unread() {
  const { unreadCount } = useNotifHub();
  return <span>{unreadCount} belum dibaca</span>;
}
```

Komponen tidak membawa style (headless): beri CSS/`className` sendiri. Untuk preference center:

```tsx
import { usePreferences } from '@notifhub/react';

function Preferences({ client }) {
  const { preferences, status, error, update, reload } = usePreferences(client);

  if (status === 'loading') return <p>Memuat…</p>;
  if (error) return <button onClick={() => void reload()}>Coba lagi</button>;

  return preferences?.channels.map((channel) => (
    <label key={channel.channel}>
      <input
        type="checkbox"
        checked={channel.enabled}
        onChange={(event) => void update(channel.channel, { enabled: event.target.checked })}
      />
      {channel.channel}
      {channel.isDefault ? ' (default)' : ''}
    </label>
  ));
}
```

`usePreferences(client)` mengembalikan `{ preferences, status, error, reload, update }` dan tidak
memerlukan `NotifHubProvider` (tidak membuka SSE).

### 6.1 Sample lengkap

Contoh React 18 + Vite yang bisa dijalankan ada di
[`sample/in-app-web`](../../sample/in-app-web/README.md). Sample mendemonstrasikan sesi subscriber,
bell, inbox, status SSE, `markRead`, dan preference center dengan quiet hours. Token diterbitkan
middleware Vite dev di server; API key tidak pernah masuk browser.

Sample bersifat **lokal saja**: middleware `/dev/*` tidak ikut build produksi dan bukan pola
deployment. Lihat README sample untuk prasyarat, skenario uji, dan troubleshooting.

## 7. Keamanan dan batasan

- Token hanya di header `Authorization`; jangan pernah di query string, localStorage jangka
  panjang, atau log.
- Token tidak bisa dicabut per user; masa berlaku ditentukan `exp` (buat pendek, mis. 1 jam).
- Endpoint in-app dan preference dibatasi **60 request/menit per IP**.
- Preference bersifat tenant-scoped: dua tenant dengan `recipientId` sama tidak saling
  memengaruhi.
- `enabled=false` untuk `inapp` membuat notifikasi in-app baru tidak dikirim; jelaskan konsekuensi
  ini di UI preferensi.
- Belum ada endpoint unread-count terpisah; hitung dari daftar notifikasi (SDK/React sudah
  menyediakannya).
