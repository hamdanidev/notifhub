# @notifhub/react

React bindings for NotifHub in-app notifications, built on top of `@notifhub/js` (fetch-based
SSE, no `EventSource`).

## Install

```bash
npm install @notifhub/react @notifhub/js react react-dom
```

## Usage

```tsx
import { NotifHubClient } from '@notifhub/js';
import {
  NotifHubProvider,
  NotificationBell,
  NotificationInbox,
  useNotifHub,
} from '@notifhub/react';

const client = new NotifHubClient({
  baseUrl: 'https://notifhub.example.com',
  getToken: () => session.accessToken,
});

export function App() {
  const [open, setOpen] = useState(false);

  return (
    <NotifHubProvider client={client} limit={50} onError={(error) => console.error(error.code)}>
      <header>
        <NotificationBell onClick={() => setOpen((value) => !value)} />
      </header>
      {open ? <NotificationInbox limit={20} /> : null}
      <UnreadCounter />
    </NotifHubProvider>
  );
}

function UnreadCounter() {
  const { unreadCount } = useNotifHub();
  return <span>{unreadCount} unread</span>;
}
```

## Components

- `NotifHubProvider` — creates one SSE subscription, keeps up to `limit` notifications and the
  derived unread count, exposes `markRead` and `refresh`.
- `useNotifHub()` — `{ client, status, notifications, unreadCount, markRead, refresh }`.
- `NotificationBell` — headless button with `notifhub-bell` class names, optional `renderBadge`.
- `NotificationInbox` — headless list with `notifhub-inbox` class names; clicking an item marks
  it read. Optional `renderItem`, `emptyState`, `onNotificationClick`, and
  `renderBody="safe-html"` to render the server-sanitized `bodyHtml` of markdown templates
  (default renders `body` as plain text).

Components are unstyled: provide your own CSS (or Bootstrap classes via `className`). The unread
count is derived from fetched notifications plus live SSE events; there is no separate
unread-count endpoint yet.

## Build and test

```bash
npm run build
npm run typecheck
npm run test
```
