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
- **Tenancy**: four separate auth lanes (API key, admin JWT, subscriber JWT, platform admin JWT),
  tenant-scoped data, and per-tenant subscriber signing secrets. The platform lane covers
  authentication, tenant provisioning, suspend/resume, and an audit trail.
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

Full setup, per-feature verification, and troubleshooting:
[docs/README.md](docs/README.md) is the entry point, or jump straight to
[docs/getting-started/local-setup.md](docs/getting-started/local-setup.md) and
[docs/getting-started/troubleshooting.md](docs/getting-started/troubleshooting.md).

## Repository layout

| Path | Contents |
|---|---|
| `src/` | NestJS backend: ingest, workers, providers, webhooks, in-app, admin, auth, topics, preferences, subscribers, templates, notifications, cleanup, queues, metrics, health, config |
| `prisma/` | Schema, migrations, and development seed |
| `packages/js-sdk/` | `@notifhub/js`: in-app client, SSE transport, `NotifHubAdminClient`, preference center methods |
| `packages/react/` | `@notifhub/react`: provider, bell, inbox, `usePreferences` |
| `sample/in-app-web/` | Sample lokal React 18 + Vite untuk in-app/SSE/preference center, memakai SDK npm terbit dan middleware dev-only |
| `console/` | Console React 18 + Vite + Bootstrap 5: tenant admin and platform pages; builds two artifacts (`dist/tenant`, `dist/platform`) deployed to separate origins |
| `sdk/go/` | Go SDK (`github.com/hamdanidev/notifhub-go`) generated from the public OpenAPI document |
| `openapi/notifhub.json` | Public consumer OpenAPI subset used for SDK generation |
| `scripts/` | OpenAPI export, local provider stubs, development token helper, end-to-end verification |
| `docs/` | Getting started, architecture, feature designs, usage guides, SDK, and operations docs — start at [`docs/README.md`](docs/README.md) |

## Documentation

Everything lives under [`docs/`](docs/README.md), which maps every document and suggests a reading
order per role.

- **Getting started:** [local setup and verification](docs/getting-started/local-setup.md) ·
  [configuration reference](docs/getting-started/configuration.md) ·
  [troubleshooting](docs/getting-started/troubleshooting.md)
- **Architecture:** [system overview](docs/architecture/overview.md) ·
  [project brief: stack, capabilities, known limitations](docs/architecture/project-brief.md)
- **Usage guide:** [concepts and quickstart](docs/usage/README.md) ·
  [consumer integration](docs/usage/integration.md) ·
  [end-user: in-app/SSE/preference center](docs/usage/end-user.md) ·
  [admin and operations](docs/usage/admin-and-operations.md) ·
  [platform admin](docs/usage/platform-admin.md)
- **Design docs:** [index](docs/design/README.md) — in-app, email and preferences, preference
  center, webhooks, WhatsApp, admin API, React and console, console needs analysis, in-app sample;
  templates: [system design](docs/design/templates/template-system-design.md),
  [authoring UI](docs/design/templates/email-authoring-ui-design.md),
  [block builder](docs/design/templates/email-block-builder-design.md),
  [limitations roadmap](docs/design/templates/template-limitations-roadmap.md)
- **SDKs:** [Go SDK](docs/sdk/go-sdk.md) · [npm publishing](docs/sdk/npm-publishing.md)
- **Operations:** [production readiness: tests, images, and CI](docs/operations/production-readiness.md)

## Testing

```bash
npm run ci                              # typecheck + build + unit + e2e + migrate status (CI parity)
npm run test:unit                       # Jest unit tests (no database required)
npm run test:e2e                        # Jest e2e against notifhub_test + Redis db 15
npm run sdk:typecheck && npm run sdk:test
npm run react:typecheck && npm run react:test
npm --prefix sample/in-app-web ci
npm run typecheck --prefix sample/in-app-web && npm run build --prefix sample/in-app-web
npm run console:typecheck && npm run console:build
npm run sdk:go:test
npm run verify:preferences              # HTTP + DB smoke test, needs a running backend
npm run docs:check                      # relative links and heading anchors in docs/
```

## Docker

```bash
cp .env.prod.example .env.prod           # fill every CHANGE_ME
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

The stack runs Postgres, Redis, a one-shot `migrate` job, the backend (`:3000`), and two console
images: tenant console (`:8080`) and platform console (`:8081`, separate artifact/origin). It is
meant for verification, not as a production deployment; see
[docs/getting-started/local-setup.md](docs/getting-started/local-setup.md#run-the-docker-smoke-stack).

## Versions

Root service `0.11.0`; npm: `@notifhub/js` `0.3.0`, `@notifhub/react` `0.2.0`; `notifhub-console`
`0.2.0`; Go module `github.com/hamdanidev/notifhub-go` `v0.10.0` (Go 1.23).

## License

UNLICENSED — internal project.
