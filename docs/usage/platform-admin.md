# Panduan platform admin

Panduan untuk **operator platform**: mengelola tenant lintas tenant lewat lane `/platform/*`.
Lane ini terpisah dari tenant admin (`/admin/*`) dan end-user (`/subscriber/*`): token platform
tidak membawa klaim tenant, dan tenant admin tidak bisa memakai lane ini.

| Hal | Nilai |
|---|---|
| Endpoint | `/api/v1/platform/*` |
| Kredensial | `Authorization: Bearer <platform admin JWT>` |
| Mendapatkan token | `POST /api/v1/platform/auth/login` |
| Console | `/platform/login` di aplikasi console (tidak ditautkan dari login tenant; simpan sebagai bookmark) |
| Role | `platform_admin` (akun dengan `tenantId = NULL`) |

Kontrak lengkap: Swagger `GET /api/docs` (basic auth di luar development). Desain dan alasan
keputusan: [multi-tenant-platform-admin.md](../design/multi-tenant-platform-admin.md).

## Menyiapkan akun platform admin

Akun platform admin **tidak dibuat lewat API** di v1; sumbernya environment:

```bash
# buat hash bcrypt
npm run admin:hash-password "PasswordKuat123!"

# .env (lokal) atau secret manager (produksi)
PLATFORM_ADMIN_EMAIL=ops@example.com
PLATFORM_ADMIN_PASSWORD_HASH='$2b$10$....'
```

- Kedua variabel harus diisi bersama. Bila kosong keduanya, backend tetap jalan tetapi mencatat
  warning `platform.admin.bootstrap.missing` dan lane platform tidak dapat dipakai.
- `PLATFORM_ADMIN_EMAIL` **tidak boleh** sama dengan `ADMIN_EMAIL`; bila bentrok, startup gagal
  cepat agar akun tenant tidak berpindah lane tanpa sengaja.
- Restart backend setelah mengubah env. Bootstrap bersifat idempoten: akun dan hash diperbarui,
  bukan diduplikasi.

Untuk lokal, `.env` pengembangan boleh memuat akun contoh (mis. `platform@notifhub.local`);
jangan pakai kredensial contoh di staging/produksi.

## Login dan sesi

```bash
curl -s -X POST http://localhost:3000/api/v1/platform/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"platform@notifhub.local","password":"Platform123!"}'
```

- Respons memuat `accessToken`, `expiresIn`, dan `admin` (`id`, `email`, `role`) **tanpa**
  `tenantId`.
- Login dibatasi 5 percobaan per menit per IP. Password salah → `401`; akun bukan platform admin
  aktif → `403`.
- Di console, sesi disimpan terpisah dari sesi tenant admin, sehingga kedua lane bisa dipakai di
  tab yang sama tanpa saling menimpa.

## Mengelola tenant

| Aksi | Endpoint | Catatan |
|---|---|---|
| Daftar tenant | `GET /platform/tenants?status=&q=&limit=&offset=` | `q` mencari id/nama; respons memuat `adminCount` dan `apiKeyCount` |
| Detail | `GET /platform/tenants/:id` | `404 tenant_not_found` |
| Buat tenant | `POST /platform/tenants` | Body `{ "id": "acme", "name": "Acme Corp" }`; `id` slug huruf kecil/angka/tanda hubung, permanen |
| Ubah nama | `PATCH /platform/tenants/:id` | Body `{ "name": "..." }`; `id` tidak bisa diubah |
| Suspend | `POST /platform/tenants/:id/suspend` | Idempoten; mengisi `suspendedAt` |
| Resume | `POST /platform/tenants/:id/resume` | Idempoten; mengosongkan `suspendedAt` |
| Hapus | `DELETE /platform/tenants/:id` | `204` hanya untuk tenant kosong; `409 tenant_not_empty`; `403 tenant_protected` untuk tenant default |

Aturan yang perlu diingat:

- Tenant baru tidak punya admin, API key, atau template. Tambahkan admin tenant lebih dulu, lalu
  admin tersebut membuat API key dan template untuk tenant-nya.
- **Suspend bukan hapus**: data tetap tersimpan. Request baru ditolak, job yang sudah antre tetap
  diproses, dan webhook provider tetap dicatat agar status pengiriman yang sudah terjadi tidak
  hilang.
- `DELETE` hanya untuk tenant benar-benar kosong. Untuk berhenti memakai tenant, gunakan
  `suspend`.

### Efek suspend per lane

