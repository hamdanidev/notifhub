# notifhub-console

Tenant Admin Console for NotifHub (React 18 + Vite + Bootstrap 5). It manages data scoped to
the authenticated admin's `tenantId` only: notifications, templates, subscribers + preferences,
topics, and API keys. All API calls go through `@notifhub/js` (`NotifHubAdminClient`); there is
no direct `fetch`/`axios` usage.

## Requirements

- Node.js 20+
- A running NotifHub backend (default `http://localhost:3000`)
- An admin account bootstrapped from `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH`

## Setup

```bash
npm install
cp .env.example .env        # adjust VITE_NOTIFHUB_API_URL if needed
npm run dev                 # http://localhost:5173
```

Build and typecheck:

```bash
npm run typecheck
npm run build
npm run preview             # serves console/dist on http://localhost:4173
```

## Notes

- The admin JWT is kept in `sessionStorage` for the tab session. A `401` from the API clears the
  session and redirects to `/login`.
- There is no refresh token yet; the token lifetime comes from `ADMIN_JWT_EXPIRES_IN`.
- The dashboard aggregates client-side (counts per status + last 200 notifications for the
  14-day chart) because the Admin API has no analytics endpoint.
- CORS: development works with `CORS_ORIGINS=*`; outside development register the console origin
  explicitly.
- The console ships as a static nginx image (`console/Dockerfile`) and is part of
  `docker-compose.prod.yml`; it is served on port 8080 by that stack.
