# Multi-User Securities Auth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可部署到 Netlify 的邮箱注册、验证、登录和证券路由保护基础，并保证生产包只能连接线上 Supabase。

**Architecture:** 将 Supabase 认证配置与现有 Web Push 配置拆开，使登录只依赖 Supabase URL 和 anon public key。证券路由在现有页面元素外只增加 `RequireAuth`，不替换证券数据源、不接管本地收件箱，也不修改个股分析页面。数据库通过 `auth.users` 触发器自动创建 `profiles`，Netlify 通过 SPA fallback 支持证券深层路由刷新。

**Tech Stack:** React 19、React Router 7、TypeScript 6、Vite 8、Vitest、Testing Library、Supabase Auth/PostgreSQL/pgTAP、Netlify

## Global Constraints

- 不使用子代理执行本计划；执行时使用 `executing-plans` skill 在当前会话分批完成。
- 第一批只处理账户入口与生产环境，不迁移自选股、持仓、虚拟仓、策略、收件箱或提前布局数据。
- 不修改 `StockAnalysisPage`、个股分析引擎、估值算法、交易策略算法或基金数据模块。
- 证券页面继续使用当前页面组件和本地数据路径；本批次不得引入 `SecuritiesDataSourceProvider` 或 `SecuritiesRouteBoundary`。
- 未登录用户不能访问 `/securities`、全部 `/securities/*` 路由及全部 `/projects/:projectId/securities/*` 路由。
- 注册必须使用邮箱和至少 8 位密码；线上 Supabase 必须开启邮箱验证。
- 登录后默认进入 `/securities`；从受保护证券路径跳转登录时，登录后返回原目标路径。
- 同一账户允许多个设备同时保持登录，不实现“新设备踢出旧设备”。
- 浏览器端只允许使用 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`；不得打包 service role key。
- 生产构建必须拒绝空配置、`localhost`、`127.0.0.1`、`::1` 及 service-role 凭据。
- 本地开发仍允许连接本地 Supabase；生产构建保护只在 Vite `mode === 'production'` 时强制执行。
- 工作区包含其他未提交改动；每次提交只暂存任务明确列出的文件。

---

## File Structure

- `app/src/infrastructure/cloud/cloud-environment.ts`：分别解析认证配置和推送配置，并验证生产认证配置。
- `app/src/infrastructure/cloud/cloud-environment.test.ts`：覆盖认证/推送解耦、环回地址和 service-role 拒绝规则。
- `app/src/infrastructure/cloud/supabase-client.ts`：仅以认证配置创建持久化 Supabase 浏览器客户端。
- `app/vite.config.ts`：生产构建开始前执行认证环境保护，保留全部现有开发代理。
- `app/.env.production.example`：记录允许进入浏览器生产包的公开变量名。
- `app/src/features/auth/AuthProvider.tsx`：恢复会话并暴露清晰的认证配置状态。
- `app/src/features/auth/AuthProvider.test.tsx`：验证缺失配置、会话恢复、登录和邮箱验证注册流程。
- `app/src/features/auth/RequireAuth.tsx`：保护证券页面并保留完整来源路径。
- `app/src/features/auth/LoginPage.tsx`：登录、注册确认提示、忘记密码和配置错误页面。
- `app/src/features/auth/LoginPage.test.tsx`：验证登录返回路径、注册验证提示和配置错误状态。
- `app/src/app/router.tsx`：递归包装全部证券路由，只增加 `RequireAuth`。
- `app/src/app/router-auth.test.tsx`：验证顶层和项目内证券路由均受保护，非证券路由不受影响。
- `app/supabase/migrations/202608070007_auth_profile_bootstrap.sql`：新用户自动创建 profile，并固定函数权限和 search path。
- `app/supabase/tests/auth_profile_bootstrap.test.sql`：验证 profile 自动创建、级联删除和 RLS 所有权隔离。
- `app/public/_redirects`：Netlify SPA 深层路由 fallback。
- `docs/deployment/netlify-supabase-auth.md`：线上 Supabase 和 Netlify 的精确配置、构建与验收步骤。

---

### Task 1: Decouple Authentication and Push Environment Configuration

**Files:**
- Modify: `app/src/infrastructure/cloud/cloud-environment.ts`
- Modify: `app/src/infrastructure/cloud/cloud-environment.test.ts`
- Modify: `app/src/infrastructure/cloud/supabase-client.ts`

**Interfaces:**
- Produces: `AuthEnvironment { supabaseUrl: string; supabaseAnonKey: string }`
- Produces: `PushEnvironment { vapidPublicKey: string }`
- Produces: `readAuthEnvironment(env): AuthEnvironment | null`
- Produces: `readPushEnvironment(env): PushEnvironment | null`
- Produces: `assertProductionAuthEnvironment(env): AuthEnvironment`
- Consumes later: Task 2 imports `assertProductionAuthEnvironment`; Task 3 uses `readAuthEnvironment` through `AuthProvider`.

- [ ] **Step 1: Replace the environment tests with separate auth, push, and production cases**

Add imports and test cases equivalent to:

```ts
import { describe, expect, it } from 'vitest';
import {
  assertProductionAuthEnvironment,
  readAuthEnvironment,
  readPushEnvironment,
} from './cloud-environment';

