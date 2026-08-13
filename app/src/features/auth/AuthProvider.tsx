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
import { readAuthEnvironment } from '../../infrastructure/cloud/cloud-environment';
import { getSupabaseClient } from '../../infrastructure/cloud/supabase-client';
import { clearSecuritiesAccountCache } from '../securities/securities-account-cache';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  cloudEnabled: boolean;
  configurationError: string | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const configuration = useMemo(() => {
    try {
      const environment = readAuthEnvironment(import.meta.env);
      return {
        environment,
        error: environment ? null : 'Authentication is not configured',
      };
    } catch (error) {
      return {
        environment: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, []);
  const cloudEnabled = configuration.environment !== null;
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
      setUser(error ? null : (data.session?.user ?? null));
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
    if (!cloudEnabled) {
      throw new Error(configuration.error ?? 'Authentication is not configured');
    }
    return getSupabaseClient();
  }, [cloudEnabled, configuration.error]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await requireCloud().auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, [requireCloud]);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await requireCloud().auth.signUp({ email, password });
    if (error) throw error;
  }, [requireCloud]);

  const signOut = useCallback(async () => {
    const departingUserId = user?.id ?? '';
    const { error } = await requireCloud().auth.signOut();
    if (error) throw error;
    if (departingUserId) clearSecuritiesAccountCache(departingUserId);
  }, [requireCloud, user?.id]);

  const requestPasswordReset = useCallback(async (email: string) => {
    const redirectTo = `${window.location.origin}/login?reset=1`;
    const { error } = await requireCloud().auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  }, [requireCloud]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    cloudEnabled,
    configurationError: configuration.error,
    signIn,
    signUp,
    signOut,
    requestPasswordReset,
  }), [
    cloudEnabled,
    configuration.error,
    loading,
    requestPasswordReset,
    signIn,
    signOut,
    signUp,
    user,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}

/** useAuth 的可选版：未包裹在 AuthProvider 内时返回 null，供数据层 hook 安全降级。 */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}
