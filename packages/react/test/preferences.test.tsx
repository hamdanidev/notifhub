import type { NotifHubClient } from '@notifhub/js';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { usePreferences } from '../src/preferences';

function fakeClient(): NotifHubClient {
  return {
    getPreferences: vi.fn(),
    updatePreference: vi.fn(),
  } as unknown as NotifHubClient;
}

function Harness({ client }: { client: NotifHubClient }): JSX.Element {
  const { status, preferences, error } = usePreferences(client);
  const channels = preferences === null ? 'none' : String(preferences.channels.length);

  return (
    <span data-status={status} data-error={error === null ? 'none' : 'set'}>
      {`${status}:${channels}`}
    </span>
  );
}

describe('usePreferences', () => {
  it('renders the loading state on the server without calling the API', () => {
    const client = fakeClient();

    const html = renderToStaticMarkup(<Harness client={client} />);

    expect(html).toContain('loading:none');
    expect(html).toContain('data-error="none"');
    expect(client.getPreferences).not.toHaveBeenCalled();
  });
});
