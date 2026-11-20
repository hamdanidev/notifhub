# Analisis kebutuhan console admin NotifHub

Status: **Fase A + Fase B terimplementasi dan terverifikasi** pada 2026-11-16; Fase C sebagian
(template preview/test send dan search notification sudah ada), sisa re-send all, compose/send,
export. P1 hardening console selesai 2026-11-20. Audit ulang 2026-11-20 ada di §11.1.
Tanggal: 2026-11-16. Bahasa: Indonesia.

Dokumen ini menjawab dua keluhan konkret pada console saat ini — tidak ada **re-send** dan tidak ada
**refresh data** — lalu memetakan kebutuhan console lain yang relevan. Fokusnya bukan menambah
sebanyak mungkin fitur, melainkan menutup celah operasional yang membuat console sulit dipakai
untuk menindaklanjuti pengiriman yang gagal.

**Isi dokumen**

- [1. Ringkasan eksekutif](#1-ringkasan-eksekutif)
- [2. Kondisi console saat ini](#2-kondisi-console-saat-ini)
- [3. Peta gap dan prioritas](#3-peta-gap-dan-prioritas)
- [4. Kebutuhan refresh](#4-kebutuhan-refresh)
- [5. Kebutuhan re-send](#5-kebutuhan-re-send)
- [6. Kebutuhan lain yang layak menyusul](#6-kebutuhan-lain-yang-layak-menyusul)
- [7. Usulan fase](#7-usulan-fase)
- [8. Keputusan yang perlu disetujui](#8-keputusan-yang-perlu-disetujui)
- [9. Risiko dan batasan](#9-risiko-dan-batasan)
- [10. Pertanyaan keputusan](#10-pertanyaan-keputusan)
- [11. Status implementasi (2026-11-16)](#11-status-implementasi-2026-11-16)

---

## 1. Ringkasan eksekutif

1. **Refresh adalah gap frontend murni.** Semua endpoint Admin API sudah ada. Console memakai
   TanStack Query dengan `staleTime: 30s` dan `refetchOnWindowFocus: false`, tanpa tombol refresh
   dan tanpa polling. Data `pending/partial` bisa berubah di backend tetapi tetap terlihat lama di
   layar sampai halaman di-reload.
2. **Re-send tidak bisa diselesaikan di frontend saja.** Admin API hanya punya `GET` untuk
   notifikasi; tidak ada endpoint kirim ulang. Lane admin tidak boleh memakai `X-API-Key`, dan API
   key tidak boleh ditaruh di browser. Jadi re-send membutuhkan endpoint admin baru di backend.
3. **Re-send yang benar bukan mengulang job lama.** Job BullMQ tidak disimpan sebagai referensi di
   database, dan satu notifikasi bisa gagal pada kombinasi `(recipient, channel)` yang berbeda.
   Re-send harus membuat notification baru dengan pasangan recipient/channel yang dipilih, bukan
   memutar ulang seluruh fan-out.
4. **Detail notifikasi belum cukup untuk troubleshooting.** Backend mengembalikan
   `targetSnapshot`, tetapi UI belum menampilkannya. Backend juga belum mengembalikan payload
   `data`; UI hanya menampilkan `errorName`, bukan `errorMessage`, dan belum menampilkan payload
   event.
5. **Urutan yang disarankan:** refresh + perbaikan detail lebih dulu (dampak cepat, sebagian besar
   frontend), lalu re-send failed-only sebagai fitur backend pertama. Re-send-all, pencarian
   notifikasi, dan compose/send dari console adalah fase berikutnya.

---

## 2. Kondisi console saat ini

### 2.1 Halaman dan kemampuan

| Halaman | Kemampuan sekarang |
|---|---|
| Dashboard | 4 query count status + 100 notifikasi terbaru untuk grafik 14 hari; tanpa refresh |
| Notifications | Filter status/template/tanggal, pagination, detail; tanpa search ID/recipient, tanpa refresh |
| Notification detail | Recipients, 20 attempt, 20 event; `targetSnapshot` tidak ditampilkan, payload tidak tersedia |
| Templates | List/create/edit/nonaktifkan; belum ada preview atau test send |
| Subscribers | List/detail + editor preferensi; data read-only dari push consumer (sesuai desain) |
| Topics | List/detail, replace/add membership; expiry per member belum diedit satu per satu |
| API keys | List/create/revoke; `subscriberJwtSecret` belum dapat diatur dari UI |
| Global | Login, route guard, 401 → logout; belum ada refresh global atau toast sukses |

### 2.2 Perilaku data fetching

`console/src/lib/queryClient.ts`:

```ts
staleTime: 30_000,
retry: 1,
refetchOnWindowFocus: false,
```

Tidak ada `refetchInterval`, tidak ada tombol `refetch` di header, dan `QueryState` hanya
menampilkan tombol **Coba lagi** ketika query error. Saat query sukses tetapi datanya berubah di
backend, UI tidak memberi tahu dan tidak memperbarui dirinya.

Konsekuensi praktis:

- Notifikasi yang baru saja `pending` tetap terlihat `pending` setelah worker selesai.
- Dashboard tidak berubah setelah ada pengiriman baru.
- Detail notifikasi tidak memperlihatkan attempt/event baru sampai reload.
- Pengguna tidak punya sinyal “data ini diperbarui kapan”.

### 2.3 Detail notifikasi

`GET /api/v1/admin/notifications/:id` mengembalikan:

- `notification` (tanpa `payload`),
- `recipients`,
- `deliveryAttempts`,
- `deliveryEvents`.

UI saat ini hanya menampilkan sebagian:

- `targetSnapshot` tidak dirender.
- `payload.data` tidak tersedia dari API.
- Attempt hanya menampilkan `errorName`, bukan `errorMessage`.
- Event tidak menampilkan `rawPayload`.
- Tidak ada filter recipient per status/channel atau pencarian recipient.

### 2.4 Ketiadaan operasi tulis pada notifikasi

`AdminNotificationsController` hanya memiliki:

```text
GET /api/v1/admin/notifications
GET /api/v1/admin/notifications/:id
```

Tidak ada endpoint re-send, retry, cancel, atau create/send dari console. Tidak ada route console
untuk mengirim notifikasi baru.

---

## 3. Peta gap dan prioritas

| ID | Gap | Dampak | Butuh backend? | Prioritas |
|---|---|---|---|---|
| C1 | Tidak ada tombol **Muat ulang** dan waktu update terakhir | Data terlihat basi; sulit memastikan status terkini | Tidak | P0 |
| C2 | Tidak ada auto-refresh untuk notifikasi in-flight | `pending/partial` tidak berubah sampai reload | Tidak | P0 |
| C3 | Detail tidak menampilkan target snapshot dan payload | Tidak bisa memastikan siapa/channel/data yang dikirim | Sebagian (payload) | P0/P1 |
| C4 | Error attempt/event tidak lengkap | Diagnosis kegagalan provider terbatas | Tidak (data sudah ada) | P1 |
| C5 | Tidak ada re-send failed | Kegagalan harus ditangani lewat curl/API manual | Ya | P1 |
| C6 | Tidak ada re-send all | Tidak bisa mengirim ulang pengingat ke semua penerima | Ya | P2 |
| C7 | Tidak ada search notification ID/recipient | Investigasi lambat pada data besar | Ya | P2 |
| C8 | Tidak ada compose/send dari console | Admin tetap bergantung pada consumer/curl | Ya | P2 |
| C9 | Template belum punya preview/test send | Kesalahan template baru terlihat setelah dikirim | Ya (test send) | P2 |
| C10 | Tidak ada export/audit view | Analisis dan pelaporan terbatas | Ya | P3 |
| C11 | Tidak ada feedback sukses global | Mutasi berhasil tanpa konfirmasi yang konsisten | Tidak | P1 |

Catatan: C10/C11 bukan alasan untuk menunda C1–C5.

---

## 4. Kebutuhan refresh

### 4.1 UX yang diusulkan

- Komponen `RefreshButton` reusable di `PageHeader.actions`.
- Label: **Muat ulang**; saat berjalan: spinner + “Memuat…”.
- Teks kecil `Diperbarui HH:mm:ss` atau “Baru saja / 2 menit lalu”.
- Tombol dinonaktifkan saat request sedang berjalan; tidak menghapus filter, halaman, atau isi form.
- Saat error, tombol tetap tersedia; `QueryState` tetap menampilkan **Coba lagi** untuk error awal.

Pasang di:

- Dashboard
- Notifications list
- Notification detail
- Templates
- Subscribers + subscriber detail
- Topics + topic detail
- API keys

### 4.2 Auto-refresh

Usulan default:

| Halaman | Interval | Kondisi |
|---|---|---|
| Notifications list | 5 detik | ada item `pending` atau `partial` |
| Notification detail | 5 detik | `overallStatus` `pending`/`partial` |
| Dashboard | 60 detik | halaman aktif |
| Halaman lain | tidak ada | manual refresh cukup |

Prinsip:

- Gunakan `refetchInterval` TanStack Query, bukan `setInterval` manual.
- Hentikan interval saat status terminal (`sent`/`failed`) atau saat tab tidak aktif.
- Set `refetchOnWindowFocus: true` agar kembali ke tab memuat data terbaru.
- Tampilkan indikator “Auto-refresh 5s” supaya pengguna tahu data bergerak sendiri.
- Jangan polling endpoint yang tidak perlu; filter/pagination tetap dipertahankan.

### 4.3 Perubahan teknis

Frontend saja:

- `console/src/components/RefreshButton.tsx`
- helper `formatRelative`/`formatUpdatedAt` yang sudah tersedia di `lib/format.ts`
- `PageHeader` menerima actions (sudah mendukung)
- setiap page memakai `query.isFetching`, `query.dataUpdatedAt`, `query.refetch`
- `queryClient` default `refetchOnWindowFocus: true`
- invalidasi query setelah mutasi (sudah ada untuk templates/topics/preferences/API keys;
  ditambah setelah re-send)

Backend: **tidak ada perubahan**.

### 4.4 Kriteria penerimaan

- Daftar notifikasi yang memiliki item `pending` berubah menjadi `sent` tanpa reload.
- Tombol Muat ulang mempertahankan filter, halaman, dan urutan.
- Waktu update terakhir berubah setelah refresh.
- Tidak ada request polling ketika semua item sudah terminal.
- `npm run console:typecheck && npm run console:build` lulus.

---

## 5. Kebutuhan re-send

### 5.1 Mengapa tidak bisa frontend-only

- `AdminNotificationsController` tidak punya endpoint re-send.
- Lane admin tidak menerima `X-API-Key`; lane ingest tidak menerima admin JWT.
- API key tidak boleh berada di browser console.
- `NotifHubAdminClient` yang terbit di npm hanya memiliki `listNotifications` dan
  `getNotification`.

Kesimpulan: re-send memerlukan endpoint admin baru di backend, lalu UI console memanggilnya
melalui jalur admin.

### 5.2 Pilihan semantik

| Opsi | Kelebihan | Kekurangan | Keputusan |
|---|---|---|---|
| Re-enqueue baris lama di notification yang sama | Tidak membuat ID baru | Mengubah histori, status read/delivered bisa turun, job lama tidak tersimpan, audit hilang | Ditolak |
| Membuat notification baru dari data asli | Histori asli tetap utuh, audit jelas, idempotency baru | Perlu endpoint + baris/job baru | **Dipilih** |
| Mengirim ulang seluruh notification tanpa filter | Sederhana | Duplikat ke penerima yang sudah sukses | Hanya mode eksplisit `all` |

### 5.3 Mode yang diusulkan

**Default: failed-only.**

- Hanya baris `NotificationRecipient.status = failed`.
- Pertahankan pasangan `(recipientId, channel)` yang gagal; jangan mengirim channel yang sudah
  sukses untuk recipient yang sama.
- Baris `skipped` tidak otomatis di-retry (alasan seperti `preference_disabled` atau
  `provider_not_available` tidak akan berubah tanpa tindakan lain).
- Jika tidak ada baris `failed` → `409` dan UI menonaktifkan tombol.

**Sekunder: all.**

- Semua baris non-`sms` dari notification asli.
- Konfirmasi eksplisit: “Kirim ulang ke semua N penerima, termasuk yang sudah menerima.”
- Tetap membuat notification baru; bukan mutasi notification lama.
- `sms` tidak diikutkan karena belum ada provider.

### 5.4 Yang tidak persis sama dengan pengiriman awal

Re-send bukan time travel. Hal-hal berikut perlu ditulis di UI konfirmasi:

1. **Template dirender ulang** dari versi aktif saat re-send, bukan body yang sudah tersimpan.
2. **Preferensi dievaluasi ulang**; recipient yang sekarang mematikan channel bisa menjadi
   `skipped`.
3. **Inline override recipient** (`email`, `phone`, `locale`, `timezone` yang dulu dikirim di
   body ingest) tidak tersimpan di `Notification`/`NotificationRecipient`; re-send memakai data
   Subscriber saat ini. Ini batasan data model yang sudah ada.
4. **Billing**: re-send bukan transaksi consumer baru. Default aman adalah **tidak membuat
   BillingEvent baru**; jika billing ingin menghitung percobaan, tambahkan event type terpisah.
5. **Idempotency**: notification baru memakai key baru; double-click harus dicegah dan request
   sebaiknya membawa `requestKey` unik dari console.

### 5.5 API yang diusulkan

```http
POST /api/v1/admin/notifications/:id/resend
Authorization: Bearer <admin JWT>
Content-Type: application/json

{
  "mode": "failed",          // "failed" | "all"
  "requestKey": "<uuid>"     // idempotency untuk aksi ini
}
```

Response `202`:

```json
{
  "notification_id": "<new-uuid>",
  "status": "accepted",
  "mode": "failed",
  "recipient_count": 3,
  "channels": ["email", "whatsapp"]
}
```

Error:

| Status | Kondisi |
|---|---|
| `404` | notification tidak ada / milik tenant lain / soft-deleted |
| `409` | mode `failed` tetapi tidak ada baris failed |
| `409` | notification tidak punya recipient yang bisa dikirim |
| `503` | queue tidak tersedia |
| `429` | throttle re-send (opsional, disarankan) |

Aturan:

- Tenant selalu dari admin JWT; `tenantId` tidak diterima dari body.
- Endpoint baru hanya di lane admin; tidak mengubah ingest.
- `requestKey` dipakai untuk mencegah duplikat; request dengan key yang sama mengembalikan
  notification baru yang sama.
- Response tidak memuat isi secret/token.

### 5.6 Model data dan audit

Pilihan audit:

| Opsi | Perubahan | Catatan |
|---|---|---|
| Simpan `resend_of` di `targetSnapshot` | Tanpa migrasi | Cepat, tetapi metadata operasional bercampur dengan snapshot targeting |
| Tambah `resendOfNotificationId` + `resendMode` | Migrasi Prisma | **Disarankan**; relasi dan audit jelas, dapat diindeks |

Rekomendasi: tambah kolom nullable:

```prisma
resendOfNotificationId String?
resendMode             String?   // "failed" | "all"
@@index([resendOfNotificationId])
```

Detail notification baru menampilkan “Resend dari `<id>`” dengan tautan ke notification asli.
Notification asli tetap immutable.

### 5.7 Alur backend

1. Ambil notification asli dengan filter `tenantId`; tolak soft-deleted.
2. Tentukan pasangan target:
   - `failed`: baris `status=failed` saja;
   - `all`: semua baris non-`sms`.
3. Ambil `templateKey`, `payload.data`, `priority` dari notification asli.
4. Buat notification baru + baris recipient baru dalam transaksi.
5. Dispatch satu job per pasangan `(recipient, channel)` ke queue yang sesuai.
6. Simpan `resendOfNotificationId`/`resendMode` dan response.
7. Jangan membuat `BillingEvent` baru untuk re-send (default; lihat §5.4).
8. Catat event log terstruktur: `admin.notification.resend` dengan tenant, original id, new id,
   mode, count, hasil.

Catatan implementasi: jangan sekadar memanggil `IngestService.enqueue` dengan `recipients` dan
`channels` hasil gabungan. Cara itu bisa mengirim channel yang sudah sukses untuk recipient yang
sama. Perlu jalur dispatch yang menerima **pasangan recipient×channel eksplisit**; bisa berupa
service baru khusus re-send atau ekstraksi helper dispatch bersama dengan regresi ingest.

### 5.8 UI console

Di halaman detail notification:

- Tombol **Kirim ulang yang gagal (N)** aktif jika `N > 0`.
- Tombol **Kirim ulang semua (M)** sekunder, dengan dialog konfirmasi.
- Dialog menampilkan:
  - jumlah recipient dan channel,
  - peringatan template/preferensi/override,
  - mode yang dipilih.
- Saat proses: spinner, tombol disabled.
- Sukses: banner dengan link ke notification baru.
- Gagal: error `NotifHubError` yang bisa ditindaklanjuti; `requestKey` baru hanya saat pengguna
  mencoba lagi secara sengaja.
- Setelah sukses: invalidate `['notifications']`, `['notification', originalId]`, `['dashboard']`.

### 5.9 Strategi SDK dan batasan versi

Console memakai `@notifhub/js` dari workspace. Paket yang sudah terbit di npm tidak boleh diubah
versinya tanpa proses rilis. Ada dua pilihan:

| Opsi | Kelebihan | Kekurangan |
|---|---|---|
| Tambah method ke `NotifHubAdminClient` lalu rilis versi baru | Arsitektur konsisten | Perlu perubahan paket terbit + rilis npm |
| Console memakai `HttpTransport` yang diekspor SDK dengan wrapper lokal bertipe | Tidak mengubah versi paket terbit; tetap memakai transport SDK (token, error, retry) | Sedikit menyimpang dari “semua lewat AdminClient” sampai rilis SDK berikutnya |

**Default yang disarankan:** wrapper lokal di console memakai `HttpTransport` SDK, tanpa `fetch`
mentah. Saat SDK berikutnya dirilis, pindahkan method ke `NotifHubAdminClient` dan hapus wrapper.
Ini menjaga aturan versi paket terbit tetap utuh.

### 5.10 Kriteria penerimaan

- Re-send failed hanya mengirim pasangan recipient/channel yang gagal.
- Notification asli tidak berubah; notification baru muncul dengan relasi `resendOf`.
- Re-send all memerlukan konfirmasi dan tidak menyertakan `sms`.
- Request tenant lain → `404`; tanpa failed → `409`.
- Double request dengan `requestKey` yang sama tidak membuat dua notification.
- Test backend e2e baru lulus; `console:typecheck`/`build` lulus.
- Tidak ada API key di browser.

---

## 6. Kebutuhan lain yang layak menyusul

### 6.1 Detail notifikasi untuk troubleshooting

- Tampilkan `targetSnapshot` (topics, recipient_ids, channels) yang sudah tersedia.
- Tambahkan `payload` ke response detail Admin API dan tampilkan `data` sebagai JSON.
- Tampilkan `errorMessage` attempt, bukan hanya `errorName`.
- Event: tampilkan `rawPayload` dalam expandable row (aman karena React merender text).
- Filter recipient berdasarkan status/channel dan pencarian recipientId.
- Tombol copy notification ID.

Ini bisa menjadi bagian rilis yang sama dengan refresh, dengan satu perubahan response backend.

### 6.2 Search dan filter

- Search notification berdasarkan ID atau recipientId.
- Date preset: hari ini, 7 hari, 30 hari.
- Page size 20/50/100.
- Backend perlu query `search` tambahan; hati-hati performa `recipientId contains` pada data besar.
  Bisa dimulai dengan exact ID/UUID dan exact recipient.

### 6.3 Compose/send dan template test

- Halaman **Kirim notifikasi** dari console membutuhkan endpoint admin baru
  (`POST /api/v1/admin/notifications`) atau reuse ingest dengan lane yang tidak mencampur auth.
- Template preview dan test send juga membutuhkan endpoint/rendering yang sama.
- Ini lebih besar dari re-send dan sebaiknya tidak dicampur dalam MVP refresh/re-send.

### 6.4 Export dan audit

- Export CSV untuk notification/recipient (tenant-scoped).
- Audit log UI untuk aksi admin (belum ada tabel audit).
- Ini P3; jangan menahan perbaikan operasional P0/P1.

---

## 7. Usulan fase

### Fase A — Refresh dan observability (frontend + payload kecil)

- C1 manual refresh + last updated di semua halaman.
- C2 auto-refresh in-flight.
- C3 tampilkan `targetSnapshot`; tambahkan payload ke detail API.
- C4 errorMessage dan event payload.
- C11 feedback sukses yang konsisten.

Dampak cepat, risiko rendah, tidak mengubah lane/auth.

### Fase B — Re-send failed (backend + console)

- Endpoint admin re-send failed.
- Schema `resendOfNotificationId`/`resendMode`.
- Console action + konfirmasi + link hasil.
- Test e2e backend, typecheck/build console.
- Mode `all` ditunda sampai failed-only stabil.

### Fase C — Re-send all, search, compose

- Re-send all dengan konfirmasi.
- Search notification ID/recipient.
- Compose/send dan template test.
- Export/audit.

Fase A dan B adalah jawaban langsung untuk keluhan saat ini. Fase C membutuhkan keputusan produk
tambahan.

---

## 8. Keputusan yang perlu disetujui

| # | Keputusan | Default yang disarankan |
|---|---|---|
| D1 | Refresh per halaman + last updated; tanpa tombol global di topbar | Ya |
| D2 | Auto-refresh 5 detik untuk list/detail in-flight; dashboard 60 detik; stop saat terminal | Ya |
| D3 | Re-send membuat notification baru, bukan mengubah notification lama | Ya |
| D4 | Default mode `failed`; `all` hanya dengan konfirmasi eksplisit | Ya |
| D5 | Tambah `resendOfNotificationId` + `resendMode` (migrasi) | Ya |
| D6 | Re-send failed-only lebih dulu; `all` di fase berikutnya | Ya |
| D7 | Billing: tidak membuat BillingEvent baru untuk re-send | Ya |
| D8 | `requestKey` unik per aksi untuk mencegah duplikat | Ya |
| D9 | Detail API mengembalikan `payload`; UI menampilkan target/attempt/event lebih lengkap | Ya |
| D10 | Gunakan wrapper `HttpTransport` lokal dulu; jangan mengubah versi paket npm terbit | Ya |
| D11 | Tanpa browser automation; verifikasi backend e2e + console build + HTTP/DB | Ya |
| D12 | Search notification, compose/send, export ditunda ke fase berikutnya | Ya |

---

## 9. Risiko dan batasan

- **Re-send tidak identik** dengan pengiriman awal: template, preferensi, dan data Subscriber dapat
  berubah; inline override lama tidak tersimpan.
- **Duplikat**: mode `all` dapat mengirim ulang ke penerima yang sudah sukses; harus dikonfirmasi.
- **Billing**: tanpa BillingEvent baru, laporan billing tidak menghitung re-send; ini keputusan
  produk yang harus disepakati.
- **Schema**: kolom audit re-send memerlukan migrasi; alternatif tanpa migrasi memakai
  `targetSnapshot` tetapi kurang rapi.
- **SDK**: wrapper lokal sementara menambah satu jalur pemanggilan di console; harus dihapus saat
  SDK berikutnya tersedia.
- **Polling**: interval 5 detik menambah request; dibatasi hanya saat ada item in-flight.
- **Tidak ada browser automation**: verifikasi UI tetap manual; bukti otomatis berupa build,
  backend e2e, HTTP, dan DB.
- **Tanpa RBAC granular**: semua tenant admin dapat melakukan re-send.

---

## 10. Pertanyaan keputusan

1. Apakah ruang lingkup yang disetujui adalah **Fase A + Fase B** (refresh + re-send failed-only)?
2. Apakah boleh menambah kolom `resendOfNotificationId`/`resendMode` (migrasi Prisma), atau harus
   tanpa migrasi?
3. Apakah re-send boleh membuat notification baru tanpa `BillingEvent` (default aman), atau harus
   mengikuti billing seperti pengiriman baru?
4. Apakah `all` ikut di rilis pertama, atau ditunda setelah `failed` stabil?
5. Apakah wrapper `HttpTransport` lokal dapat diterima sampai SDK berikutnya, atau harus merilis
   `@notifhub/js` versi baru lebih dulu?

Setelah keputusan ini disetujui, implementasi dimulai dengan Fase A, lalu Fase B.

---

## 11. Status implementasi (2026-11-16)

Fase A dan B disetujui dan diterapkan:

- RefreshControl, last updated, auto-refresh in-flight, `refetchOnWindowFocus`.
- Detail payload/target snapshot/error message/event payload.
- Endpoint `POST /api/v1/admin/notifications/:id/resend` (failed-only).
- Audit `resendOfNotificationId`/`resendMode` lewat migrasi `20261116130000_resend_audit`.
- Tombol dan dialog **Kirim ulang yang gagal**, link notification hasil.
- Backend E1–E11 lulus; console `typecheck`/`build` lulus.
- Wrapper `adminResend` diuji lewat Vite SSR terhadap backend yang berjalan: `202` dan
  `recipient_count=1` untuk satu pasangan failed.

Fase C (re-send all, search, compose, template test, export) tetap ditunda. Batasan re-send
(template/preferensi/override) tetap seperti §5.4.

### 11.1 Audit ulang (2026-11-20)

Cakupan console saat ini dibandingkan Admin API:

| Area | Console | Catatan |
|---|---|---|
| Dashboard | count status + grafik 14 hari + auto-refresh 60 s | agregasi client-side |
| Notifications | filter status/template/tanggal, search ID/recipient exact, page size 20/50/100, detail, resend failed, auto-refresh in-flight | belum export, resend all, cancel/retry |
| Templates | list/create/edit, preview, test send, publish/rollback/clone, riwayat/audit/test send, aset gambar | item Fase C "template test" sudah selesai |
| Subscribers | list/detail, editor preferensi | data read-only dari push consumer |
| Topics | list/detail, tambah/ubah membership, `expiresAt` | |
| API keys | list/create (nama + `allowedOrigins`), revoke | `subscriberJwtSecret` belum ada di form; edit origins belum didukung backend |
| Platform | login, tenant list/detail, provisioning, admin tenant, suspend/resume, hapus, audit | hanya untuk multi-tenant |
| Akun admin | login/logout, sesi | belum ada ganti password/profil sendiri |

Gap yang tersisa dan prioritas:

| Prioritas | Gap | Dampak | Butuh backend? |
|---|---|---|---|
| P1 (selesai) | Ganti password admin sendiri | Rotasi password harus ubah env + restart; tidak praktis | Ya |
| P1 (selesai) | Isi `subscriberJwtSecret` saat buat API key | Secret per tenant hanya lewat curl; berisiko memakai fallback env | Tidak (DTO sudah ada) |
| P1 (selesai) | Search notification ID/recipient + page size | Investigasi lambat saat volume naik | Ya |
| P1 (selesai) | CSP header untuk console | Mitigasi XSS belum ada di konfigurasi nginx/Caddy | Tidak (config) |
| P2 (selesai) | Export CSV notification/recipient | Pelaporan manual | Ya |
| P2 (selesai) | Resend all dengan konfirmasi | Pengingat massal belum bisa | Ya |
| P2 | Compose/send dari console | Admin masih lewat API/curl | Ya |
| P2 (selesai) | Audit aksi admin tenant | Tidak ada jejak aksi admin tenant | Ya (tabel audit) |
| P3 | Test/browser automation console | Regresi UI tidak otomatis | Tidak (tooling) |
| P3 | Pindahkan wrapper `adminTemplates`/`adminResend`/platform ke SDK terbit | Dua jalur pemanggilan | Ya (rilis SDK) |

Catatan: compose/send bukan blocker single tenant bila pengiriman memang dilakukan consumer lewat
API/SDK. Untuk operator yang ingin mengirim manual dari console, ini gap utama.

P1 sudah diimplementasikan dan diverifikasi pada 2026-11-20:
[console-admin-hardening.md](console-admin-hardening.md) §16. P2a (export CSV + resend all) dan P2b
(audit admin tenant) selesai: [console-operations-p2.md](console-operations-p2.md) §13–§14. Sisa
gap P2 (compose/send) dan P3 (test/browser automation, pemindahan wrapper ke SDK terbit) belum
dikerjakan.
