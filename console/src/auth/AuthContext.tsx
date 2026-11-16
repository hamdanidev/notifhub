import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { adminClient } from '../lib/adminClient';
import { clearSession, loadSession, saveSession, type AdminSession } from '../lib/session';

interface AuthContextValue {
  session: AdminSession | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<AdminSession | null>(() => loadSession());

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const result = await adminClient.login(email, password);
    setSession(saveSession(result.accessToken, result.expiresIn, result.admin));
  }, []);

  const logout = useCallback((): void => {
    clearSession();
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, login, logout }),
    [session, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (context === null) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }

  return context;
}
