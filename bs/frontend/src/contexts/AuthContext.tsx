import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api, type SessionSchool, type SessionUser } from '@/lib/api';

type AuthContextValue = {
  user: SessionUser | null;
  school: SessionSchool | null;
  csrfToken: string | null;
  loading: boolean;
  authenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [school, setSchool] = useState<SessionSchool | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const session = await api.getSession();
      setUser(session.user);
      setSchool(session.school);
      setCsrfToken(session.csrfToken);
      api.setCsrfToken(session.csrfToken);
    } catch {
      setUser(null);
      setSchool(null);
      setCsrfToken(null);
      api.setCsrfToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.login(email, password);
    setUser(data.user);
    setSchool(data.school);
    setCsrfToken(data.csrfToken);
    api.setCsrfToken(data.csrfToken);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setSchool(null);
    setCsrfToken(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        school,
        csrfToken,
        loading,
        authenticated: Boolean(user),
        login,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth doit être utilisé dans un AuthProvider');
  }
  return context;
}