describe('readAuthEnvironment', () => {
  it('returns null when authentication is not configured', () => {
    expect(readAuthEnvironment({})).toBeNull();
  });

  it('does not require VAPID for authentication', () => {
    expect(readAuthEnvironment({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    })).toEqual({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
    });
  });

  it('rejects partial authentication configuration', () => {
    expect(() => readAuthEnvironment({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
    })).toThrow('Authentication environment is incomplete');
  });
});

describe('readPushEnvironment', () => {
  it('allows push to remain disabled while auth is enabled', () => {
    expect(readPushEnvironment({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    })).toBeNull();
  });

  it('returns the public VAPID key when configured', () => {
    expect(readPushEnvironment({ VITE_VAPID_PUBLIC_KEY: 'public-key' }))
      .toEqual({ vapidPublicKey: 'public-key' });
  });
});

describe('assertProductionAuthEnvironment', () => {
  it.each([
    'http://localhost:54321',
    'http://127.0.0.1:54321',
    'http://[::1]:54321',
  ])('rejects loopback Supabase URL %s', supabaseUrl => {
    expect(() => assertProductionAuthEnvironment({
      VITE_SUPABASE_URL: supabaseUrl,
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    })).toThrow('Production Supabase URL must not use a loopback host');
  });

  it('rejects a browser service role variable', () => {
    expect(() => assertProductionAuthEnvironment({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
      VITE_SUPABASE_SERVICE_ROLE_KEY: 'secret',
    })).toThrow('Service role credentials must not be exposed to the browser');
  });

  it('accepts a hosted Supabase URL and anon key', () => {
    expect(assertProductionAuthEnvironment({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    }).supabaseUrl).toBe('https://example.supabase.co');
  });
});
```

- [ ] **Step 2: Run the focused environment tests and confirm the new API is missing**

Run:

```powershell
cd app
npm test -- src/infrastructure/cloud/cloud-environment.test.ts
```

Expected: FAIL because `readAuthEnvironment`, `readPushEnvironment`, and `assertProductionAuthEnvironment` are not exported.

- [ ] **Step 3: Implement the split environment readers and production guard**

Replace the combined reader with these exact public shapes and rules:

```ts
export interface AuthEnvironment {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export interface PushEnvironment {
  vapidPublicKey: string;
}

type BrowserEnvironment = Record<string, string | boolean | undefined>;

function value(env: BrowserEnvironment, key: string): string {
  return String(env[key] ?? '').trim();
}

export function readAuthEnvironment(env: BrowserEnvironment): AuthEnvironment | null {
  const supabaseUrl = value(env, 'VITE_SUPABASE_URL');
  const supabaseAnonKey = value(env, 'VITE_SUPABASE_ANON_KEY');
  if (!supabaseUrl && !supabaseAnonKey) return null;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Authentication environment is incomplete');
  }
  return { supabaseUrl, supabaseAnonKey };
}

export function readPushEnvironment(env: BrowserEnvironment): PushEnvironment | null {
  const vapidPublicKey = value(env, 'VITE_VAPID_PUBLIC_KEY');
  return vapidPublicKey ? { vapidPublicKey } : null;
}

