# Desain binding React dan console admin

Status: **terimplementasi dan terverifikasi**.
Basis: PART 1 (SDK-first rule 29, Admin Console tenant-only, stack frontend fixed) dan fondasi
platform notifikasi yang sudah berjalan (lihat `docs/getting-started/local-setup.md`, `docs/design/in-app.md`,
`docs/design/email-and-preferences.md`, `docs/design/admin-api.md`).

**Isi dokumen**

- [1. Ruang lingkup](#1-ruang-lingkup)
- [2. Arsitektur frontend & auth](#2-arsitektur-frontend--auth)
- [3. Ekstensi `@notifhub/js` — `NotifHubAdminClient`](#3-ekstensi-notifhubjs--notifhubadminclient)
- [4. `@notifhub/react`](#4-notifhubreact)
- [5. `notifhub-console`](#5-notifhub-console)
- [6. Struktur folder](#6-struktur-folder)
- [7. Verifikasi](#7-verifikasi)
- [8. Keputusan desain](#8-keputusan-desain)
- [9. Catatan implementasi](#9-catatan-implementasi)
- [10. Iterasi console: refresh dan resend failed](#10-iterasi-console-refresh-dan-resend-failed)
- [11. Editor template v2 (2026-11-16)](#11-editor-template-v2-2026-11-16)
- [11. Aset template tanpa kode (2026-11-16)](#11-aset-template-tanpa-kode-2026-11-16)

---

## 1. Ruang lingkup

### Termasuk dalam cakupan

1. **Ekstensi `@notifhub/js`** dengan `NotifHubAdminClient` (data fetching Admin API) memakai
   `HttpTransport` yang sudah ada (token injection, retry, typed error) — tanpa `fetch` mentah
   di aplikasi console.
2. **`@notifhub/react`** (packages/react): provider, hook, dan komponen headless
   (NotificationBell, NotificationInbox) yang dibangun di atas `@notifhub/js` (fetch-based SSE).
3. **Aplikasi `notifhub-console`** (React 18 + Vite + TypeScript strict + Bootstrap 5):
   - login admin + route guard,
   - dashboard ringkas + grafik,
   - notifications (list, filter, detail dengan recipients/attempts/events),
   - templates (list, create, edit, deactivate),
   - subscribers (list, detail, editor preferensi),
   - topics (list, detail, editor membership),
   - API keys (list, create, revoke),
   - profil admin + logout.
4. Build/typecheck untuk ketiga paket dan verifikasi end-to-end terhadap backend Admin API
   (lihat `docs/design/admin-api.md`).

### Tidak termasuk (di luar cakupan)

- WhatsApp provider/worker (lihat `docs/design/whatsapp.md`), Go SDK (lihat `docs/sdk/go-sdk.md`).
- Console platform (`/platform/*`): di luar dokumen ini, dirancang dan diimplementasikan di
  `docs/design/multi-tenant-platform-admin.md` (F4).
- Refresh token, SSO/OIDC, RBAC granular, audit log UI.
- End-user preference center (lihat `docs/design/preference-center.md`), self-service subscription UI.
- Containerisasi console/backend (Dockerfile/production compose belum diminta).
- Browser automation/E2E suite (Playwright) — verifikasi manual + unit test.

---

## 2. Arsitektur frontend & auth

- Console adalah SPA terpisah (`console/`) yang memanggil backend lewat
  `NotifHubAdminClient` (dari `@notifhub/js`). Tidak ada `fetch`/`axios` langsung ke NotifHub.
- **Login**: `POST /api/v1/admin/auth/login` → JWT admin disimpan di **sessionStorage**
  (bukan localStorage) bersama profil admin. Token dibaca ulang saat aplikasi dimuat.
- Semua request admin mengirim `Authorization: Bearer <token>`; `401` dari API →
  hapus sesi, redirect ke `/login` (interceptor di layer SDK/TanStack Query).
- Token dicek `exp` di client sebelum dipakai; jika kedaluwarsa → logout.
- Tidak ada refresh token pada cakupan ini (belum ada endpoint-nya).
- CORS: development memakai `CORS_ORIGINS=*`; di luar development origin console harus
  didaftarkan eksplisit.

---

## 3. Ekstensi `@notifhub/js` — `NotifHubAdminClient`

### 3.1 Konstruksi

```ts
const admin = new NotifHubAdminClient({
  baseUrl: 'http://localhost:3000',
  getToken: () => session.adminToken, // boleh undefined saat login
});
```

- Memakai `HttpTransport` yang sama (retry 5xx/429, `NotifHubError`, cancellation).
- `HttpTransport` diperluas: method `PUT`/`PATCH`/`DELETE`, opsi `auth: false` (login),
  dan opsi `retry: false` untuk mutasi yang tidak idempoten (create API key/template,
  replace/add membership) agar 5xx setelah commit tidak menghasilkan duplikasi.
- Endpoint admin selalu di bawah `/api/v1/admin`.

### 3.2 Surface

```ts
class NotifHubAdminClient {
  login(email: string, password: string): Promise<AdminLoginResult>;
  me(): Promise<AdminProfile>;

  listApiKeys(): Promise<ApiKeySummary[]>;
  createApiKey(input: { name: string; allowedOrigins?: string[] }): Promise<CreatedApiKey>;
  revokeApiKey(id: string): Promise<{ id: string; active: false }>;

  listTemplates(query?: TemplateQuery): Promise<Paged<Template>>;
  getTemplate(id: string): Promise<Template>;
  createTemplate(input: CreateTemplateInput): Promise<Template>;
  updateTemplate(id: string, patch: UpdateTemplateInput): Promise<Template>;
  deactivateTemplate(id: string): Promise<Template>;

  listSubscribers(query?: ListQuery): Promise<Paged<Subscriber>>;
  getSubscriber(externalId: string): Promise<Subscriber>;
  listPreferences(externalId: string): Promise<Preference[]>;
  upsertPreference(externalId: string, channel: Channel, input: PreferenceInput): Promise<Preference>;

  listTopics(query?: ListQuery): Promise<Paged<TopicSummary>>;
  getTopic(key: string): Promise<TopicDetail>;
  listTopicMembers(key: string, includeExpired?: boolean): Promise<TopicMembers>;
  replaceTopicMembers(key: string, input: TopicMembersInput): Promise<TopicMutation>;
  addTopicMembers(key: string, input: TopicMembersInput): Promise<TopicMutation>;

  listNotifications(query?: NotificationQuery): Promise<Paged<NotificationSummary>>;
  getNotification(id: string): Promise<NotificationDetail>;
}
```

Tipe model ditulis manual mengikuti kontrak Admin API (lihat `docs/design/admin-api.md`; OpenAPI tetap
sumber kebenaran, dan tipe admin bukan target SDK generation pihak ketiga).

---

## 4. `@notifhub/react`

### 4.1 API

```tsx
<NotifHubProvider
  client={client}            // instance @notifhub/js (wajib)
  onError={(error) => ...}   // opsional
>
  <App />
</NotifHubProvider>

const {
  client, status,            // 'connecting' | 'open' | 'closed'
  notifications, unreadCount,
  markRead, refresh,
} = useNotifHub();

<NotificationBell onClick={...} />
<NotificationInbox limit={20} onNotificationClick={(n) => ...} />
```

- Provider membuat **satu** `SseConnection` saat mount dan menutupnya saat unmount;
  event baru masuk ke state, dedupe sudah ditangani SDK.
- `unreadCount` = jumlah item `status !== 'read'` dari halaman catch-up (`limit 50`) +
  penambahan dari event SSE, dikurangi saat `markRead` berhasil.
- `markRead(notificationId)` memanggil SDK lalu memperbarui state lokal.
- Komponen bersifat **headless**: markup minimal, className stabil (`notifhub-bell`,
  `notifhub-inbox`, dst), tanpa dependency Bootstrap/Tailwind. Styling diserahkan konsumen.
- `renderItem`/`renderBadge` opsional untuk kustomisasi.
- Peer dependency `react >=18 <19`; dependency `@notifhub/js` (workspace).
- Build `tsup` ESM+CJS+d.ts, `"use client"` tidak ditambahkan (bukan Next-specific).

### 4.2 Batasan

- Belum ada endpoint unread-count; angka bell dihitung dari halaman yang di-fetch + event.
- Tidak ada komponen bergaya siap pakai; contoh CSS disediakan di README.
- Paket juga menyediakan hook `usePreferences` untuk data preferensi end-user; lihat
  `docs/design/preference-center.md`.

---

## 5. `notifhub-console`

### 5.1 Stack

React 18, Vite, TypeScript strict, Bootstrap 5 + react-bootstrap, TanStack Query v5,
React Router v6, TanStack Table v8, React Hook Form + zod, Recharts, date-fns,
`@notifhub/js` (admin client). Tanpa Tailwind/shadcn/MUI. Tanpa `fetch`/`EventSource` langsung.

### 5.2 Rute & halaman

| Rute | Halaman |
|---|---|
| `/login` | Form login (RHF+zod), error dari `NotifHubError` |
| `/` | Dashboard: kartu total notifications per status, grafik 14 hari, daftar 5 terbaru |
| `/notifications` | Tabel (TanStack Table) + filter status/template/tanggal + pagination |
| `/notifications/:id` | Detail + tabel recipients (status, attempts, provider, timestamps, lastError) + attempts terakhir + events terakhir |
| `/templates` | Tabel + filter channel/locale/active + tombol create/deactivate |
| `/templates/new` | Form create (subject/body Handlebars, fallback channel/provider) |
| `/templates/:id/edit` | Form edit + preview render sederhana (client-side Handlebars? tidak; preview menampilkan source) |
| `/subscribers` | Tabel + search + pagination |
| `/subscribers/:externalId` | Detail + editor preferensi per channel (enabled, quiet hours, timezone) |
| `/topics` | Tabel + member count + search |
| `/topics/:key` | Detail + editor membership (replace/add, expiresAt, isTimeBound) |
| `/api-keys` | Tabel + create (raw key ditampilkan sekali) + revoke |
| `*` | Halaman 404 sederhana |

Layout: sidebar + topbar Bootstrap, indikator admin/tenant, tombol logout, toast/alert error.

### 5.3 State & data fetching

- Satu `QueryClient` (staleTime 30s, retry 1, refetchOnWindowFocus false).
- Query key per resource; mutasi meng-invalidate key terkait.
- Semua panggilan lewat `NotifHubAdminClient`; error `NotifHubError` dipetakan ke pesan UI
  (`unauthorized` → logout, `not_found` → halaman kosong, lainnya → alert).
- Pagination limit/offset (maks 100) sesuai Admin API (lihat `docs/design/admin-api.md`).
- Dashboard: 4 query count (status pending/partial/sent/failed dengan `limit=1` → `total`)
  + 1 query 200 notifikasi terbaru untuk grafik 14 hari (agregasi client-side).
  Ini batasan yang didokumentasikan (belum ada endpoint analytics).

### 5.4 Form & validasi

- Login, template, preference, topic membership, create API key memakai React Hook Form + zod.
- Skema zod mirroring DTO backend (key pattern, HH:mm, timezone, channel enum, ISO date).

### 5.5 Konfigurasi

- `VITE_NOTIFHUB_API_URL` (default `http://localhost:3000`).
- Dev server port `5173`; build statis di `console/dist` (tidak ada Dockerfile).
- `.env.example` console berisi variabel di atas.

---

## 6. Struktur folder

```
console/
  package.json, tsconfig.json, vite.config.ts, index.html, .env.example, README.md
  src/
    main.tsx, App.tsx, env.ts
    lib/ adminClient.ts (instance + token accessor), session.ts, queryClient.ts, format.ts
    auth/ AuthContext.tsx, ProtectedRoute.tsx, LoginPage.tsx
    layout/ AppLayout.tsx, Sidebar.tsx, Topbar.tsx, ErrorAlert.tsx
    pages/ DashboardPage.tsx, NotificationsPage.tsx, NotificationDetailPage.tsx,
           TemplatesPage.tsx, TemplateFormPage.tsx, SubscribersPage.tsx,
           SubscriberDetailPage.tsx, TopicsPage.tsx, TopicDetailPage.tsx,
           ApiKeysPage.tsx, NotFoundPage.tsx
    components/ DataTable.tsx, Pagination.tsx, StatusBadge.tsx, EmptyState.tsx,
                ConfirmDialog.tsx, ChannelBadge.tsx, QueryState.tsx
    forms/ loginSchema.ts, templateSchema.ts, preferenceSchema.ts,
           topicMembersSchema.ts, apiKeySchema.ts
  test/ (vitest + @testing-library/react) minimal: LoginPage, StatusBadge
```

`packages/js-sdk` tambahan: `src/admin-client.ts`, `src/admin-types.ts`, `src/http.ts`
(perluasan method), `test/admin-client.test.ts`.
`packages/react` implementasi: `src/{index,provider,hooks,bell,inbox,types}.tsx/ts`,
`test/notification-inbox.test.tsx`.

`console/` **bukan** npm workspace root (agar dependency frontend tidak bercampur dengan backend);
instalasi: `npm --prefix console install`, script `npm run console:install|dev|build|typecheck`
di root (menjalankan perintah di folder console). Panduan setup ada di `docs/getting-started/local-setup.md`.

---

## 7. Verifikasi

1. `npm run sdk:build`, `npm run sdk:test` (termasuk test admin client baru).
2. `npm --prefix packages/react install` (sekali) → `npm --prefix packages/react run build` +
   `npm --prefix packages/react run typecheck` + unit test komponen.
3. `npm --prefix console install` → `typecheck`, `build` (Vite).
4. Backend berjalan; smoke script Node memakai `NotifHubAdminClient`: login, list
   notifications/templates/subscribers/topics/api-keys, create+revoke key, create+deactivate
   template, upsert preference, replace membership — memastikan SDK admin cocok dengan API.
5. `npm --prefix console run dev`: `GET http://localhost:5173` → 200 HTML; login manual oleh
   pengguna di browser, cek dashboard/grafik, notifications+detail, template create/edit,
   subscriber preferences, topic membership, API key create/revoke, logout saat 401.
6. Regresi backend: `npm run start:dev` tetap sehat; endpoint yang sudah ada tidak berubah.

Catatan: tidak ada browser automation (Playwright); verifikasi UI manual didokumentasikan di
README console.

---

## 8. Keputusan desain

| # | Keputusan | Diterapkan |
|---|---|---|
| D1 | Perluas `@notifhub/js` dengan `NotifHubAdminClient`; console hanya memakai SDK (bukan axios/fetch/EventSource) | Ya |
| D2 | `console/` aplikasi terpisah (bukan npm workspace root), script root `console:*` | Ya |
| D3 | Token admin di sessionStorage, cek `exp`, `401` → logout; tanpa refresh token | Ya |
| D4 | `@notifhub/react` headless (classNames minimal, tanpa Bootstrap/Tailwind) | Ya |
| D5 | `unreadCount` dihitung dari halaman catch-up + event SSE (tanpa endpoint baru) | Ya |
| D6 | Dashboard diagregasi client-side; belum ada endpoint analytics | Ya |
| D7 | React 18 + Vite + Bootstrap 5 + react-bootstrap + TanStack Query/Table + RHF+zod + Recharts + date-fns | Ya |
| D8 | Tanpa Dockerfile/compose console; build statis saja | Ya |
| D9 | Test minimal: admin client (vitest), 1–2 komponen React, typecheck/build; UI manual | Ya |
| D10 | Console tidak memakai SSE admin (tidak ada endpoint SSE admin); SSE hanya untuk `@notifhub/react` di aplikasi end-user | Ya |
| D11 | Login page menampilkan pesan rate limit (429) dan kredensial salah (401) secara berbeda | Ya |
| D12 | Versi root naik ke `0.6.0`; `@notifhub/js` `0.2.0`, `@notifhub/react` `0.1.0` | Ya |
| D13 | Refresh per halaman + waktu update; `refetchOnWindowFocus`; auto-refresh 5s saat notifikasi in-flight | Ya |
| D14 | Re-send failed membuat notification baru (bukan mutasi), audit `resendOfNotificationId`/`resendMode` | Ya |
| D15 | Re-send failed memakai wrapper `HttpTransport` console sampai method masuk rilis SDK berikutnya | Ya |
| D16 | Re-send tidak membuat BillingEvent baru; `all` belum didukung | Ya |

---

## 9. Catatan implementasi

1. **`NotifHubAdminClient` masuk ke `@notifhub/js` 0.2.0**; `HttpTransport` diperluas dengan
   `PUT`/`DELETE`, opsi `auth:false` (login) dan `retry:false` (mutasi non-idempoten). Console
   tidak memakai `axios`/`fetch` langsung.
2. **Console berdiri sendiri** di `console/` dengan `node_modules` sendiri; root menambahkan
   script `console:install|dev|build|typecheck` serta `react:*`.
3. **`@notifhub/react` headless** (`NotifHubProvider`, `useNotifHub`, `NotificationBell`,
   `NotificationInbox`). Test memakai `react-dom/server` (tanpa jsdom) untuk memverifikasi
   markup bell/inbox/empty state.
4. **Sesi console** di `sessionStorage`; handler global `401` dipasang lewat `QueryCache` dan
   `MutationCache` TanStack Query.
5. **Dashboard** mengagregasi data client-side (4 query count + 200 notifikasi terbaru) karena
   belum ada endpoint analytics.
6. **Tidak ada perubahan backend** untuk binding React dan console admin; CORS development tetap
   `*`, origin console harus didaftarkan di luar development.
7. **Ukuran bundle console** ±868 KB (gzip ±255 KB) — peringatan Vite muncul; code splitting
   ditunda sampai ada kebutuhan nyata.
8. **Verifikasi:** 18 test SDK (termasuk 4 test admin client), 3 test React, typecheck/build
   console, smoke test admin client 23/23 terhadap backend, dan dev server console merespons
   `200` di `http://localhost:5173`. Verifikasi UI (klik alur) manual di browser.
9. **Versi:** root `0.6.0`, `@notifhub/js` `0.2.0`, `@notifhub/react` `0.1.0`,
   `notifhub-console` `0.1.0`.
10. **UI console dirombak** setelah review: desain netral/minimal (sidebar terang, tanpa gradient
    atau glow, tipografi tenang, stat strip, status berbasis teks + titik, skeleton loading,
    responsif). Fungsionalitas dan alur data tidak berubah. **Login 2026-11-21:** memakai
    `LoginShell` dua kolom (Delivery Ledger) untuk tenant/platform; lihat
    `docs/design/console-login-experience.md`.

---

## 10. Iterasi console: refresh dan resend failed

Status: terimplementasi dan terverifikasi pada 2026-11-16.

### 10.1 Refresh

- `RefreshControl` reusable di `PageHeader.actions` untuk dashboard, notifications, notification
  detail, templates, subscribers, subscriber detail, topics, topic detail, dan API keys.
- Menampilkan waktu update relatif dan spinner saat `isFetching`.
- `refetchOnWindowFocus: true` di QueryClient.
- Auto-refresh 5 detik hanya saat notification list/detail berisi `pending`/`partial`; dashboard
  60 detik. Tidak ada polling saat status terminal.
- Filter dan pagination dipertahankan saat refetch.

### 10.2 Re-send failed

- Endpoint `POST /api/v1/admin/notifications/:id/resend` dengan body `{ mode: "failed",
  requestKey }`.
- Hanya pasangan `(recipientId, channel)` berstatus `failed` yang dikirim ulang; bukan fan-out
  ulang semua channel.
- Notification baru + baris baru + job baru; notification asli immutable.
- `resendOfNotificationId` dan `resendMode` menyimpan audit link.
- `requestKey` idempotent; replay dengan key yang sama mengembalikan notification baru yang sama.
- Tidak membuat `BillingEvent` baru.
- UI: tombol **Kirim ulang yang gagal (N)**, dialog konfirmasi yang menjelaskan template/preferensi/
  override, dan link ke notification hasil.
- Kolom audit ditambahkan lewat migrasi `20261116130000_resend_audit`.

### 10.3 Detail troubleshooting

- Admin detail sekarang mengembalikan `payload`; event mengembalikan `rawPayload`.
- UI menampilkan payload, target snapshot, `errorMessage` attempt, event payload (collapsible),
  serta filter status recipient.
- `resendOfNotificationId` ditampilkan sebagai tautan ke notification asli.

### 10.4 Verifikasi

- Backend: `npm run typecheck`, `npm run build`, `npm run test:e2e -- --runInBand`; E1–E11 lulus,
  termasuk resend failed, audit link, idempotensi, dan tidak ada BillingEvent baru.
- Console: `npm run console:typecheck`, `npm run console:build`; UI manual di browser tetap langkah
  pengguna (tanpa Playwright).

### 10.5 Batasan

- Mode `all` belum tersedia.
- Re-send memakai template aktif dan data Subscriber saat ini; inline override lama tidak tersimpan.
- Wrapper `HttpTransport` lokal harus dipindahkan ke `NotifHubAdminClient` pada rilis SDK berikutnya.
- Tidak ada RBAC granular; semua tenant admin dapat melakukan re-send.

---

## 11. Editor template v2 (2026-11-16)

Desain dan batasan ada di `docs/design/templates/template-system-design.md`.

- `/templates`: filter status/channel/locale, aksi edit/clone/activate/deactivate, status dan versi.
- `/templates/new` dan `/templates/:id/edit`: editor dua panel (konten, variabel, aset,
  pengaturan) + preview iframe `sandbox=""` desktop/mobile. Draft bisa disimpan walau belum valid;
  publish memvalidasi ulang di server.
- `/templates/assets`: membuat versi baru layout/theme/partial; tidak ada edit in-place.
- `/templates/:id/history`: versi, audit, test send, dan rollback (membuat draft baru).
- Console memakai wrapper `HttpTransport` di `console/src/lib/adminTemplates.ts`; paket
  `@notifhub/js` 0.3.0 dan `@notifhub/react` 0.2.0 tidak diubah. **Sejak 2026-11-21:** wrapper
  template dan platform dipindahkan ke SDK (`NotifHubTemplatesClient`/`NotifHubPlatformClient`);
  lihat `docs/design/console-sdk-consolidation.md`.
- Router console memakai `createBrowserRouter` agar editor bisa memakai `useBlocker` untuk
  perubahan belum disimpan.

## 11. Aset template tanpa kode (2026-11-16)

- Theme memakai form warna/font/ukuran/radius/button dengan preview langsung; JSON hanya untuk
  mode advanced.
- Layout memakai galeri preset (transaksional/promo/notifikasi) + field logo/brand/footer;
  partial memakai form header/footer/CTA/signature. HTML tetap bisa diedit lewat mode advanced.
- Detail dan batasan: `docs/design/templates/email-authoring-ui-design.md`.

### 11.2 Block builder email (2026-11-16)

- Tab Konten punya toggle **Visual/HTML**. Visual menyediakan block heading, teks, gambar, tombol,
  divider, spacer, dan dua kolom; properti block, reorder, duplikat, hapus, dan variable picker.
- `builderData` JSON disimpan di samping `body` HTML; worker tidak membacanya. Template lama tanpa
  builderData tetap memakai HTML. Detail: `docs/design/templates/email-block-builder-design.md`.
