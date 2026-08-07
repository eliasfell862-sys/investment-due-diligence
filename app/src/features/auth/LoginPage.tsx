import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';

type Mode = 'login' | 'register';

function isSecuritiesDestination(value: unknown): value is string {
  return typeof value === 'string'
    && (value.startsWith('/securities') || value.includes('/securities/'));
}

const pageStyle = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  background: '#0c1717',
} as const;

const cardStyle = {
  width: 380,
  maxWidth: '90vw',
  padding: 28,
  border: '1px solid #315050',
  borderRadius: 12,
  background: '#142424',
} as const;

export function LoginPage() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  const requestedDestination = typeof location.state === 'object'
    && location.state
    && 'from' in location.state
    ? location.state.from
    : null;
  const destination = isSecuritiesDestination(requestedDestination)
    ? requestedDestination
    : '/securities';

  if (auth.loading) {
    return <main role="status" style={pageStyle}>正在恢复账户会话…</main>;
  }

  if (!auth.cloudEnabled) {
    return (
      <main style={pageStyle}>
        <section style={cardStyle}>
          <h1 style={{ color: '#f2eadf', marginTop: 0 }}>登录证券账户</h1>
          <div role="alert" style={{ color: '#f0a0a0' }}>
            <p>证券账户服务尚未配置，请联系管理员</p>
            {auth.configurationError && <p>{auth.configurationError}</p>}
          </div>
        </section>
      </main>
    );
  }

  if (auth.user) return <Navigate to={destination} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    if (!email.trim() || !email.includes('@')) {
      setMessage('请输入有效邮箱');
      return;
    }
    if (password.length < 8) {
      setMessage('密码至少需要 8 位');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        await auth.signIn(email.trim(), password);
        navigate(destination, { replace: true });
      } else {
        await auth.signUp(email.trim(), password);
        setPassword('');
        setMessage('注册成功，请查收验证邮件后再登录');
        setMode('login');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const resetPassword = async () => {
    setMessage('');
    if (!email.trim() || !email.includes('@')) {
      setMessage('请先填写有效邮箱');
      return;
    }
    setSubmitting(true);
    try {
      await auth.requestPasswordReset(email.trim());
      setMessage('密码重置邮件已发送');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const successMessage = message === '注册成功，请查收验证邮件后再登录'
    || message === '密码重置邮件已发送';

  return (
    <main style={pageStyle}>
      <section style={cardStyle}>
        <p style={{ color: '#70b8b0', margin: 0 }}>Securities Workspace</p>
        <h1 style={{ color: '#f2eadf', margin: '8px 0 20px' }}>
          {mode === 'login' ? '登录证券账户' : '创建证券账户'}
        </h1>
        <form onSubmit={submit}>
          <label style={{ display: 'grid', gap: 6, color: '#bfd0cc', marginBottom: 14 }}>
            邮箱
            <input
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              autoComplete="email"
              style={{ padding: 10, borderRadius: 6, border: '1px solid #416363', background: '#0d1a1a', color: '#fff' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, color: '#bfd0cc', marginBottom: 16 }}>
            密码
            <input
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              style={{ padding: 10, borderRadius: 6, border: '1px solid #416363', background: '#0d1a1a', color: '#fff' }}
            />
          </label>
          {message && (
            <div role="alert" style={{ color: successMessage ? '#70b8b0' : '#f0a0a0', marginBottom: 12 }}>
              {message}
            </div>
          )}
          <button type="submit" disabled={submitting} style={{ width: '100%', padding: 10 }}>
            {submitting ? '处理中…' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setMessage('');
            }}
          >
            {mode === 'login' ? '创建账户' : '返回登录'}
          </button>
          {mode === 'login' && (
            <button type="button" disabled={submitting} onClick={() => void resetPassword()}>
              忘记密码
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