export function assertProductionAuthEnvironment(env: BrowserEnvironment): AuthEnvironment {
  const exposedServiceRole = Object.entries(env).some(([key, raw]) =>
    key.startsWith('VITE_')
    && key.toUpperCase().includes('SERVICE_ROLE')
    && String(raw ?? '').trim().length > 0);
  if (exposedServiceRole) {
    throw new Error('Service role credentials must not be exposed to the browser');
  }

  const authentication = readAuthEnvironment(env);
  if (!authentication) throw new Error('Production authentication environment is required');

  let url: URL;
  try {
    url = new URL(authentication.supabaseUrl);
  } catch {
    throw new Error('Production Supabase URL must be a valid URL');
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    throw new Error('Production Supabase URL must not use a loopback host');
  }
  return authentication;
}
```

If existing push-monitor code still imports `readCloudEnvironment`, update those call sites to compose `readAuthEnvironment` and `readPushEnvironment`; do not restore VAPID as an authentication prerequisite.

- [ ] **Step 4: Update the Supabase client to consume only authentication configuration**

In `supabase-client.ts`, replace `readCloudEnvironment` with `readAuthEnvironment` and change the missing-config error to:

```ts
const environment = readAuthEnvironment(import.meta.env);
if (!environment) throw new Error('Authentication is not configured');
```

Keep these client options unchanged:

```ts
auth: {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
}
```

- [ ] **Step 5: Run focused tests and type checking**

Run:

```powershell
cd app
npm test -- src/infrastructure/cloud/cloud-environment.test.ts
npm run typecheck
```

Expected: environment tests PASS; typecheck PASS with all push-monitor imports using the split interfaces.

- [ ] **Step 6: Commit only the environment boundary files**

```powershell
git add app/src/infrastructure/cloud/cloud-environment.ts app/src/infrastructure/cloud/cloud-environment.test.ts app/src/infrastructure/cloud/supabase-client.ts
git commit -m "refactor: separate auth and push environment config"
```

---

### Task 2: Fail Unsafe Production Builds

**Files:**
- Modify: `app/vite.config.ts`
- Create: `app/.env.production.example`
- Test: `app/src/infrastructure/cloud/cloud-environment.test.ts`

**Interfaces:**
- Consumes: `assertProductionAuthEnvironment(env)` from Task 1.
- Produces: Vite production configuration that fails before bundling unsafe Supabase settings.

- [ ] **Step 1: Add a test for an anon key whose JWT payload identifies it as service role**

Add a helper in the test file and assert rejection:

```ts
function jwt(payload: object): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

