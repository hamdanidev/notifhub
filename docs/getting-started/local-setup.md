# Local setup (development)

The NotifHub backend runs **natively on the host** with `npm run start:dev`.
Only PostgreSQL and Redis run in Docker, from `docker-compose.dev.yml`.

Related: [configuration](configuration.md) for every environment variable, and
[troubleshooting](troubleshooting.md) for common failures.

**Contents**

- [Prerequisites](#prerequisites)
- [Steps](#steps)
- [Run the automated tests (e2e)](#run-the-automated-tests-e2e)
- [Verify](#verify)
- [Verify in-app notifications (SSE)](#verify-in-app-notifications-sse)
- [Verify email and subscriber push-sync](#verify-email-and-subscriber-push-sync)
- [Verify the preference center (end-user preferences)](#verify-the-preference-center-end-user-preferences)
- [Verify webhooks, status rollup, and cleanup](#verify-webhooks-status-rollup-and-cleanup)
- [Verify the admin API, API keys, and topics](#verify-the-admin-api-api-keys-and-topics)
- [Verify the React bindings and the console](#verify-the-react-bindings-and-the-console)
- [Verify WhatsApp](#verify-whatsapp)
- [Verify the platform lane](#verify-the-platform-lane)
- [Verify the Go SDK](#verify-the-go-sdk)
- [Run the Docker smoke stack](#run-the-docker-smoke-stack)
- [Notes](#notes)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- Node.js 20+ (the containers and CI use Node 24)
- Docker + Docker Compose

The verification commands below use a POSIX shell (`curl`, `export`, `$(...)`, `/tmp`). On Windows,
run them from Git Bash or WSL, or translate them to PowerShell.

## Steps

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the development infrastructure (ONLY `notifhub-postgres` and `notifhub-redis`):

   ```bash
   npm run infra:up
   ```

3. Wait for the healthchecks to report `healthy`:

   ```bash
   docker compose -f docker-compose.dev.yml ps
   ```

   Both containers must show `(healthy)` before the next step. The backend is not started yet.

4. Create the local environment file:

   ```bash
   cp .env.example .env
   ```

5. Generate the admin password hash and paste it into `.env` as `ADMIN_PASSWORD_HASH`,
   keeping the single quotes around the value (they stop Docker Compose from interpreting
   the `$` characters of the bcrypt hash):

   ```bash
   npm run admin:hash-password "YourStrongPassword"
   ```

   ```dotenv
   ADMIN_PASSWORD_HASH='$2b$10$....'
   ```

6. Apply the database schema and seed baseline rows:

   ```bash
   npx prisma migrate deploy
   npx prisma db seed
   ```

7. Start the backend natively (not containerized):

   ```bash
   npm run start:dev
   ```

## Run the automated tests (e2e)

The suite boots the real application (`createApp()`) against an isolated database and an isolated
Redis logical database, so it never touches development data.

```bash
npm run infra:up        # Postgres + Redis must be running
npm run test:unit       # Jest unit tests (builder contract, plain-text, sanitizer, email provider)
npm run test:e2e        # creates/migrates notifhub_test, flushes Redis db 15, then runs Jest
npm run ci              # typecheck + build + unit + e2e + migrate status (same order as CI)
```

- Defaults: `postgresql://notifhub:notifhub_pass@localhost:5432/notifhub_test` and
  `redis://localhost:6379/15`; override with `TEST_DATABASE_URL` / `TEST_REDIS_URL`.
- The database name must end with `_test` (safety guard; override with `ALLOW_NON_TEST_DB=1`).
- Test configuration lives in `test/env.ts`; the suite does not read `.env`.
- Coverage (E1–E11): health, ingest auth, in-app delivery through the worker, idempotency,
  tenant mismatch, admin login/roles, admin tenant isolation, subscriber secrets per tenant,
  preference center + enforcement, signed webhooks, and admin resend failed (new notification,
  audit link, idempotency, no new billing event).

## Verify

- `GET /health/live` → `200` `{ "status": "ok", "service": "notifhub", "uptime": <seconds> }`
- `GET /health/ready` → `200` with database and redis checks
- `GET /api/docs` → Swagger UI
- `GET /api/docs-json` → OpenAPI JSON (source of truth for SDK generation)
- `GET /metrics` with header `X-API-Key: <SERVICE_API_KEY>` → Prometheus text format
- `POST /api/v1/notify` with header `X-API-Key: <SERVICE_API_KEY>` → `202`
  `{ "notification_id": "<uuid>", "status": "accepted" }`

## Verify in-app notifications (SSE)

The in-app worker runs inside the backend process (no separate command). All in-app endpoints
use a subscriber JWT in the `Authorization` header; tokens in the query string are rejected.

```bash
# 1. Issue a development subscriber token (claims: sub, tenant, exp).
#    It is signed with the tenant's API key secret; SUBSCRIBER_JWT_SECRET is only a fallback.
npm run dev:subscriber-token -- user-test-1 > /tmp/sub.token

# 2. Trigger an in-app notification
curl -i -X POST http://localhost:3000/api/v1/notify \
  -H "X-API-Key: dev-api-key-change-in-prod" -H "Content-Type: application/json" \
  -d '{"idempotency_key":"inapp-1","template_key":"test.notification","recipients":["user-test-1"],"channels":["inapp"],"data":{"nama":"Budi"}}'

# 3. Catch-up page
curl -s -H "Authorization: Bearer $(cat /tmp/sub.token)" \
  "http://localhost:3000/api/v1/in-app/notifications?limit=20"

# 4. SSE stream (replays buffered events, then live; heartbeat every 15-30s)
curl -N -H "Authorization: Bearer $(cat /tmp/sub.token)" \
  -H "Accept: text/event-stream" http://localhost:3000/api/v1/in-app/stream

# 5. Mark as read (idempotent)
curl -i -X POST -H "Authorization: Bearer $(cat /tmp/sub.token)" \
  "http://localhost:3000/api/v1/in-app/notifications/<notification-id>/read"

# 6. Build the SDK
npm run sdk:build
```

Expected: the worker updates `notification_recipients.status` to `sent`, writes one
`delivery_attempts` row, appends to `notifhub:inapp:stream:default:user-test-1` in Redis and
publishes on `notifhub:inapp:events:default:user-test-1`. Reconnecting with
`Last-Event-ID: <stream-id>` replays only the missed events.

## Verify email and subscriber push-sync

Subscriber data is push-synced by the consumer and stored by NotifHub; it is never pulled
back from consumer systems.

```bash
# 1. Push a subscriber snapshot
curl -i -X PUT http://localhost:3000/api/v1/subscribers/user-test-1 \
  -H "X-API-Key: dev-api-key-change-in-prod" -H "Content-Type: application/json" \
  -d '{"email":"user-test-1@example.com","phone":"+628111222333","locale":"id","timezone":"Asia/Jakarta"}'

# 2. Read the stored snapshot
curl -s -H "X-API-Key: dev-api-key-change-in-prod" \
  http://localhost:3000/api/v1/subscribers/user-test-1

# 3. Trigger an email. In development this is LOG-ONLY: no SMTP connection is opened.
curl -i -X POST http://localhost:3000/api/v1/notify \
  -H "X-API-Key: dev-api-key-change-in-prod" -H "Content-Type: application/json" \
  -d '{"idempotency_key":"email-1","template_key":"test.notification","recipients":["user-test-1"],"channels":["email"],"data":{"nama":"Budi"}}'

# 4. Inspect the delivery result (providerMessageId is dev-log-only in development)
docker exec notifhub-postgres psql -U notifhub -d notifhub_dev -c \
  'SELECT "recipientId", channel, status, attempts, "providerName", "providerMessageId", "lastError" FROM "NotificationRecipient" ORDER BY "id" DESC LIMIT 3;'
```

### Real SMTP verification (staging and production) locally

`scripts/dev-smtp-sink.mjs` is a throwaway SMTP sink; it is not part of docker-compose.

```bash
# Terminal 1: SMTP sink on 127.0.0.1:2525
node scripts/dev-smtp-sink.mjs

# Terminal 2: staging instance (every message goes to CATCH_ALL_RECIPIENT)
NOTIFHUB_MODE=staging CATCH_ALL_RECIPIENT=ops@example.com \
SMTP_HOST=127.0.0.1 SMTP_PORT=2525 SMTP_FROM=noreply@notifhub.local \
NODE_ENV=production PORT=3001 SWAGGER_BASIC_AUTH_USER=docs SWAGGER_BASIC_AUTH_PASS=secret \
node dist/main

# Ingest against PORT=3001: the sink prints `to <ops@example.com>`.
# For production, drop CATCH_ALL_RECIPIENT and set NOTIFHUB_MODE=production; the sink then
# prints the real recipient address.
```

### Email behaviour notes

- Development never sends email: the provider logs `email.log_only` and stores
  `providerMessageId=dev-log-only`.
- Staging and production require `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`; startup fails fast
  when they are missing.
- Preferences: `enabled=false` marks the channel `skipped` (`preference_disabled`); quiet hours
  defer non-critical jobs until the window ends; a template `fallbackChannel` re-enqueues the
  notification on the fallback channel.
- Provider calls are wrapped in an opossum circuit breaker (10 s timeout, opens after repeated
  failures, probes again after 30 s); BullMQ still owns retries with exponential backoff.
- End-user preferences are served by the public preference API
  (`docs/design/preference-center.md`); tenant admins see the same rows in the console. Create rows
  directly in `NotificationPreference` only when you need a raw fixture.

## Verify the preference center (end-user preferences)

End users manage their own channel preferences through the subscriber lane:
`GET /api/v1/subscriber/preferences` and `PUT /api/v1/subscriber/preferences/:channel`.
The tenant and the recipient always come from the verified token, never from the body or path.

```bash
# 1. Mint a subscriber token (see "Verify in-app notifications" for details)
npm run dev:subscriber-token -- user-test-1 > /tmp/sub.token

# 2. Read the snapshot: always three channels, missing rows come back as defaults
curl -s -H "Authorization: Bearer $(cat /tmp/sub.token)" \
  http://localhost:3000/api/v1/subscriber/preferences

# 3. Disable email and set quiet hours for in-app
curl -i -X PUT -H "Authorization: Bearer $(cat /tmp/sub.token)" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":false}' \
  http://localhost:3000/api/v1/subscriber/preferences/email

curl -i -X PUT -H "Authorization: Bearer $(cat /tmp/sub.token)" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":true,"quietHoursStart":"22:00","quietHoursEnd":"07:00"}' \
  http://localhost:3000/api/v1/subscriber/preferences/inapp

# 4. Prove enforcement: the email worker skips a disabled channel
curl -i -X POST http://localhost:3000/api/v1/notify \
  -H 'X-API-Key: dev-api-key-change-in-prod' -H 'Content-Type: application/json' \
  -d '{"idempotency_key":"pref-email-1","template_key":"test.notification","recipients":["user-test-1"],"channels":["email"],"data":{"nama":"Budi"}}'
```

Expected: the recipient row for that notification ends as `skipped` with
`lastError=preference_disabled`.

```bash
docker exec notifhub-postgres psql -U notifhub -d notifhub_dev -c \
  'SELECT "tenantId", "recipientId", channel, enabled, "quietHoursStart", "quietHoursEnd", timezone
     FROM "NotificationPreference" ORDER BY "tenantId", "recipientId", channel;'
```

Notes:

- Preferences are tenant-scoped (`tenantId + recipientId + channel`): `recipientId` alone is not
  unique because it is the consumer's external id. Two tenants can both use `user-1`.
- `PUT` is a full snapshot for one channel: omitted quiet hours are cleared, and an omitted
  `timezone` inherits the subscriber timezone (falling back to `Asia/Jakarta`).
- `sms` returns `400`: the enum value exists but no provider or worker uses it.
- The endpoints are rate limited to 60 requests per minute per IP (`429` above that).
- A full end-to-end check (HTTP + DB, includes a second tenant and cleanup) is available:

  ```bash
  npm run verify:preferences
  ```

## Verify webhooks, status rollup, and cleanup

Provider callbacks must be signed with HMAC over `<timestamp>.<raw body>` using
`WEBHOOK_SIGNING_SECRET`; the timestamp tolerance is 5 minutes.

```bash
# Build a signed webhook for an existing recipient row
export WEBHOOK_SIGNING_SECRET=$(grep '^WEBHOOK_SIGNING_SECRET=' .env | cut -d= -f2-)
BODY='{"eventId":"evt_1","eventType":"delivered","notificationId":"<notification-id>","recipientId":"user-test-1","channel":"email"}'
TS=$(date +%s)
SIG=$(node -e 'const c=require("crypto");const [b,t,s]=process.argv.slice(1);process.stdout.write("t="+t+",v1="+c.createHmac("sha256",s).update(t+".").update(b).digest("hex"))' "$BODY" "$TS" "$WEBHOOK_SIGNING_SECRET")

curl -i -X POST http://localhost:3000/api/v1/webhooks/smtp \
  -H 'Content-Type: application/json' -H "X-NotifHub-Signature: $SIG" \
  --data-binary "$BODY"
```

Expected: `202 {"status":"accepted"}`, one new row in `delivery_events`, and
`notification_recipients.deliveredAt` filled (status stays `sent`; a `read` event sets `read`).
Missing, invalid or stale signatures return `401`; an unknown provider returns `404`; an event
for an unknown recipient is accepted and ignored.

```bash
docker exec notifhub-postgres psql -U notifhub -d notifhub_dev -c \
 'SELECT "eventType", "providerName", "occurredAt" FROM "DeliveryEvent" ORDER BY id DESC LIMIT 5;'
docker exec notifhub-postgres psql -U notifhub -d notifhub_dev -c \
 'SELECT "idempotencyKey", "overallStatus" FROM "Notification" ORDER BY "createdAt" DESC LIMIT 5;'
```

- `overallStatus` is rolled up every minute from recipient statuses
  (`pending` / `partial` / `sent` / `failed`).
- Retention job (UTC 02:00) soft deletes notifications older than `RETENTION_DAYS`.
- Template telemetry job (UTC 03:00) hard deletes `TemplateTestSend` older than
  `TEMPLATE_TEST_SEND_RETENTION_DAYS` (default 180) and `TemplateAuditEvent` older than
  `TEMPLATE_AUDIT_RETENTION_DAYS` (default 730). Set either value to `0` to disable that window.
- Idempotency job (UTC 02:30) rotates expired keys to `expired:<uuid>`, so the original key can
  be reused without deleting audit rows.

## Verify the admin API, API keys, and topics

On startup the bootstrap admin is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH`, and the
bootstrap API key is imported from `SERVICE_API_KEY` when the `ApiKey` table is empty.

```bash
# 1. Admin login (5 attempts per minute per IP)
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@notifhub.local","password":"<your password>"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).accessToken))")

curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/admin/auth/me

# 2. Create a tenant API key (raw key is returned exactly once)
curl -s -X POST http://localhost:3000/api/v1/admin/api-keys \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"local-service"}'

# 3. Push topic membership (the topic is created on first push)
curl -i -X PUT 'http://localhost:3000/api/v1/topics/shift:gudang/members' \
  -H 'X-API-Key: <raw-key>' -H 'Content-Type: application/json' \
  -d '{"members":[{"recipientId":"user-a"},{"recipientId":"user-b"}]}'

# 4. Trigger a notification to the topic
curl -i -X POST http://localhost:3000/api/v1/notify \
  -H 'X-API-Key: <raw-key>' -H 'Content-Type: application/json' \
  -d '{"idempotency_key":"topic-1","template_key":"test.notification","topics":["shift:gudang"],"channels":["inapp"],"data":{"nama":"Budi"}}'
```

Notes:

- Templates are tenant-scoped: a new tenant needs its own template rows (admin CRUD at
  `/api/v1/admin/templates`).
- Admin endpoints only see data for the `tenantId` inside the admin JWT; `platform_admin` is
  still rejected (tenant admin only).
- `POST /topics/:key/members` returns `200` (add/update), `PUT` replaces the whole membership.
- `tenant_id` in the ingest payload is deprecated; it must match the API key tenant when sent.
- API key auth only accepts keys from the `ApiKey` table; the bootstrap key is created from
  `SERVICE_API_KEY` when the table is empty.

## Verify the React bindings and the console

```bash
npm run sdk:build
npm run react:build
npm run console:install    # once, installs console dependencies
npm run console:dev        # http://localhost:5173
```

Login with the bootstrapped admin (`ADMIN_EMAIL` and the password whose bcrypt hash is stored in
`ADMIN_PASSWORD_HASH`). Pages:

- Dashboard: status counts and a 14-day chart (aggregated client-side from the Admin API).
- Notifications: filter by status/template/date; detail with recipients, attempts, and events.
- Templates: list/filter status/channel/locale; editor draft/publish dengan preview, variabel,
  layout/theme/partial, test send, riwayat/audit, serta editor body **Visual** (block builder) atau
  **HTML**. Aset dikelola di Templates → Aset template.
- Subscribers: list, detail, per-channel preference editor.
- Topics: list, detail, membership replace/add with optional expiry.
- API Keys: list, create (raw key shown once), revoke.

`@notifhub/react` is used by end-user applications; the usage example lives in
`packages/react/README.md`. The console gets its admin JWT from
`POST /api/v1/admin/auth/login`; the token is kept in `sessionStorage`, and a `401` clears the
session and redirects to `/login`.

Notes:

- `VITE_NOTIFHUB_API_URL` in `console/.env` defaults to `http://localhost:3000`.
- Admin template/asset payloads use `TEMPLATE_MAX_PAYLOAD_BYTES` (default 1 MB); ingest remains
  limited by `INGEST_MAX_PAYLOAD_BYTES` (default 64 KB). Lihat
  `docs/design/templates/template-system-design.md` untuk alur draft → preview → publish → test send.
- Upload gambar template disimpan di `TEMPLATE_IMAGE_DIR` (default `var/template-images`,
  di-ignore git). Maksimum `TEMPLATE_IMAGE_MAX_BYTES` (default 5 MB). Set
  `TEMPLATE_IMAGE_BASE_URL` di belakang reverse proxy agar URL gambar di email absolut dan
  stabil. Docker smoke stack memakai volume `notifhub_prod_uploads`.
- Production build: `npm run console:build` (output `console/dist`), preview with
  `npm --prefix console run preview`.
- Register the console origin in `CORS_ORIGINS` outside development.

## Verify WhatsApp

Development sends are log-only (`providerMessageId=dev-log-only`). For a local end-to-end run,
start the bundled Cloud API stub:

```bash
node scripts/dev-whatsapp-stub.mjs     # http://127.0.0.1:2526
```

Set these values in `.env` (or the process environment):

```bash
WHATSAPP_API_BASE_URL=http://127.0.0.1:2526
WHATSAPP_PHONE_NUMBER_ID=123456
WHATSAPP_ACCESS_TOKEN=test-access-token
WHATSAPP_APP_SECRET=test-app-secret
WHATSAPP_VERIFY_TOKEN=verify-token
WHATSAPP_CATCH_ALL_RECIPIENT=+628999999999   # staging only
```

- Callback URL: `POST /api/v1/webhooks/whatsapp/events` with
  `X-Hub-Signature-256: sha256=<HMAC of the raw body with WHATSAPP_APP_SECRET>`.
- Subscription verification:
  `GET /api/v1/webhooks/whatsapp/events?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`.
- `NOTIFHUB_MODE=staging` redirects to the catch-all number; `production` uses the real recipient.
- WhatsApp text messages are only valid inside Meta's 24-hour service window. Approved template
  messages are not implemented yet.

## Verify the platform lane

Platform admin accounts come from the environment (there is no default credential). Add both
variables to `.env`, then restart the backend:

```bash
npm run admin:hash-password "Platform123!"   # copy the hash

# .env
PLATFORM_ADMIN_EMAIL=platform@notifhub.local
PLATFORM_ADMIN_PASSWORD_HASH='$2b$10$...'
```

The email must differ from `ADMIN_EMAIL`; startup fails fast otherwise. When both variables are
empty, the backend still boots but logs `platform.admin.bootstrap.missing`.

```bash
# 1. Login (token has no tenant claim), 5 attempts per minute per IP
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/platform/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"platform@notifhub.local","password":"Platform123!"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).accessToken))")

# 2. List tenants
curl -s -H "Authorization: Bearer $TOKEN" 'http://localhost:3000/api/v1/platform/tenants?limit=20'

# 3. Create a tenant, then its first admin (id is immutable)
curl -i -X POST http://localhost:3000/api/v1/platform/tenants \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":"acme","name":"Acme Corp"}'

curl -i -X POST http://localhost:3000/api/v1/platform/tenants/acme/admins \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"acme-admin@example.com","password":"AcmeAdmin123!"}'

# 4. Suspend/resume (idempotent). While suspended, tenant requests get 403 tenant_suspended.
curl -i -X POST http://localhost:3000/api/v1/platform/tenants/acme/suspend \
  -H "Authorization: Bearer $TOKEN"
curl -i -X POST http://localhost:3000/api/v1/platform/tenants/acme/resume \
  -H "Authorization: Bearer $TOKEN"

# 5. Audit trail for that tenant
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:3000/api/v1/platform/audit?tenantId=acme'

# 6. Delete only works for an empty tenant (default tenant is protected)
curl -i -X DELETE http://localhost:3000/api/v1/platform/tenants/acme \
  -H "Authorization: Bearer $TOKEN"
```

Expected: login `200` with `admin.role = platform_admin` and no `tenantId`; create `201`;
suspend/resume `200` with `status` changing; audit lists `tenant.created`, `tenant.admin.created`,
`tenant.suspended`, `tenant.resumed`; delete of a tenant with data returns `409 tenant_not_empty`.

The console exposes the same flow at `/platform/login` (session stored separately from the tenant
admin session). Full guide: [usage/platform-admin.md](../usage/platform-admin.md).

## Verify the Go SDK

```bash
# regenerate the public OpenAPI subset (backend must be running)
npm run openapi:export

# regenerate the Go client from the committed spec
npm run sdk:go:generate

# test and build
npm run sdk:go:test
cd sdk/go && go vet ./... && go build ./...

# run the end-to-end example
NOTIFHUB_API_KEY=dev-api-key-change-in-prod go run ./examples/send
```

- Module: `github.com/hamdanidev/notifhub-go` (in `sdk/go`).
- Generated client: `sdk/go/client.gen.go` (do not edit); wrapper: `client.go`.
- Public OpenAPI subset: `openapi/notifhub.json` (notify, subscriber upsert/get, topic membership).
- Retries are opt-in (`notifhub.WithRetry`); `Notify` is retried only with an idempotency key.

## Run the Docker smoke stack

```bash
cp .env.prod.example .env.prod      # fill every CHANGE_ME
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
```

- Services: `postgres`, `redis`, one-shot `migrate`, `backend` (`:3000`), `console` (`:8080`).
- Expected: `migrate` exits with code 0, `backend` becomes `healthy`, `GET /health/ready` returns
  `200`, `POST /api/v1/notify` returns `202`, and the console serves the SPA.
- Tear down with `... down -v` (removes the volumes and all data).
- This stack is for verification, not production: no TLS and secrets live in `.env.prod`.
- Image targets: `docker build --target runner .` (backend), `docker build -f console/Dockerfile .`
  (console), `docker build --target migrator .` (one-shot migration job).

## Notes

- The NotifHub backend is NOT containerized in development.
- All three channels are implemented: in-app (worker + SSE + catch-up), email (SMTP), and
  WhatsApp (Meta Cloud API). In development, email and WhatsApp are log-only and never contact a
  real provider; the bundled stubs let you exercise both end to end.
- Every channel has a worker consuming its queue: `notification-inapp`, `notification-email`,
  `notification-whatsapp`.
- `@notifhub/js` ships the in-app client and the tenant admin client; `@notifhub/react` ships the
  provider, bell, inbox, and the `usePreferences` hook; `notifhub-console` is the tenant-admin UI
  (React 18 + Vite + Bootstrap 5).
- BullMQ rejects `:` inside queue names (it is the Redis key separator), so the logical
  channel queues are registered as `notification-inapp`, `notification-email` and
  `notification-whatsapp` under the `notifhub` key prefix.
- `SUBSCRIBER_JWT_SECRET` and `ADMIN_JWT_SECRET` must be at least 32 characters; the
  development placeholders in `.env.example` already satisfy this.

## Troubleshooting

- **Startup order**: infrastructure first, wait until both containers are `healthy`, then run
  migrations and start the backend. Starting the app against a cold database fails fast.
- **Port conflicts**: `5432`, `6379`, and `3000` must be free. Stop local PostgreSQL/Redis
  instances or change the published ports in `docker-compose.dev.yml` and the matching
  values in `.env` (`DATABASE_URL`, `REDIS_URL`, `PORT`).
- **`npm run infra:reset`** removes the containers AND the volumes. All data is wiped;
  re-run `npx prisma migrate deploy` and `npx prisma db seed` afterwards.
- **`ADMIN_PASSWORD_HASH` must be a bcrypt hash** (`$2a$`/`$2b$`). The env validation fails
  fast with a clear message if it is not.
- **`SERVICE_API_KEY` must be at least 16 characters.** Requests without a matching
  `X-API-Key` header are rejected with `401`.
