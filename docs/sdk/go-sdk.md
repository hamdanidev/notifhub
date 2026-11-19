# Desain Go SDK

Status: **terimplementasi dan terverifikasi**.
Basis: PART 1 (aturan SDK-first/OpenAPI rule 29, Go SDK).

**Isi dokumen**

- [1. Ruang lingkup](#1-ruang-lingkup)
- [2. Cakupan API publik](#2-cakupan-api-publik)
- [3. Pipeline generasi](#3-pipeline-generasi)
- [4. Struktur Go module](#4-struktur-go-module)
- [5. Surface wrapper](#5-surface-wrapper)
- [6. Error, retry, dan perilaku](#6-error-retry-dan-perilaku)
- [7. Test dan verifikasi](#7-test-dan-verifikasi)
- [8. Keputusan desain](#8-keputusan-desain)
- [9. Catatan implementasi](#9-catatan-implementasi)
- [10. Rilis dan distribusi](#10-rilis-dan-distribusi)

---

## 1. Ruang lingkup

### Termasuk

1. **OpenAPI publik** yang menjadi sumber kontrak SDK: `openapi/notifhub.json`, diekspor dari
   backend (`GET /api/docs-json`) dan difilter ke endpoint consumer saja.
2. **Generator** `scripts/export-openapi.mjs` (ambil docs → filter path + schema transitif →
   tulis spec) agar spec tidak drift dari backend.
3. **Go client digenerate** dengan `oapi-codegen` v2 (types + HTTP client), bukan ditulis tangan.
4. **Wrapper ergonomis** di atas kode generated:
   - konstruktor dengan API key + opsi HTTP client/user-agent/retry,
   - method per use case (notify, subscriber, topic membership),
   - error type terstruktur + helper,
   - retry aman untuk GET dan notify ber-idempotency-key.
5. **Test Go** (`go test ./...`) dengan `httptest`, plus contoh program dan README.
6. Verifikasi end-to-end terhadap backend berjalan.

### Tidak termasuk

- Admin API (`docs/design/admin-api.md`), webhook receiver (`docs/design/webhooks.md`), in-app
  SSE/subscriber JWT (`docs/design/in-app.md`) — Go SDK ini untuk service consumer.
- SDK bahasa lain (Python/PHP/Java) — di luar cakupan dokumen ini.
- End-user preference center (`docs/design/preference-center.md`) dan platform admin UI
  (`docs/design/react-and-console.md`).
- CI/pipeline publikasi registry (belum ada registry Go; modul dipakai via `replace`/git).
- Perubahan schema backend.

---

## 2. Cakupan API publik

Hanya endpoint yang memang dipakai service consumer:

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| `POST` | `/api/v1/notify` | `X-API-Key` | Kirim notifikasi (recipients/topics) |
| `PUT` | `/api/v1/subscribers/{externalId}` | `X-API-Key` | Upsert subscriber |
| `GET` | `/api/v1/subscribers/{externalId}` | `X-API-Key` | Ambil subscriber |
| `PUT` | `/api/v1/topics/{key}/members` | `X-API-Key` | Replace membership |
| `POST` | `/api/v1/topics/{key}/members` | `X-API-Key` | Add/update membership |
| `GET` | `/api/v1/topics/{key}/members` | `X-API-Key` | List membership |

Endpoint admin, webhook, health, metrics, in-app tidak masuk spec SDK (walau tetap ada di
backend). Auth memakai header `X-API-Key`; subscriber JWT tidak dipakai di SDK server-side.

---

## 3. Pipeline generasi

```
npm run start:dev                         # backend + /api/docs-json
node scripts/export-openapi.mjs           # -> openapi/notifhub.json (public subset)
cd sdk/go && go generate ./...            # oapi-codegen -> client.gen.go
```

`export-openapi.mjs`:

1. `GET {NOTIFHUB_API_URL:-http://localhost:3000}/api/docs-json`.
2. Pertahankan hanya path di tabel §2 (operasi + metadata).
3. Kumpulkan `$ref` secara rekursif dari operasi yang dipertahankan, salin hanya komponen
   schema/parameter/securityScheme yang terpakai.
4. Tulis JSON rapi (2 spasi) ke `openapi/notifhub.json`; gagal dengan pesan jelas jika backend
   tidak berjalan.

Catatan: spec hasil filter **disimpan di repo** supaya build SDK tidak bergantung backend.
Regenerasi dilakukan saat kontrak API berubah. Verifikasi bahwa spec masih memuat security
scheme `api-key`.

---

## 4. Struktur Go module

```
sdk/go/
  go.mod                     module github.com/notifhub/notifhub-go (go 1.23)
  oapi-codegen.yaml          package notifhub, generate: types,client
  generate.go                //go:generate directive (versi generator dipin)
  client.gen.go              generated (jangan diedit manual)
  client.go                  wrapper: NewClient, method use case
  options.go                 WithHTTPClient, WithUserAgent, WithRetry
  errors.go                  APIError + helper
  client_test.go             httptest-based tests
  examples/send/main.go      contoh ingest + subscriber + topic
  README.md
```

Root `package.json`: tambah `openapi:export`, `sdk:go:generate`, `sdk:go:test`; versi root `0.8.0`.

---

## 5. Surface wrapper

```go
client, err := notifhub.NewClient("http://localhost:3000", os.Getenv("NOTIFHUB_API_KEY"))
// opsi: notifhub.WithHTTPClient(httpClient), WithUserAgent("order-service/1.2")

resp, err := client.Notify(ctx, notifhub.NotifyRequest{
    IdempotencyKey: "order-123-confirmed",
    TemplateKey:    "order.confirmed",
    Recipients:     []notifhub.Recipient{{Id: "user-1"}},
    Channels:       []string{"inapp", "email"},
    Data:           map[string]any{"order_id": "123"},
})

sub, err := client.UpsertSubscriber(ctx, "user-1", notifhub.SubscriberInput{
    Email: "user@example.com", Locale: "id",
})

members, err := client.ReplaceTopicMembers(ctx, "shift:gudang", notifhub.TopicMembersInput{...})
```

- Tipe request/response memakai tipe generated (`NotifyDto`, dst) dengan alias yang lebih enak
  dibaca (`type NotifyRequest = NotifyDto`), tanpa menduplikasi model.
- Semua method menerima `context.Context` dan mengembalikan `(*T, error)`.
- Path parameter di-encode (`url.PathEscape`) sehingga key topic seperti `shift:gudang` aman.
- Header `X-API-Key` disuntik oleh `RequestEditorFn` generated; API key tidak pernah ditulis ke log.

---

## 6. Error, retry, dan perilaku

### 6.1 Error

```go
var apiErr *notifhub.APIError
if errors.As(err, &apiErr) {
    switch apiErr.StatusCode {
    case 401: // API key salah
    case 422, 400: // validasi
    }
}
```

- `APIError{StatusCode int; Message string; Body []byte}`.
- Helper `IsNotFound(err)`, `IsUnauthorized(err)`, `IsRateLimited(err)`, `IsValidation(err)`.
- Body error backend (`{statusCode,message,error}`) diparse bila JSON; jika tidak, simpan raw body.

### 6.2 Retry

- Default: **tanpa retry** (eksplisit), bisa diaktifkan `WithRetry(policy)`.
- Kebijakan: retry pada `429` dan `5xx` dengan exponential backoff + jitter; hanya untuk operasi
  idempoten (`GET`, `PUT`, `POST topics`) dan `POST /notify` **bila** `IdempotencyKey` diisi.
- `Retry-After` dihormati bila ada.
- Tidak retry pada `4xx` lain.

### 6.3 Timeout

- Default HTTP client timeout 30 detik; dapat diganti lewat `WithHTTPClient`.

---

## 7. Test dan verifikasi

### 7.1 Unit (`go test ./...`)

- `Notify` mengirim `X-API-Key`, `Content-Type`, body benar, dan men-decode `202`.
- `UpsertSubscriber`/`GetTopicMembers` meng-encode path (`user/1`, `shift:gudang`).
- Error `401`, `400`, `429` → `APIError` dengan status/message benar.
- Retry: server mengembalikan 500 lalu 202 → dua request; tanpa idempotency key untuk notify →
  tidak retry.
- Konstruktor menolak base URL/API key kosong.

### 7.2 End-to-end (backend berjalan)

- `examples/send` dijalankan dengan API key dev → `202`, notification id tercatat.
- Upsert subscriber + replace topic members → `200`, lalu ingest dengan `topics` → `202`.
- API key salah → `401`.
- Cek DB: notifikasi `sent`/`pending` sesuai worker.

### 7.3 Kualitas

- `go vet ./...`, `gofmt -l` bersih, `go build ./...`.
- Spec dapat digenerate ulang tanpa error (`export-openapi` + `go generate`).
- Typecheck/build backend, SDK JS, React, console tetap hijau (tidak disentuh).

---

## 8. Keputusan desain

| # | Keputusan | Usulan default |
|---|---|---|
| D1 | Cakupan Go SDK hanya endpoint consumer publik (notify, subscriber, topic membership) | Ya |
| D2 | Generator: `oapi-codegen` v2 (Go-native, tanpa Java), versi dipin di `generate.go` | Ya |
| D3 | Spec publik diekspor dari `/api/docs-json`, difilter, lalu **di-commit** di `openapi/notifhub.json` | Ya |
| D4 | Module path `github.com/hamdanidev/notifhub-go`, dipublikasikan dari repo mirror `notifhub-go` | Ya |
| D5 | Wrapper memakai tipe generated + alias, tanpa menduplikasi model | Ya |
| D6 | Retry default mati; opt-in, hanya operasi idempoten dan notify ber-idempotency-key | Ya |
| D7 | Auth hanya `X-API-Key`; subscriber JWT/admin tidak masuk SDK | Ya |
| D8 | Tanpa perubahan backend/schema; versi root mengikuti rilis service (`0.10.0`) | Ya |
| D9 | Distribusi lewat repo mirror `hamdanidev/notifhub-go` + tag `vX.Y.Z`; bukan registry npm | Ya |
| D10 | Test unit + integrasi lokal; contoh program di `examples/send` | Ya |

---

## 9. Catatan implementasi

1. **Module path** diubah sesuai permintaan menjadi `github.com/hamdanidev/notifhub-go` (D4).
2. **Generator dipin ke `oapi-codegen` v2.4.1**, bukan v2.8.x: v2.8 membutuhkan Go >= 1.25,
   sedangkan proyek memakai Go 1.23. Runtime dipin `github.com/oapi-codegen/runtime v1.1.1`.
3. **Nama wrapper**: kode generated sudah memakai `Client`, `NewClient`, dan
   `WithHTTPClient`, sehingga wrapper memakai `SDK`, `New`, dan `WithHTTPDoer` agar tidak
   bertabrakan.
4. **Recipients union**: Nest Swagger mengekspor `recipients` sebagai `array of array`
   (`[][]interface{}`), bukan string-or-object. Wrapper membangun payload notify secara
   eksplisit (termasuk inline override) dan memakai generated client untuk path/header/HTTP,
   sehingga tipe generated yang cacat tidak bocor ke pengguna.
5. **Spec publik**: `openapi/notifhub.json` berisi 3 path dan 9 schema; diekspor oleh
   `scripts/export-openapi.mjs` dengan resolusi `$ref` transitif dan security scheme `api-key`.
6. **Verifikasi:** `go vet`, `gofmt`, `go build`, dan `go test` lulus (7 test). Contoh
   `examples/send` berhasil: subscriber upsert, topic `go:example` (1 member), notify diterima
   (`202`) dan recipient berstatus `sent`; API key salah menghasilkan `APIError` 401.
7. **Tanpa perubahan backend/schema**; versi root mengikuti rilis service.

---

## 10. Rilis dan distribusi

`notifhub-go` adalah **repo mirror**: sumber kebenaran tetap `sdk/go` di repo utama, dan setiap
rilis menyalin snapshot-nya ke root repo mirror. Alasannya: `go.mod` mendeklarasikan
`github.com/hamdanidev/notifhub-go`, sehingga Go memetakan module ke **root repo** bernama
`notifhub-go`; tag `vX.Y.Z` hanya berlaku jika `go.mod` berada di root repo tersebut.

### Langkah rilis

```bash
# 0. Prasyarat: CI hijau dan tidak ada drift
npm run ci
npm run openapi:export            # backend harus berjalan
npm run sdk:go:generate
npm run sdk:go:test

# 1. Commit + tag di repo utama (menandai rilis service)
git tag -a v0.10.0 -m "release: v0.10.0"
git push origin main --tags

# 2. Snapshot ke repo mirror
git clone https://github.com/hamdanidev/notifhub-go ../notifhub-go
robocopy sdk\go ..\notifhub-go /MIR /XD .git   # PowerShell: pakai robocopy atau Copy-Item
cd ../notifhub-go
git add -A
git commit -m "release: v0.10.0 (from hamdanidev/notifhub@<sha>)"
git tag v0.10.0
git push origin main --tags
```

### Aturan

- **Jangan pernah mengedit repo mirror.** Semua perubahan masuk ke `sdk/go` di repo utama, lalu
  dirilis ulang lewat snapshot. Ini mencegah dua sumber kebenaran.
- Tag di mirror adalah `vX.Y.Z` (root module), bukan `sdk/go/vX.Y.Z`.
- Nomor versi SDK mengikuti versi service pada saat snapshot.
- `generate.go` dan bagian "Regenerating the client" pada README memakai path monorepo; regenerasi
  dilakukan di repo utama, bukan di mirror. Snapshot boleh memuat file itu apa adanya.
- Go proxy publik (`proxy.golang.org`) butuh waktu untuk mengindeks tag baru. Untuk verifikasi
  langsung, pakai `GOPROXY=direct`:

  ```bash
  mkdir /tmp/sdk-check && cd /tmp/sdk-check
  go mod init example.com/sdk-check
  GOPROXY=direct go get github.com/hamdanidev/notifhub-go@v0.10.0
  ```

- Belum ada automated publish; langkah snapshot masih manual sampai ada kebutuhan otomatisasi
  (mis. workflow lintas repo).