| Lane | Efek |
|---|---|
| Ingest (`X-API-Key`) | `403 tenant_suspended` |
| Admin tenant (login dan request dengan token lama) | `403 tenant_suspended` |
| Subscriber (in-app, SSE, preference center) | `403 tenant_suspended` |
| Platform admin | Tetap berjalan |
| `/metrics` | Tetap dapat diakses (pengecualian monitoring) |
| Webhook provider | Tetap diproses dan dicatat |

## Mengelola admin tenant

| Aksi | Endpoint |
|---|---|
| Daftar admin | `GET /platform/tenants/:id/admins` |
| Buat admin | `POST /platform/tenants/:id/admins` — body `{ "email", "password" }`, password ≥ 8 |
| Reset password | `PATCH /platform/tenants/:id/admins/:adminId` — body `{ "password": "..." }` |
| Nonaktifkan / aktifkan | `PATCH /platform/tenants/:id/admins/:adminId` — body `{ "active": false }` |

- Email admin unik **global** (satu akun = satu tenant). Email yang sudah dipakai → `409
  admin_email_taken`.
- Admin aktif terakhir tidak bisa dinonaktifkan (`409 last_tenant_admin`); reset password adalah
  jalur yang aman.
- Akun platform admin tidak dapat dibuat/diubah lewat rute ini (`404`).
- Password awal harus diserahkan lewat kanal aman; belum ada undangan email atau reset mandiri.

## Audit

| Aksi | Endpoint |
|---|---|
| Baca audit | `GET /platform/audit?tenantId=&action=&from=&to=&limit=&offset=` |

- Append-only: tidak ada endpoint ubah/hapus.
- Aksi yang tercatat: `tenant.created`, `tenant.renamed`, `tenant.suspended`, `tenant.resumed`,
  `tenant.deleted`, `tenant.admin.created`, `tenant.admin.updated`, `tenant.admin.deactivated`,
  `tenant.admin.password_reset`.
- Setiap entri memuat actor (id + email), tenant terdampak, target, `ip`, `requestId`, dan
  metadata non-rahasia. Password, hash, dan API key mentah tidak pernah disimpan.
- Penulisan audit bersifat best-effort: kegagalan menulis hanya di-log (`platform.audit.failed`)
  dan tidak membatalkan mutasi.

## Console

Halaman console memakai design system yang sama dengan console tenant (sidebar, topbar, tabel,
kartu) dengan aksen teal dan label **Platform**, sehingga terasa satu produk tetapi tetap mudah
dibedakan dari lane tenant.

| Halaman | Isi |
|---|---|
| `/platform/login` | Login platform admin |
| `/platform/tenants` | Daftar/filter tenant, buat tenant, suspend/resume |
| `/platform/tenants/:id` | Detail, ubah nama, suspend/resume, admin tenant, hapus tenant kosong |
| `/platform/audit` | Audit dengan filter tenant/aksi/tanggal |

## Kode error yang sering muncul

| `message` | Status | Arti |
|---|---|---|
| `invalid_credentials` | `401` | Email/password salah |
| `role_not_allowed` | `403` | Token/akun bukan platform admin untuk lane ini |
| `tenant_suspended` | `403` | Tenant sedang di-suspend (lane tenant) |
| `origin_not_allowed` | `403` | `Origin` tidak ada di `ApiKey.allowedOrigins` |
| `invalid_tenant_id` | `400` | Slug tenant tidak valid |
| `tenant_exists` | `409` | Tenant id sudah dipakai |
| `tenant_not_found` | `404` | Tenant tidak ada |
| `tenant_not_empty` | `409` | Tenant masih punya data |
| `tenant_protected` | `403` | Tenant default tidak boleh dihapus |
| `admin_email_taken` | `409` | Email admin sudah dipakai |
| `last_tenant_admin` | `409` | Aksi menghabiskan admin aktif terakhir |

Rate limit platform: login 5/menit/IP, mutasi 60/menit, baca 120/menit.

## Batasan v1

- Tidak ada impersonation atau tenant switcher: platform admin hanya melihat metadata tenant
  (status, nama, jumlah admin/API key), bukan isi notifikasi/subscriber/template.
- Tidak ada endpoint untuk mengelola akun platform admin lain; tambahkan lewat env lalu restart.
- RBAC granular (mis. `platform_readonly`) belum ada.
- Kuota/rate limit per tenant belum ada; rate limit saat ini per IP untuk lane terkait.

Panduan sisi tenant (API key, template, subscriber) ada di
[admin-and-operations.md](admin-and-operations.md); konfigurasi environment di
[configuration.md](../getting-started/configuration.md).
