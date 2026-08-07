import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { readCloudEnvironment } from '../../infrastructure/cloud/cloud-environment';
import { getSupabaseClient } from '../../infrastructure/cloud/supabase-client';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  cloudEnabled: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const environment = useMemo(() => readCloudEnvironment(import.meta.env), []);
  const cloudEnabled = environment !== null;
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(cloudEnabled);

  useEffect(() => {
    if (!cloudEnabled) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    const client = getSupabaseClient();
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setUser(null);
      else setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (active) {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [cloudEnabled]);

  const requireCloud = useCallback(() => {
    if (!cloudEnabled) throw new Error('Cloud monitoring is not configured');
    return getSupabaseClient();
  }, [cloudEnabled]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await requireCloud().auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, [requireCloud]);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await requireCloud().auth.signUp({ email, password });
    if (error) throw error;
  }, [requireCloud]);

  const signOut = useCallback(async () => {
    const { error } = await requireCloud().auth.signOut();
    if (error) throw error;
  }, [requireCloud]);

  const requestPasswordReset = useCallback(async (email: string) => {
    const redirectTo = `${window.location.origin}/login?reset=1`;
    const { error } = await requireCloud().auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  }, [requireCloud]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    cloudEnabled,
    signIn,
    signUp,
    signOut,
    requestPasswordReset,
  }), [cloudEnabled, loading, requestPasswordReset, signIn, signOut, signUp, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