it('rejects a service-role JWT passed as the anon key', () => {
  expect(() => assertProductionAuthEnvironment({
    VITE_SUPABASE_URL: 'https://example.supabase.co',
    VITE_SUPABASE_ANON_KEY: jwt({ role: 'service_role' }),
  })).toThrow('Service role credentials must not be exposed to the browser');
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```powershell
cd app
npm test -- src/infrastructure/cloud/cloud-environment.test.ts
```

Expected: FAIL because the current guard only checks variable names.

- [ ] **Step 3: Add JWT payload inspection without logging the credential**

Add a private helper in `cloud-environment.ts` that decodes only the middle JWT segment and returns `true` when `role === 'service_role'`. Wrap decoding and JSON parsing in `try/catch` and return `false` for opaque anon keys. Call it for `VITE_SUPABASE_ANON_KEY` inside `assertProductionAuthEnvironment`; throw the same browser-service-role error. Never include the key value in an exception.

Implementation shape:

```ts
function isServiceRoleJwt(token: string): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) return false;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = typeof atob === 'function'
      ? atob(normalized)
      : Buffer.from(normalized, 'base64').toString('utf8');
    return JSON.parse(decoded).role === 'service_role';
  } catch {
    return false;
  }
}
```

Use a runtime-safe implementation accepted by both Vite config execution and browser TypeScript compilation; if `Buffer` is retained, import it from `node:buffer` rather than assuming a browser global.

- [ ] **Step 4: Convert Vite configuration to mode-aware configuration**

Change imports and the outer configuration only; preserve every existing proxy entry exactly:

```ts
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { assertProductionAuthEnvironment } from './src/infrastructure/cloud/cloud-environment';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (mode === 'production') assertProductionAuthEnvironment(env);

  return {
    plugins: [react()],
    server: {
      proxy: {
        // retain all current proxy definitions unchanged
      },
    },
  };
});
```

This guard must execute for `npm run build`, while `npm run dev` continues to accept `app/.env.local` with `127.0.0.1`.

- [ ] **Step 5: Document the only public production variables in the example file**

Create `app/.env.production.example`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_PUBLIC_KEY
```

Do not add a VAPID variable to the authentication foundation example and do not add any service-role variable.

- [ ] **Step 6: Verify safe and unsafe build paths**

Run the safe build with temporary process variables so `.env.local` cannot supply the production URL:

```powershell
cd app
$env:VITE_SUPABASE_URL='https://example.supabase.co'
$env:VITE_SUPABASE_ANON_KEY='test-anon-key'
npm run build
Remove-Item Env:VITE_SUPABASE_URL
Remove-Item Env:VITE_SUPABASE_ANON_KEY
```

Expected: PASS.

Then run:

```powershell
cd app
$env:VITE_SUPABASE_URL='http://127.0.0.1:54321'
$env:VITE_SUPABASE_ANON_KEY='test-anon-key'
npm run build
Remove-Item Env:VITE_SUPABASE_URL
Remove-Item Env:VITE_SUPABASE_ANON_KEY
```

Expected: build exits non-zero with `Production Supabase URL must not use a loopback host`.

- [ ] **Step 7: Commit the production build guard**

```powershell
git add app/vite.config.ts app/.env.production.example app/src/infrastructure/cloud/cloud-environment.ts app/src/infrastructure/cloud/cloud-environment.test.ts
git commit -m "build: reject unsafe production auth config"
```

---

### Task 3: Protect Securities Routes and Complete the Login UX

**Files:**
- Modify: `app/src/features/auth/AuthProvider.tsx`
- Modify: `app/src/features/auth/AuthProvider.test.tsx`
- Modify: `app/src/features/auth/RequireAuth.tsx`
- Modify: `app/src/features/auth/LoginPage.tsx`
- Modify: `app/src/features/auth/LoginPage.test.tsx`
- Modify: `app/src/app/router.tsx`
- Modify: `app/src/app/router-auth.test.tsx`

**Interfaces:**
- Produces: `AuthContextValue.configurationError: string | null`.
- Produces: `protectSecuritiesRoutes(routes: RouteObject[]): RouteObject[]`.
- Consumes: `readAuthEnvironment` and `getSupabaseClient` from Task 1.
- Explicit exclusion: no import or rendering of `SecuritiesDataSourceProvider` or `SecuritiesRouteBoundary`.

- [ ] **Step 1: Add AuthProvider tests for VAPID-independent auth and missing configuration**

Mock `readAuthEnvironment` and `getSupabaseClient`. Add assertions that:

```ts
expect(screen.getByTestId('cloud-enabled')).toHaveTextContent('true');
expect(screen.getByTestId('configuration-error')).toHaveTextContent('');
```

when auth URL/key exist without VAPID, and:

```ts
expect(screen.getByTestId('cloud-enabled')).toHaveTextContent('false');
expect(screen.getByTestId('configuration-error'))
  .toHaveTextContent('Authentication is not configured');
```

when `readAuthEnvironment` returns `null`. Keep the existing session restoration and auth-state subscription expectations.

- [ ] **Step 2: Add route tests for every securities route family**

Use a mutable hoisted auth state in `router-auth.test.tsx`. Add three cases:

```ts
it.each([
  '/securities',
  '/securities/watchlist',
  '/securities/stock/600519',
  '/projects/project-a/securities',
  '/projects/project-a/securities/portfolio',
])('redirects unauthenticated access to login from %s', async path => {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole('heading', { name: '登录证券账户' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/login');
  expect(router.state.location.state).toEqual({ from: path });
});

it('does not protect the investment research project list', async () => {
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] });
  render(<RouterProvider router={router} />);
  expect(router.state.location.pathname).toBe('/');
});
```

Add an authenticated case that `/securities/watchlist` does not redirect. Mock heavy page components if needed, but do not change their production code.

- [ ] **Step 3: Add LoginPage tests for configuration, recovery, verification, and return navigation**

Extend the mocked context with `configurationError`. Add cases asserting:

```ts
expect(screen.getByRole('alert'))
  .toHaveTextContent('证券账户服务尚未配置，请联系管理员');
```

when auth is disabled; `正在恢复账户会话…` when `loading` is true; `注册成功，请查收验证邮件后再登录` after successful registration; and location `/securities/watchlist` after a successful login from a `/login` entry with state `{ from: '/securities/watchlist' }`.

- [ ] **Step 4: Run the auth-focused tests and confirm failures**

Run:

```powershell
cd app
npm test -- src/features/auth/AuthProvider.test.tsx src/features/auth/LoginPage.test.tsx src/app/router-auth.test.tsx
```

Expected: FAIL because `configurationError`, route wrapping, and new copy are absent.

- [ ] **Step 5: Make AuthProvider expose configuration state without crashing render**

Add to `AuthContextValue`:

```ts
configurationError: string | null;
```

Resolve configuration once:

```ts
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
```

Set `cloudEnabled = configuration.environment !== null`, expose `configurationError: configuration.error`, and change `requireCloud()` to throw `configuration.error ?? 'Authentication is not configured'`. Preserve `persistSession`, automatic token refresh, `getSession()`, and `onAuthStateChange()` behavior.

- [ ] **Step 6: Make RequireAuth fail closed and preserve the full target**

Remove optional provider fall-through. Use the normal `useAuth()` call and implement:

```tsx
if (auth.loading) return <div role="status">正在恢复账户会话…</div>;
if (!auth.cloudEnabled || !auth.user) {
  const from = `${location.pathname}${location.search}${location.hash}`;
  return <Navigate to="/login" replace state={{ from }} />;
}
return children;
```

The application already mounts `AuthProvider` in `app/src/main.tsx`; missing provider is a programming error and must not expose protected pages.

- [ ] **Step 7: Make LoginPage render stable auth states**

Apply these rules in order:

1. While `auth.loading`, show `正在恢复账户会话…` and do not render or redirect.
2. When `!auth.cloudEnabled`, render the login card with an alert `证券账户服务尚未配置，请联系管理员` and include the non-sensitive `configurationError`; do not redirect to `/securities`.
3. When `auth.user`, navigate to the validated `destination`, not always `/securities`.
4. After registration, show `注册成功，请查收验证邮件后再登录`, clear the password, and return to login mode.
5. Continue to require a valid email and at least 8 password characters.
6. Password reset continues to use `${window.location.origin}/login?reset=1` through `AuthProvider`.

Only accept `location.state.from` when it starts with `/securities` or contains `/securities/`; otherwise use `/securities`. This prevents an arbitrary external destination from being used as a post-login redirect.

- [ ] **Step 8: Recursively wrap securities route elements only**

In `router.tsx`, import `RequireAuth` and add:

```tsx
function isSecuritiesPath(path: string | undefined): boolean {
  return path?.split('/').includes('securities') ?? false;
}

export function protectSecuritiesRoutes(routes: RouteObject[]): RouteObject[] {
  return routes.map(route => ({
    ...route,
    element: route.element && isSecuritiesPath(route.path)
      ? <RequireAuth>{route.element}</RequireAuth>
      : route.element,
    children: route.children ? protectSecuritiesRoutes(route.children) : undefined,
  }));
}

export const appRoutes: RouteObject[] = [
  ...protectSecuritiesRoutes(baseAppRoutes),
  { path: '/login', element: <LoginPage /> },
];
```

Do not add a provider around the routes. Do not alter `router-base.tsx` page components.

- [ ] **Step 9: Run auth tests, local-first route regression, and type checking**

Run:

```powershell
cd app
npm test -- src/features/auth/AuthProvider.test.tsx src/features/auth/LoginPage.test.tsx src/app/router-auth.test.tsx src/app/router-local-first.test.tsx
npm run typecheck
```

Expected: all selected tests PASS and typecheck PASS. If `router-local-first.test.tsx` encodes the obsolete unauthenticated pass-through, update that test to assert the new login redirect; do not restore pass-through behavior.

- [ ] **Step 10: Commit only authentication and routing files**

```powershell
git add app/src/features/auth/AuthProvider.tsx app/src/features/auth/AuthProvider.test.tsx app/src/features/auth/RequireAuth.tsx app/src/features/auth/LoginPage.tsx app/src/features/auth/LoginPage.test.tsx app/src/app/router.tsx app/src/app/router-auth.test.tsx app/src/app/router-local-first.test.tsx
git commit -m "feat: protect securities workspace with account login"
```

---

### Task 4: Bootstrap a Profile for Every Verified Account

**Files:**
- Create: `app/supabase/migrations/202608070007_auth_profile_bootstrap.sql`
- Create: `app/supabase/tests/auth_profile_bootstrap.test.sql`

**Interfaces:**
- Produces: `public.handle_new_user() returns trigger`.
- Produces: `on_auth_user_created` trigger on `auth.users`.
- Relies on: existing `public.profiles(user_id, timezone, migration_status, created_at, updated_at)` and its RLS policy.

- [ ] **Step 1: Write the pgTAP test for profile lifecycle and RLS**

Create the test with a transaction, `pgtap`, two fixed users, and these assertions:

```sql
begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

select has_function('public', 'handle_new_user', array[]::text[], 'profile bootstrap function exists');
select has_trigger('auth', 'users', 'on_auth_user_created', 'auth user trigger exists');

insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-000000000071', 'profile-a@example.com'),
  ('00000000-0000-0000-0000-000000000072', 'profile-b@example.com');

select is(
  (select count(*)::integer from public.profiles
   where user_id in (
     '00000000-0000-0000-0000-000000000071',
     '00000000-0000-0000-0000-000000000072'
   )),
  2,
  'creates one profile for every auth user'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000071', true);

select is(
  (select count(*)::integer from public.profiles),
  1,
  'authenticated user can select only their profile'
);

select throws_ok(
  $$ update public.profiles
     set timezone = 'UTC'
     where user_id = '00000000-0000-0000-0000-000000000072' $$,
  'new row violates row-level security policy for table "profiles"',
  'authenticated user cannot update another profile'
);

reset role;
delete from auth.users where id = '00000000-0000-0000-0000-000000000071';

select is(
  (select count(*)::integer from public.profiles
   where user_id = '00000000-0000-0000-0000-000000000071'),
  0,
  'deleting auth user cascades to profile'
);

select * from finish();
rollback;
```

If the exact PostgreSQL RLS error text differs locally, use `throws_like` with `%row-level security%` while preserving the ownership assertion.

- [ ] **Step 2: Run the database test and confirm the function/trigger are missing**

Run:

```powershell
cd app
npx supabase test db app/supabase/tests/auth_profile_bootstrap.test.sql
```

If the installed CLI does not accept a file argument, run:

```powershell
cd app
npx supabase test db
```

Expected: FAIL on the missing function or trigger.

- [ ] **Step 3: Implement an idempotent security-definer trigger**

Create migration:

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (user_id)
select users.id
from auth.users as users
on conflict (user_id) do nothing;
```

The final backfill makes deployment safe for accounts created before this migration. Do not copy email, password, token, or auth metadata into `profiles`.

- [ ] **Step 4: Run all Supabase database tests**

Run:

```powershell
cd app
npx supabase db reset
npx supabase test db
```

Expected: all pgTAP suites PASS, including existing signal, watchlist, position, migration, alert, and worker-permission tests.

- [ ] **Step 5: Commit the profile bootstrap migration and test**

```powershell
git add app/supabase/migrations/202608070007_auth_profile_bootstrap.sql app/supabase/tests/auth_profile_bootstrap.test.sql
git commit -m "feat: bootstrap profiles for auth users"
```

---

### Task 5: Add Netlify SPA Routing and Deployment Runbook

**Files:**
- Create: `app/public/_redirects`
- Create: `docs/deployment/netlify-supabase-auth.md`

**Interfaces:**
- Consumes: production build guard from Task 2 and protected routes from Task 3.
- Produces: Netlify-compatible deep-link deployment instructions and a reproducible acceptance checklist.

- [ ] **Step 1: Add the Netlify SPA fallback**

Create `app/public/_redirects` with exactly:

```text
/* /index.html 200
```

- [ ] **Step 2: Write the deployment runbook with exact dashboard settings**

Create `docs/deployment/netlify-supabase-auth.md` containing these sections and values:

```markdown
# Netlify + Supabase 证券账户部署

## 1. Supabase 项目

1. 新建线上 Supabase 项目。
2. 在 Authentication → Providers → Email 中开启邮箱注册和邮箱验证。
3. 在 Authentication → URL Configuration 中设置：
   - Site URL：`https://<site>.netlify.app`
   - Redirect URL：`https://<site>.netlify.app/login`
   - Redirect URL：`https://<site>.netlify.app/login?reset=1`
   - Redirect URL：`http://localhost:5173/login`
4. 保存 Project URL 和 anon public key。不要复制 service_role key 到前端或 Netlify。
5. 在 `app` 目录执行 `npx supabase link --project-ref <project-ref>` 和 `npx supabase db push`。

## 2. Netlify 构建

- Base directory：`app`
- Build command：`npm run build`
- Publish directory：`dist`
- 环境变量 `VITE_SUPABASE_URL`：线上 Supabase Project URL
- 环境变量 `VITE_SUPABASE_ANON_KEY`：线上 Supabase anon public key

不要在 Netlify 设置任何以 `VITE_` 开头的 service role、数据库密码或邮件服务密码。

## 3. 手动上传 dist

在 `app` 目录设置线上公开变量后运行 `npm run build`，然后只上传 `app/dist`。直接上传旧 dist 会继续携带旧构建时的地址。

## 4. 验收

1. 确认 `dist/_redirects` 存在。
2. 搜索 `dist/assets`，确认不包含 `127.0.0.1`、`localhost` 或 `service_role`。
3. 未登录打开 `/securities/watchlist`，应跳到 `/login`。
4. 注册新邮箱，应收到验证邮件；未验证前不能完成登录。
5. 验证后登录，应进入 `/securities` 或登录前的证券路径。
6. 刷新 `/securities/stock/600519`，Netlify 不应返回 404。
7. 两个不同邮箱同时登录时，会话互不覆盖。
8. 同一邮箱在两个浏览器登录时，两边会话都保持有效。
```

Also state that fund data repair and securities personal-data migration are outside this batch.

- [ ] **Step 3: Build and inspect the generated production directory**

Run:

```powershell
cd app
$env:VITE_SUPABASE_URL='https://example.supabase.co'
$env:VITE_SUPABASE_ANON_KEY='test-anon-key'
npm run build
Test-Path dist/_redirects
rg -n "127\.0\.0\.1|localhost|service_role" dist/assets
Remove-Item Env:VITE_SUPABASE_URL
Remove-Item Env:VITE_SUPABASE_ANON_KEY
```

Expected: build PASS; `Test-Path` prints `True`; `rg` returns no matches. If another unrelated application feature intentionally contains the display word `localhost`, narrow the scan to Supabase URLs and record the exact non-secret match in the deployment document.

- [ ] **Step 4: Run the batch acceptance suite**

Run:

```powershell
cd app
npm test -- src/infrastructure/cloud/cloud-environment.test.ts src/features/auth/AuthProvider.test.tsx src/features/auth/LoginPage.test.tsx src/app/router-auth.test.tsx src/app/router-local-first.test.tsx
npm run typecheck
npm run lint
npx supabase test db
```

Expected: all selected frontend tests PASS, typecheck PASS, lint PASS, and all pgTAP tests PASS.

- [ ] **Step 5: Review the diff for forbidden scope expansion**

Run:

```powershell
git diff --name-only HEAD~4..HEAD
git status --short
```

Confirm no files under these areas were changed by this batch:

```text
app/src/features/securities/StockAnalysisPage.tsx
app/src/engines/market-analysis/
app/src/features/securities/FundAnalysisPage.tsx
app/src/features/securities/cloud/SecuritiesDataSourceProvider.tsx
```

Do not discard unrelated pre-existing working-tree changes.

- [ ] **Step 6: Commit the Netlify deployment foundation**

```powershell
git add app/public/_redirects docs/deployment/netlify-supabase-auth.md
git commit -m "docs: add netlify supabase auth deployment runbook"
```

---

## Completion Gate

This batch is complete only when all statements below are true:

- Authentication works with Supabase URL and anon key even when Web Push/VAPID is not configured.
- A production build cannot succeed with missing, loopback, or service-role Supabase configuration.
- Every securities route family redirects unauthenticated users to `/login` and restores the original securities destination after login.
- Authentication protection does not replace the current securities data source and does not modify individual-stock analysis.
- Registration tells the user to verify their email instead of claiming immediate password login is available.
- Every newly inserted `auth.users` row receives exactly one `profiles` row, and RLS prevents cross-account profile access.
- Netlify deep links refresh through `dist/_redirects` without a 404.
- The production bundle contains no local Supabase URL or service-role credential.
- Existing unrelated working-tree changes remain untouched and unstaged by these commits.
