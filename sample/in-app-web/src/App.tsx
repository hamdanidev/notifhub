import { NotifHubClient, type NotifHubError } from '@notifhub/js';
import { NotifHubProvider } from '@notifhub/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createSession } from './dev-api';
import { describeError, type ErrorInfo } from './errors';
import { Landing } from './components/Landing';
import { Workspace, type WorkspaceTab } from './components/Workspace';
import {
  clearStoredSession,
  loadStoredSession,
  storeSession,
  type SampleSession,
} from './session';

export function App() {
  const [session, setSession] = useState<SampleSession | null>(() => loadStoredSession());
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('inbox');
  const [epoch, setEpoch] = useState(0);
  const [providerError, setProviderError] = useState<ErrorInfo | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [renewError, setRenewError] = useState<ErrorInfo | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);

  const client = useMemo(() => {
    if (session === null) {
      return null;
    }

    return new NotifHubClient({
      baseUrl: window.location.origin,
      getToken: () => session.token,
    });
  }, [session]);

  useEffect(() => {
    return () => {
      client?.close();
    };
  }, [client]);

  const persist = (next: SampleSession): void => {
    setStorageWarning(!storeSession(next));
  };

  const handleStarted = (next: SampleSession): void => {
    persist(next);
    setSession(next);
    setProviderError(null);
    setRenewError(null);
    setActiveTab('inbox');
    setEpoch((value) => value + 1);
  };

  const handleLogout = (): void => {
    client?.close();
    clearStoredSession();
    setSession(null);
    setProviderError(null);
    setRenewError(null);
    setStorageWarning(false);
    setActiveTab('inbox');
  };

  const handleProviderError = useCallback((error: NotifHubError): void => {
    setProviderError(describeError(error));
  }, []);

  const handleReconnect = (): void => {
    setProviderError(null);
    setRenewError(null);
    setEpoch((value) => value + 1);
  };

  const renewSession = async (): Promise<void> => {
    if (session === null || renewing) {
      return;
    }

    setRenewing(true);
    setRenewError(null);

    try {
      const next = await createSession({
        recipientId: session.recipientId,
        tenant: session.tenant,
      });

      persist(next);
      setSession(next);
      setProviderError(null);
      setEpoch((value) => value + 1);
    } catch (cause: unknown) {
      setRenewError(describeError(cause));
    } finally {
      setRenewing(false);
    }
  };

  const handleSimulateUnauthorized = (): void => {
    if (session === null) {
      return;
    }

    const tampered: SampleSession = {
      ...session,
      token: `${session.token}.tampered`,
    };

    persist(tampered);
    setSession(tampered);
    setProviderError(null);
    setRenewError(null);
    setActiveTab('inbox');
    setEpoch((value) => value + 1);
  };

  if (session === null || client === null) {
    return <Landing onStarted={handleStarted} />;
  }

  return (
    <NotifHubProvider
      key={`${session.recipientId}:${epoch}`}
      client={client}
      limit={50}
      onError={handleProviderError}
    >
      <Workspace
        session={session}
        client={client}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onLogout={handleLogout}
        onReconnect={handleReconnect}
        onRenew={() => {
          void renewSession();
        }}
        renewing={renewing}
        renewError={renewError}
        providerError={providerError}
        storageWarning={storageWarning}
        onSimulateUnauthorized={handleSimulateUnauthorized}
      />
    </NotifHubProvider>
  );
}
