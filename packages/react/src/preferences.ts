import {
  isNotifHubError,
  type ChannelPreference,
  type NotifHubClient,
  type NotifHubError,
  type PreferenceChannel,
  type SubscriberPreferences,
  type UpdatePreferenceInput,
} from '@notifhub/js';
import { useCallback, useEffect, useRef, useState } from 'react';

export type PreferencesStatus = 'loading' | 'ready' | 'error';

export interface UsePreferencesResult {
  /** Latest snapshot, or null before the first successful load. */
  preferences: SubscriberPreferences | null;
  status: PreferencesStatus;
  error: NotifHubError | null;
  /** Re-reads the snapshot from the API. */
  reload: () => Promise<void>;
  /** Replaces one channel preference and patches the local snapshot with the response. */
  update: (channel: PreferenceChannel, input: UpdatePreferenceInput) => Promise<ChannelPreference>;
}

/**
 * Headless end-user preference center hook.
 *
 * Takes the client explicitly instead of reading the provider context: a preference page does not
 * need the SSE subscription that `NotifHubProvider` opens. Loading happens in an effect, so a
 * server render returns the `loading` state and never touches the network.
 */
export function usePreferences(client: NotifHubClient): UsePreferencesResult {
  const [preferences, setPreferences] = useState<SubscriberPreferences | null>(null);
  const [status, setStatus] = useState<PreferencesStatus>('loading');
  const [error, setError] = useState<NotifHubError | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    setError(null);

    try {
      const snapshot = await client.getPreferences();

      if (!mounted.current) {
        return;
      }

      setPreferences(snapshot);
      setStatus('ready');
    } catch (cause: unknown) {
      if (!mounted.current) {
        return;
      }

      setError(isNotifHubError(cause) ? cause : null);
      setStatus('error');
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback((): Promise<void> => load(), [load]);

  const update = useCallback(
    async (
      channel: PreferenceChannel,
      input: UpdatePreferenceInput,
    ): Promise<ChannelPreference> => {
      const updated = await client.updatePreference(channel, input);

      if (mounted.current) {
        setPreferences((previous) =>
          previous === null
            ? previous
            : {
                ...previous,
                channels: previous.channels.map((item) =>
                  item.channel === updated.channel ? updated : item,
                ),
              },
        );
      }

      return updated;
    },
    [client],
  );

  return { preferences, status, error, reload, update };
}
