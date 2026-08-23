import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { clearToken, getToken } from '../api/client';
import { login as apiLogin, register as apiRegister } from '../api/auth';

type AuthContextValue = {
  isSignedIn: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (fullName: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getToken()
      .then((token) => setIsSignedIn(Boolean(token)))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isSignedIn,
      loading,
      signIn: async (email, password) => {
        await apiLogin(email, password);
        setIsSignedIn(true);
      },
      signUp: async (fullName, email, password) => {
        await apiRegister(fullName, email, password);
        setIsSignedIn(true);
      },
      signOut: async () => {
        await clearToken();
        setIsSignedIn(false);
      },
    }),
    [isSignedIn, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
