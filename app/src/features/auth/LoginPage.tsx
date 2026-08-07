import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';

type Mode = 'login' | 'register';

export function LoginPage() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  if (!auth.cloudEnabled) return <Navigate to="/securities" replace />;
  if (auth.user) return <Navigate to="/securities" replace />;

  const destination = typeof location.state === 'object'
    && location.state
    && 'from' in location.state
    && typeof location.state.from === 'string'
    ? location.state.from
    : '/securities';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    if (!email.trim() || !email.includes('@')) {
      setMessage('请输入有效邮箱');
      return;
    }
    if (password.length < 8) {
      setMessage('密码至少需要8位');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        await auth.signIn(email.trim(), password);
        navigate(destination, { replace: true });
      } else {
        await auth.signUp(email.trim(), password);
        setMessage('账户已创建，请使用邮箱和密码登录');
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

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0c1717' }}>
      <section style={{ width: 380, maxWidth: '90vw', padding: 28, border: '1px solid #315050', borderRadius: 12, background: '#142424' }}>
        <p style={{ color: '#70b8b0', margin: 0 }}>Cloud Signal Monitor</p>
        <h1 style={{ color: '#f2eadf', margin: '8px 0 20px' }}>{mode === 'login' ? '登录证券账户' : '创建证券账户'}</h1>
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
          {message && <div role="alert" style={{ color: message.includes('已') ? '#70b8b0' : '#f0a0a0', marginBottom: 12 }}>{message}</div>}
          <button type="submit" disabled={submitting} style={{ width: '100%', padding: 10 }}>
            {submitting ? '处理中…' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
          <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setMessage(''); }}>
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
