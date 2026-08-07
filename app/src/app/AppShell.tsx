import { useState } from 'react';
import type { AuthContextValue } from '../features/auth/AuthProvider';
import { useAuth } from '../features/auth/AuthProvider';
import { AppShell as AppShellBase } from './AppShellBase';

function useOptionalAuth(): AuthContextValue | null {
  try {
    return useAuth();
  } catch {
    return null;
  }
}

function AccountControl() {
  const auth = useOptionalAuth();
  const [error, setError] = useState('');
  if (!auth?.cloudEnabled) return null;

  return (
    <div style={{ position: 'fixed', left: 18, bottom: 18, zIndex: 110, maxWidth: 180, color: '#9fb9b4', fontSize: '0.68rem' }}>
      {auth.loading ? '账户连接中…' : auth.user ? (
        <div style={{ display: 'grid', gap: 5 }}>
          <span title={auth.user.email}>{auth.user.email}</span>
          <button
            type="button"
            onClick={() => {
              setError('');
              void auth.signOut().catch(signOutError => {
                setError(signOutError instanceof Error ? signOutError.message : String(signOutError));
              });
            }}
          >
            退出登录
          </button>
          {error && <span role="alert" style={{ color: '#f0a0a0' }}>{error}</span>}
        </div>
      ) : (
        <a href="/login" style={{ color: '#70b8b0' }}>登录云端监控</a>
      )}
    </div>
  );
}

export function AppShell() {
  return (
    <>
      <AppShellBase />
      <AccountControl />
    </>
  );
}
