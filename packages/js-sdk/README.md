# @notifhub/js

Headless, framework-agnostic TypeScript SDK for NotifHub in-app notifications. It is the only
supported way for browser applications to talk to NotifHub (PART 1 rule 29): token injection,
HTTP retries, SSE reconnect and typed errors live here.

## Requirements

- Browser with `fetch` + `AbortSignal` (or Node.js 20+)
- A subscriber JWT issued by the consumer with claims `sub`, `tenant`, `exp`, signed with the
  tenant's subscriber secret (the API key `subscriberJwtSecret`, falling back to
  `SUBSCRIBER_JWT_SECRET` only for tenants that never configured one)

## Install

```bash
npm install @notifhub/js
```

## Usage

```ts
import { NotifHubClient, isNotifHubError } from '@notifhub/js';

const client = new NotifHubClient({
  baseUrl: 'https://notifhub.example.com',
  getToken: () => session.accessToken, // called per request and per SSE reconnect
});

const subscription = client.subscribe({
  onNotification: (notification) => {
    console.log(notification.notificationId, notification.body);
  },
  onError: (error) => {
    if (isNotifHubError(error) && error.code === 'unauthorized') {
      // Token expired: refresh and subscribe again.
    }
  },
});

const page = await client.getNotifications({ limit: 20 });
await client.markRead(page.items[0]?.notificationId ?? '');

subscription.close();
client.close();
```

## Behaviour

- **Fetch-based SSE only** (own SSE line-protocol parser over `fetch`); the browser `EventSource` is never used,
  so the JWT travels in the `Authorization` header and never in the query string.
- **Reconnect** with exponential backoff + jitter (1s doubling, capped) and `Last-Event-ID`
  resume, so missed events are replayed by the server for up to `SSE_REPLAY_BUFFER_SECONDS`.
- **Retries** for `5xx`, `429` (honouring `Retry-After`) and network errors; `4xx` errors are not retried.
- **Typed errors**: `NotifHubError.code` is one of `unauthorized`, `forbidden`, `not_found`,
  `bad_request`, `rate_limited`, `server_error`, `network_error`, `aborted`, `invalid_response`.
- **Cancellation** via `AbortSignal` on `subscribe`, `getNotifications` and `markRead`.
- **Dedupe** of replayed events by stream id and notification id.

## Build and test

```bash
npm run sdk:build       # from repository root
npm run sdk:typecheck
npm run sdk:test
```
