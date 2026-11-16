# NotifHub

NotifHub is a general-purpose, multi-channel notification service. It is not tied to any
industry or domain: it delivers transactional notifications for any application.

Integration is SDK-first. Consumers trigger notifications through `POST /api/v1/notify`
(`X-API-Key`), browser clients use `@notifhub/js` / `@notifhub/react`, service consumers can use
the Go SDK, and `/api/docs-json` is the single source of truth for SDK contracts.

Packages are published:

```bash
npm install @notifhub/js                      # in-app client + admin client
npm install @notifhub/react react react-dom   # headless React bindings
go get github.com/hamdanidev/notifhub-go      # consumer API (release mirror)
```

## What it does

- **Channels**: in-app (SSE stream plus catch-up/read API), email (SMTP), and WhatsApp
  (Meta Cloud API). Every channel has its own queue and worker.
- **Delivery guarantees**: idempotent ingest, retries with exponential backoff, per-recipient
  status, provider abstraction with a circuit breaker, and monotonic provider webhook updates.
- **Preferences**: per-channel enable/disable, quiet hours with timezones, and channel fallback.
  End users manage their own preferences through the subscriber lane; tenant admins can do the
  same from the console.
- **Targeting**: explicit recipients, dynamic topics with membership push, and time-bound topic
  membership.
- **Tenancy**: three separate auth lanes (API key, admin JWT, subscriber JWT), tenant-scoped data,
  and per-tenant subscriber signing secrets.
- **Operations**: health/readiness, Prometheus metrics, structured logs with request IDs, retention
  and idempotency cleanup jobs, and Swagger documentation.

## Quick start

```bash
npm install
npm run infra:up          # PostgreSQL 16 + Redis 7 (Docker)
cp .env.example .env      # adjust ADMIN_PASSWORD_HASH etc.
npx prisma migrate deploy
npx prisma db seed
npm run start:dev         # backend on http://localhost:3000
npm run console:dev       # tenant console on http://localhost:5173
```

Full setup, verification steps per feature, and troubleshooting: [docs/local-setup.md](docs/local-setup.md).

## Repository layout

| Path | Contents |
|---|---|
| `src/` | NestJS backend: ingest, workers, providers, webhooks, in-app, admin, auth, topics, preferences, subscribers, templates, notifications, cleanup, queues, metrics, health, config |
| `prisma/` | Schema, migrations, and development seed |
| `packages/js-sdk/` | `@notifhub/js`: in-app client, SSE transport, `NotifHubAdminClient`, preference center methods |
| `packages/react/` | `@notifhub/react`: provider, bell, inbox, `usePreferences` |
| `console/` | Tenant admin console (React 18 + Vite + Bootstrap 5) |
| `sdk/go/` | Go SDK (`github.com/hamdanidev/notifhub-go`) generated from the public OpenAPI document |
| `openapi/notifhub.json` | Public consumer OpenAPI subset used for SDK generation |
| `scripts/` | OpenAPI export, local provider stubs, development token helper, end-to-end verification |
| `docs/` | Architecture, feature designs, and setup guide |

## Documentation

- [Usage guide](docs/usage/README.md) — concepts and quickstart, consumer integration, end-user
  (in-app/SSE/preference center), admin and operations
- [Local setup and verification](docs/local-setup.md)
- [Project brief: architecture, rules, and known limitations](docs/project-brief.md)
- [Production readiness: tests, images, and CI](docs/production-readiness.md)
- Feature designs:
  [in-app](docs/in-app.md) ·
  [email and preferences](docs/email-and-preferences.md) ·
  [webhooks](docs/webhooks.md) ·
  [admin API](docs/admin-api.md) ·
  [React and console](docs/react-and-console.md) ·
  [WhatsApp](docs/whatsapp.md) ·
  [Go SDK](docs/go-sdk.md) ·
  [preference center](docs/preference-center.md)

## Testing

```bash
npm run ci                              # typecheck + build + e2e + migrate status (CI parity)
npm run test:e2e                        # Jest e2e against notifhub_test + Redis db 15
npm run sdk:typecheck && npm run sdk:test
npm run react:typecheck && npm run react:test
npm run console:typecheck && npm run console:build
npm run sdk:go:test
npm run verify:preferences              # HTTP + DB smoke test, needs a running backend
```

## Docker

```bash
cp .env.prod.example .env.prod           # fill every CHANGE_ME
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

The stack runs Postgres, Redis, a one-shot `migrate` job, the backend (`:3000`), and the console
(`:8080`). It is meant for verification, not as a production deployment; see
[docs/local-setup.md](docs/local-setup.md#run-the-docker-smoke-stack).

## Versions

Root service `0.10.0`; npm: `@notifhub/js` `0.3.0`, `@notifhub/react` `0.2.0`; `notifhub-console`
`0.1.0`; Go module `github.com/hamdanidev/notifhub-go` `v0.10.0` (Go 1.23).

## License

UNLICENSED — internal project.
