# Desain production readiness

Status: **terimplementasi dan terverifikasi** (lihat §11).
Basis: `docs/architecture/project-brief.md`, kondisi repo saat ini, dan `docs/design/preference-center.md`.

**Isi dokumen**

- [1. Latar belakang](#1-latar-belakang)
- [2. Ruang lingkup](#2-ruang-lingkup)
- [3. Arsitektur test](#3-arsitektur-test)
- [4. Skenario e2e](#4-skenario-e2e)
- [5. Docker](#5-docker)
- [6. CI (`github/workflows/ci.yml`)](#6-ci-githubworkflowsciyml)
- [7. Keputusan bernomor](#7-keputusan-bernomor)
- [8. Daftar file](#8-daftar-file)
- [9. Rencana verifikasi](#9-rencana-verifikasi)
- [10. Risiko dan batasan](#10-risiko-dan-batasan)
- [11. Catatan implementasi](#11-catatan-implementasi)

---

## 1. Latar belakang

Fitur sudah lengkap dan terverifikasi, tetapi repo belum siap dirilis:

1. **Tidak ada test otomatis untuk backend.** Verifikasi selama ini manual (`npm run
   verify:preferences`, 33 check) dan hanya berjalan bila seseorang menjalankannya. Tidak ada
   regression net untuk ingest, auth, isolasi tenant, atau worker.
2. **Tidak ada image.** Backend dan console hanya berjalan dari host (`npm run start:dev`), jadi
   deploy bergantung pada Node, npm, dan Prisma CLI di mesin tujuan.
3. **Tidak ada CI.** Tidak ada yang menjalankan typecheck/build/test pada perubahan, dan tidak ada
   penjaga drift untuk `openapi/notifhub.json` (spec publik yang menjadi kontrak SDK).
4. **Repo ini belum berupa git repository**, sehingga workflow CI belum bisa dieksekusi di sini.
   Karena itu jalur CI harus punya padanan lokal yang bisa dijalankan dan diverifikasi sekarang.
5. **Temuan kecil:** deskripsi Swagger `POST /api/v1/notify` masih memuat istilah fase pada label
   API key, sehingga istilah internal bocor ke dokumentasi API publik.

Tujuan pekerjaan ini: membuat proyek bisa diuji otomatis, dibangun menjadi image, dan
diverifikasi oleh pipeline — tanpa menambah fitur produk.

---

## 2. Ruang lingkup

### 2.1 Termasuk

1. **Ekstraksi bootstrap**: `src/bootstrap.ts` mengekspor `createApp()`; `src/main.ts` hanya
   memanggilnya lalu `listen()`. Dipakai juga oleh test e2e agar test melewati jalur bootstrap yang
   sama dengan produksi (prefix, body parser + `rawBody`, CORS, Swagger, ValidationPipe, filter,
   interceptor).
2. **Suite Jest e2e** untuk alur kritis (10 skenario, §4), berjalan di database dan Redis terpisah
   dari dev.
3. **Infrastruktur test**: `scripts/test-db-setup.mjs` (buat database test, `prisma migrate
   deploy`, kosongkan Redis test), `test/env.ts`, helper reset/fixture.
4. **Docker**: `Dockerfile` backend (multi-stage, termasuk target `migrator`), `console/Dockerfile`
   (Vite build + nginx), `.dockerignore`, `docker-compose.prod.yml`, `.env.prod.example`.
5. **CI**: `.github/workflows/ci.yml` dengan job `backend`, `packages`, `go`, `docker`.
6. **Padanan lokal untuk CI**: `npm run ci` yang menjalankan urutan sama di mesin dev.
7. **Housekeeping**: hapus istilah fase dari deskripsi Swagger, perbarui dokumentasi dan versi
   (`0.10.0`).

### 2.2 Tidak termasuk

- Fitur produk baru (self-service topik, SDK bahasa lain). Platform admin/multi-tenant sudah
  dikerjakan terpisah di `docs/design/multi-tenant-platform-admin.md`.
- Perubahan schema/migrasi.
- Deploy sungguhan ke server/Kubernetes, registry push, environment staging.
- Test SSE jangka panjang di Jest (lihat §10).
- Observability tambahan (metrics/health/readiness sudah ada).
- Containerisasi database (Postgres/Redis tetap image resmi).

---

## 3. Arsitektur test

### 3.1 Bootstrap tunggal

```
src/bootstrap.ts   createApp(): Promise<NestExpressApplication>
                     ├─ NestFactory.create(AppModule, { bufferLogs, bodyParser: false })
                     ├─ logger, RequestIdMiddleware, express.json({ verify → rawBody })
                     ├─ CORS, global prefix, Swagger (basic auth di non-development)
                     ├─ ValidationPipe, HttpExceptionFilter, LoggingInterceptor
                     └─ enableShutdownHooks()
src/main.ts        createApp() → listen(PORT) + log application.started
test/*.e2e-spec.ts createApp() → supertest(app.getHttpServer())
```

Manfaat: test menguji jalur bootstrap nyata (bukan konfigurasi test terpisah), dan perilaku
produksi tidak bisa "hilang" karena seseorang lupa menyalin setup ke test.

### 3.2 Stack test

| Komponen | Pilihan | Alasan |
|---|---|---|
| Runner | Jest + ts-jest | `emitDecoratorMetadata` wajib untuk DI Nest; esbuild/Vitest tidak menghasilkan metadata tanpa plugin tambahan |
| HTTP | supertest | Standar Nest e2e; `app.getHttpServer()` tanpa membuka port |
| Nest testing | tidak dipakai | `createApp()` asli lebih setia; tidak perlu dependency tambahan |
| Database | `notifhub_test` | terpisah dari `notifhub_dev`; dibuat & dimigrasikan oleh `scripts/test-db-setup.mjs` |
| Redis | DB index 15 (`redis://localhost:6379/15`) | BullMQ/SSE test tidak bercampur dengan dev |

Dependency dev baru: `jest`, `ts-jest`, `@types/jest`, `supertest`, `@types/supertest`. Tidak ada
dependency runtime baru.

### 3.3 Isolasi dan fixture

- `test/env.ts` (dijalankan sebagai Jest `setupFiles`) mengisi **semua** env wajib dengan nilai
  test deterministik (`NODE_ENV=test`, `NOTIFHUB_MODE=development`, secret >= 32 karakter,
  `ADMIN_PASSWORD_HASH` dihitung dengan bcrypt saat runtime). Tidak memakai `.env` repo.
- `AppModule` diberi `ignoreEnvFile: process.env.NODE_ENV === 'test'` supaya test hermetik dan
  tidak dipengaruhi `.env` lokal. Di produksi nilainya tidak berubah (env dari environment).
- Sebelum app dibuat: `TRUNCATE` semua tabel (kecuali `_prisma_migrations`) `RESTART IDENTITY
  CASCADE`. App bootstrap lalu membuat admin + bootstrap API key dari env test.
- Fixture dibuat per suite: template `test.notification` (inapp + email), subscriber `user-test-1`,
  dan API key tenant `tenant-b` dengan `subscriberJwtSecret` sendiri (untuk uji isolasi).
- Polling status worker memakai helper `waitFor` dengan timeout 20 s (CI lebih lambat dari lokal).

---

## 4. Skenario e2e

Satu file spec (`test/app.e2e-spec.ts`), dijalankan `--runInBand`:

| # | Skenario | Ekspektasi |
|---|---|---|
| E1 | `GET /health/live`, `GET /health/ready` | `200`, ready memuat cek database + redis |
| E2 | `POST /notify` tanpa API key; dengan key salah | `401` keduanya |
| E3 | `POST /notify` valid (inapp) | `202`, baris `Notification` + `NotificationRecipient` dibuat, worker mengubah status menjadi `sent` |
| E4 | Kirim ulang `idempotency_key` yang sama | `202` dengan `notification_id` sama; tidak ada baris/recipient baru |
| E5 | `tenant_id` di body ≠ tenant API key | `400` |
| E6 | Admin: login benar / password salah / role `platform_admin` | `200` / `401` / `401` |
| E7 | Admin tenant A membaca subscriber tenant B | `404` (tidak ada kebocoran) |
| E8 | Subscriber lane: tanpa token; token tenant B ditandatangani `SUBSCRIBER_JWT_SECRET` (tenant B punya secret sendiri); token valid | `401` / `401` / `200` |
| E9 | Preference center: `GET` (3 channel, default), `PUT` email `enabled=false`, ingest email | `200` / `200`; recipient email berakhir `skipped` + `preference_disabled`; tenant A lain tidak berubah |
| E10 | Webhook: signature valid; signature salah; provider tak dikenal | `202` + baris `DeliveryEvent` + `deliveredAt` terisi / `401` / `404` |
| E11 | Admin resend failed-only: notification sumber dua channel, hanya baris inapp disimulasikan gagal | `202` notification baru dengan satu pasangan inapp (email tidak ikut), audit link/mode, replay request key tidak menduplikasi, tanpa `BillingEvent`; tanpa failed → `409` |

Di luar e2e (tetap diverifikasi manual, lihat §10): SSE stream, rate limit 429 (sudah diuji di
`verify:preferences`), dan UI console.

---

## 5. Docker

### 5.1 Backend (`Dockerfile`, target `runner` + `migrator`)

```
deps     node:24-bookworm-slim, npm ci (lockfile)
build    deps + prisma generate + npm run build + npm prune --omit=dev
migrator from build, CMD ["npx","prisma","migrate","deploy"]
runner   node:24-bookworm-slim + openssl, copy /app, USER node,
         HEALTHCHECK node -e fetch(/health/live), CMD ["node","dist/main"]
```

- Client Prisma digenerate **di dalam image Linux**, jadi engine yang ikut adalah engine container
  (bukan hasil generate Windows di mesin dev).
- Image runtime hanya berisi dependency produksi (`npm prune --omit=dev`), berjalan sebagai user
  `non-root`, dan tidak pernah menyalin `.env` (lihat `.dockerignore`).
- `migrator` adalah target terpisah supaya migrasi bisa dijalankan sebagai one-shot sebelum
  backend start, tanpa membawa Prisma CLI ke image runtime.

### 5.2 Console (`console/Dockerfile`)

- Build stage memakai konteks repo root karena console bergantung pada `@notifhub/js`
  (`file:../packages/js-sdk`): `npm ci` root → `npm run sdk:build` → `npm --prefix console ci`.
- Dua target image dari satu Dockerfile: `runner-tenant` (default, `dist/tenant`) dan
  `runner-platform` (`dist/platform`), keduanya `nginx:1.27-alpine` dengan SPA fallback
  `try_files`, gzip, dan cache aset. Build arg `VITE_NOTIFHUB_API_URL` dipakai kedua target;
  `VITE_PLATFORM_CONSOLE_URL` hanya untuk tenant.
- Config nginx berupa template (`console/nginx/tenant.conf.template`,
  `console/nginx/platform.conf.template`) yang diproses envsubst saat container start. Tenant image
  mewajibkan `PLATFORM_CONSOLE_URL` (entrypoint gagal cepat bila kosong) dan mengarahkan
  `/platform/*` ke origin platform; platform image mengarahkan `/` ke `/platform/tenants`.

### 5.3 Compose smoke stack (`docker-compose.prod.yml`)

`postgres` (healthcheck `pg_isready`) → `redis` (healthcheck `redis-cli ping`) → `migrate`
(`service_completed_successfully`) → `backend` → `console` (port 8080) dan `platform-console`
(port 8081). Semua kredensial dari `.env.prod` (`--env-file .env.prod`), contoh tersedia di
`.env.prod.example` tanpa secret nyata. Isi `PLATFORM_CONSOLE_URL` dan daftarkan kedua origin di
`CORS_ORIGINS`. Untuk deployment satu tenant tanpa console platform, lihat
[panduan deployment single tenant](single-tenant-deployment.md).

---

## 6. CI (`github/workflows/ci.yml`)

| Job | Isi |
|---|---|
| `backend` | services `postgres:16` (DB `notifhub_test`) + `redis:7`; Node 24 + cache npm; `npm ci`; `npm run ci`; lalu start `node dist/main`, tunggu health, `npm run openapi:export`, `git diff --exit-code openapi/notifhub.json` |
| `packages` | `npm ci`; `sdk:build` + `sdk:typecheck` + `sdk:test`; `react:typecheck` + `react:test` + `react:build`; `npm --prefix console ci` + `console:typecheck` + `console:build` + `console:test`; langkah terpisah memastikan `console/dist/tenant/index.html` dan `console/dist/platform/index.html` ada, lalu menolak artifact tenant yang memuat string `NotifHub Platform` dan artifact platform yang memuat kunci `notifhub.console.session` |
| `go` | `setup-go 1.23`; `gofmt -l` harus kosong; `go vet ./...`; `go test ./...` |
| `docker` | build tiga image tanpa push: backend (`runner`), console tenant (`runner-tenant`, tag `notifhub-console:ci`), console platform (`runner-platform`, tag `notifhub-console-platform:ci`); cache buildx dipisah per scope |

Trigger: `push` dan `pull_request`.

**Padanan lokal:** `npm run ci` menjalankan urutan job `backend` di mesin dev:

```
typecheck → build → test-db:setup → test:e2e → prisma migrate status
```

Ini yang diverifikasi sekarang, karena repo belum git sehingga workflow belum bisa dieksekusi.
YAML workflow tetap divalidasi secara struktural (parse + daftar job) saat verifikasi.

---

## 7. Keputusan bernomor

| # | Keputusan | Default |
|---|---|---|
| D1 | Scope: test otomatis + image + CI + housekeeping; tanpa fitur produk dan tanpa perubahan schema | Ya |
| D2 | Bootstrap tunggal `createApp()` dipakai `main.ts` dan test (menghindari duplikasi setup) | Ya |
| D3 | Jest + ts-jest + supertest; **tanpa** `@nestjs/testing` | Ya |
| D4 | Database test terpisah `notifhub_test` + Redis DB 15; dibuat oleh `scripts/test-db-setup.mjs`; data dev tidak disentuh | Ya |
| D5 | `ignoreEnvFile` saat `NODE_ENV=test`; env test eksplisit di `test/env.ts`, tanpa `.env` repo | Ya |
| D6 | Cakupan e2e = E1–E11; SSE dan rate limit tetap di `verify:preferences` (manual/smoke) | Ya |
| D7 | Image backend multi-stage Node 24, non-root, hanya dependency produksi, HEALTHCHECK `/health/live`, target `migrator` terpisah | Ya |
| D8 | Image console = Vite build + nginx alpine, SPA fallback, API URL lewat build arg | Ya |
| D9 | `docker-compose.prod.yml` sebagai smoke stack (bukan deployment produksi); kredensial dari `.env.prod` | Ya |
| D10 | CI 4 job (backend/packages/go/docker) + penjaga drift OpenAPI di job backend; tanpa push registry | Ya |
| D11 | `npm run ci` = padanan lokal job backend, satu sumber urutan perintah | Ya |
| D12 | Tidak ada dependency runtime baru; dependency dev baru hanya untuk test | Ya |
| D13 | Versi root `0.10.0`; perbaiki deskripsi Swagger yang masih menyebut fase; perbarui README/local-setup/project-brief | Ya |

> Catatan 2026-11-16: fitur console re-send failed menambah migrasi
> `20261116130000_resend_audit` (`Notification.resendOfNotificationId`/`resendMode`) dan E11.
> Ini berada di luar scope awal production-readiness yang semula menyatakan tanpa perubahan schema.

Bila ada nomor yang ingin diubah, sebutkan nomornya.

---

## 8. Daftar file

### 8.1 Baru

| File | Isi |
|---|---|
| `src/bootstrap.ts` | `createApp()` |
| `test/tsconfig.json` | tsconfig test (CommonJS + `types: ["node","jest"]`) |
| `test/jest-e2e.json` | konfigurasi Jest e2e (ts-jest, setupFiles, `maxWorkers: 1`) |
| `test/env.ts` | env test deterministik |
| `test/setup/database.ts` | `resetDatabase()`, `waitFor()`, fixture helper |
| `test/app.e2e-spec.ts` | E1–E11 |
| `scripts/test-db-setup.mjs` | buat DB test, `migrate deploy`, flush Redis |
| `scripts/ci.mjs` | urutan CI backend lokal |
| `Dockerfile` | backend multi-stage (+ `migrator`) |
| `console/Dockerfile`, `console/nginx.conf` | image console |
| `.dockerignore` | kecualikan `node_modules`, `dist`, `.env*`, test, docs |
| `docker-compose.prod.yml` | smoke stack |
| `.env.prod.example` | contoh env produksi tanpa secret |
| `.github/workflows/ci.yml` | pipeline |
| `docs/operations/production-readiness.md` | dokumen ini |

### 8.2 Diubah

| File | Perubahan |
|---|---|
| `src/main.ts` | memakai `createApp()` |
| `src/app.module.ts` | `ignoreEnvFile` saat test |
| `src/ingest/ingest.controller.ts` | hapus istilah fase dari deskripsi Swagger |
| `package.json`, `package-lock.json` | devDependency test, script `test:e2e`, `test:db:setup`, `ci`; versi `0.10.0` |
| `README.md`, `docs/getting-started/local-setup.md`, `docs/architecture/project-brief.md` | perintah test/CI/Docker, batasan repo non-git, versi |

Tidak ada perubahan pada schema, endpoint, atau perilaku runtime.

---

## 9. Rencana verifikasi

### 9.1 Test otomatis (bukti utama)

```bash
npm run ci        # typecheck + build + test-db:setup + test:e2e + migrate status
npm run test:e2e  # hanya e2e (DB test dibuat otomatis)
```

Bukti yang akan dilaporkan: jumlah test lulus/gagal, durasi, dan status `migrate status` untuk
database test. Regresi: `sdk:test`, `react:test`, `console:build`, `sdk:go:test`, dan
`verify:preferences` terhadap dev tetap hijau.

### 9.2 Docker (end-to-end image)

```bash
cp .env.prod.example .env.prod        # isi nilai dev
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Diperiksa: semua container `healthy`/`exited(0)` untuk `migrate`; `GET /health/ready` → `200`;
login admin → `200`; `POST /notify` → `202`; console `http://localhost:8080` → `200` HTML;
`docker image ls` mencatat ukuran kedua image; `docker compose ... down -v` setelah selesai.

### 9.3 CI

- YAML diparse (js-yaml yang sudah tersedia) dan daftar job/`run` step dicetak sebagai bukti.
- Seluruh perintah yang dipakai job `backend` dijalankan lokal lewat `npm run ci`.
- Job `packages`/`go` dijalankan lokal dengan perintah yang sama seperti di workflow.
- Catatan jujur: workflow **belum pernah dieksekusi oleh GitHub Actions** karena repo belum git;
  ini dicatat sebagai batasan sampai repo dipush.

### 9.4 Housekeeping

- `npx tsc --noEmit` bersih; build backend/console/SDK hijau.
- `openapi:export` diregenerasi setelah perbaikan deskripsi header (hanya teks, 3 path/9 schema);
  export berikutnya identik sehingga penjaga drift CI bersih.
- Grep memastikan tidak ada istilah fase di dokumentasi API/Swagger dan di dokumen.

---

## 10. Risiko dan batasan

1. **Jest + ts-jest menambah waktu & dependency dev.** Diterima karena satu-satunya cara andal
   menguji DI Nest dengan `emitDecoratorMetadata`.
2. **E2E butuh Postgres + Redis hidup.** Secara lokal berarti Docker Desktop menyala; di CI
   disediakan lewat service container. Bila infra mati, `test-db:setup` gagal dengan pesan jelas.
3. **Worker bersifat asinkron**, sehingga beberapa assertion memakai polling (timeout 20 s). Test
   tidak menguji throughput atau urutan job.
4. **SSE tidak diuji di Jest** (koneksi long-lived + timing); tetap menjadi verifikasi manual.
5. **Repo belum git**, jadi CI baru aktif setelah `git init` + push ke GitHub. `.github/workflows`
   tidak bisa dijalankan dari sesi ini.
6. **Image default Node 24** harus cocok dengan Prisma `binaryTargets`; generate dilakukan di dalam
   image agar engine sesuai. Bila deploy ke arsitektur lain (arm64), image perlu dibangun
   multi-arch (di luar scope).
7. **Compose stack bukan deployment produksi** (tanpa TLS, tanpa secret manager); hanya untuk
   membuktikan image berjalan bersama.
8. **Bootstrap admin/API key** dibuat dari env saat startup; di compose, `migrate` harus selesai
   lebih dulu (diatur `depends_on`).
9. **Rate limit admin login 5/menit** bisa membuat test gagal bila login dipanggil berulang; e2e
   hanya login sekali di `beforeAll`.

---

## 11. Catatan implementasi

1. **`app.init()` wajib di e2e.** `NestFactory.create()` hanya membangun container; route dan
   lifecycle hook (`onApplicationBootstrap` yang membuat admin + bootstrap API key) baru berjalan
   di `app.init()`. Tanpa itu semua request e2e mengembalikan `404`. Ditambahkan satu baris di
   `beforeAll`, bukan mengubah bootstrap.
2. **Windows: `npx.cmd` tidak bisa di-`spawn` langsung** (`EINVAL`). `scripts/test-db-setup.mjs`
   menjalankan Prisma CLI lewat `process.execPath` + path hasil `require.resolve('prisma/build/index.js')`,
   sehingga bekerja di Windows dan Linux tanpa shell.
3. **Kredensial test mengikuti infra dev**: default `notifhub:notifhub_pass@localhost:5432/notifhub_test`
   (sesuai `docker-compose.dev.yml`) dan Redis DB 15. Ada pengaman: nama database wajib berakhiran
   `_test` kecuali `ALLOW_NON_TEST_DB=1`.
4. **Jest e2e 10/10 lulus dalam ~20 detik** (lokal). `maxWorkers: 1` dan `forceExit` dipakai karena
   worker BullMQ + koneksi Redis tetap terbuka setelah suite; `app.close()` dipanggil di `afterAll`.
5. **Docker: OpenSSL harus ada di build stage.** Tanpa itu `prisma generate` memilih engine
   `openssl-1.1.x` padahal runtime Debian 12 memakai OpenSSL 3.x. Base stage sekarang memasang
   `openssl`, sehingga engine yang digenerate cocok dengan runtime.
6. **Stage `prod-deps` terpisah dari `migrator`**: `npm prune --omit=dev` menghapus Prisma CLI, jadi
   `migrator` harus berasal dari `build` (belum di-prune), sedangkan `runner` dari `prod-deps`.
7. **Konteks build console adalah root repo** karena `console` bergantung pada `@notifhub/js`
   (`file:../packages/js-sdk`); image console membangun SDK lebih dulu, baru console.
8. **Ukuran image**: backend `593 MB`, console `49.3 MB`, migrator `887 MB` (migrator membawa dev
   dependency + Prisma CLI dan hanya dipakai sekali jalan). Backend belum dioptimasi lebih jauh
   (mis. distroless atau pemisahan bcrypt/engine) karena di luar scope.
9. **CI belum dieksekusi GitHub Actions** karena repo ini belum berupa git repository. Validasi yang
   dilakukan: YAML diparse dengan `js-yaml` (4 job: `backend`, `packages`, `go`, `docker`), dan
   seluruh perintah job `backend` dijalankan lokal lewat `npm run ci`.
10. **`ignoreEnvFile` saat `NODE_ENV=test`** ditambahkan di `AppModule` agar suite tidak membaca
    `.env` developer; satu-satunya perubahan pada konfigurasi aplikasi, dan tidak berpengaruh pada
    runtime produksi (env tetap dari environment).
11. **Housekeeping**: deskripsi Swagger `POST /notify` tidak lagi menyebut fase, dan komentar kode
    yang masih menyebut fase (`readiness.service`, `admin-jwt.guard`, `admin-bootstrap.service`)
    sudah dinetralkan. Tidak ada perubahan perilaku.
12. **Temuan audit dependensi**: `npm audit --omit=dev` mencatat 6 kerentanan (3 high) pada
    dependensi transitif `prisma`/`@prisma/config` (`deepmerge-ts`) dan `@nestjs-modules/mailer`
    (`glob`/`minimatch`). Ini bukan berasal dari dependency test (dev-only) dan perbaikannya
    menunggu upgrade dependensi tersebut; dicatat sebagai batasan, bukan diabaikan.
13. **Versi root `0.10.0`**; `npm run verify:preferences` tetap dipertahankan sebagai smoke test
    HTTP + DB terhadap backend dev, melengkapi e2e yang memakai database terpisah.
14. **Spec publik diregenerasi.** Perbaikan deskripsi header `X-API-Key` (menghapus istilah fase)
    mengubah `openapi/notifhub.json`, jadi spec di-commit ulang. Perubahan hanya pada teks
    deskripsi; jumlah path/schema tetap 3/9 dan kontrak SDK tidak berubah. Tanpa regenerasi ini,
    penjaga drift di CI akan gagal pada run pertama.
15. **P3 host split console (2026-11-20).** Job `packages` kini memeriksa dua artifact console
    (`dist/tenant/index.html`, `dist/platform/index.html`) dan menolak kebocoran bundel (string
    `NotifHub Platform` di artifact tenant, kunci `notifhub.console.session` di artifact platform).
    Job `docker` membangun kedua target console dengan tag terpisah dan cache per scope. Detail
    verifikasi ada di `docs/design/platform-console-host-split.md` §18.3.
16. **P4 host split smoke stack (2026-11-20).** Smoke stack penuh diverifikasi: `migrate` exit `0`,
    backend `healthy`, tenant console `:8080` (redirect `/platform/*` ke `:8081`), platform console
    `:8081` (root `302` relatif ke `/platform/tenants`), login platform dari origin platform, CORS
    dua origin (origin asing tanpa `Access-Control-Allow-Origin`), audit create/delete tenant
    tercatat di DB, dan login tidak mengirim cookie session. Detail + tabel ada di
    `docs/design/platform-console-host-split.md` §18.4. Rollout domain produksi (DNS/TLS/ingress)
    tetap langkah operator.
17. **Console hardening P1 (2026-11-20).** Migrasi ke-12 (`AdminUser.tokenVersion`) mencabut token
    admin saat password berubah/reset; migrasi ke-13 (`bootstrapPasswordHash`) mencegah bootstrap
    env menimpa password yang diubah dari console. Endpoint `POST /admin/auth/change-password`,
    field `subscriberJwtSecret` di form API key, search notifikasi exact ID/recipient + page size,
    dan CSP pada image tenant/platform sudah berjalan. Verifikasi: 29 unit, 40 e2e (E38 password,
    E39 search, E40 bootstrap), CSP terpasang di kedua image, login ter-render di headless Edge di
    bawah CSP. Detail: `docs/design/console-admin-hardening.md` §16.
18. **Console P2a (2026-11-20).** Export notifikasi (JSON maks 5.000 baris, CSV dibuat di console)
    dan resend `all` non-`sms` sudah berjalan tanpa perubahan schema. E41/E42 menambah cakupan e2e
    menjadi 42 test. Detail: `docs/design/console-operations-p2.md` §13.
19. **Console P2b (2026-11-20).** Migrasi ke-14 menambah `AdminAuditEvent`; hook audit mencatat
    password/API key/template/preference/topic/resend, dengan `GET /admin/audit` dan halaman
    `/audit`. E43 menambah cakupan e2e menjadi 43 test. Audit belum punya retensi otomatis. Detail:
    `docs/design/console-operations-p2.md` §14.
20. **Console P2c (2026-11-20).** `POST /admin/notifications` compose/send memakai `IngestService`
    (tenant dari JWT, `requestKey` sebagai idempotency key), throttle 30/menit, audit
    `admin.notification.composed`, dan halaman `/notifications/new`. E44 menambah cakupan e2e
    menjadi 44 test. Detail: `docs/design/console-operations-p2.md` §15.
21. **Console P3a (2026-11-20).** Vitest + jsdom + Testing Library (dev-only) menambah 18 test
    console; CI job `packages` menjalankan `npm --prefix console run test`. Test mencakup CSV
    export, session storage, format helper, dan dialog resend. Detail:
    `docs/design/console-quality-p3.md` §11.
