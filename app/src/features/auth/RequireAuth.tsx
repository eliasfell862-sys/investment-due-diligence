import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { AuthContextValue } from './AuthProvider';
import { useAuth } from './AuthProvider';

function useOptionalAuth(): AuthContextValue | null {
  try {
    return useAuth();
  } catch {
    return null;
  }
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useOptionalAuth();
  const location = useLocation();

  if (!auth || !auth.cloudEnabled) return children;
  if (auth.loading) return <div role="status">正在恢复账户会话…</div>;
  if (!auth.user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}
