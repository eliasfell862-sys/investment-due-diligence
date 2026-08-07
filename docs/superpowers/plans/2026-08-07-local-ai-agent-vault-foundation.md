# Local AI Agent Vault Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立左侧 AI Agent 配置入口、本机加密 API Key 密钥库、默认/覆盖模型配置、统一 AI Gateway 和安全的旧配置迁移闭环。

**Architecture:** 使用独立 Dexie 数据库保存按用户命名空间隔离的加密密钥库记录，Web Crypto 负责 PBKDF2 + AES-GCM，加密后的 Key 持久化而明文仅保存在 React Provider 内存中。AI Gateway 根据任务标识解析“功能覆盖 → 全站默认”，通过统一 OpenAI 兼容适配器调用八类供应商；本批只迁移 `ResearchPage` 作为端到端样板，其余 AI 调用在第二批迁移计划中逐项替换。

**Tech Stack:** React 19、React Router 7、TypeScript 6、Dexie 4、Web Crypto、Vitest、Testing Library、fake-indexeddb、Vite 8

## Global Constraints

- 不使用子代理；实施时使用 `executing-plans` skill 在当前会话分批执行。
- API Key 仅保存在当前电脑的当前浏览器配置文件，不上传 Supabase，不跨设备或跨浏览器同步。
- API Key、密钥库密码、派生密钥和 Authorization 请求头不得进入 localStorage、Supabase、日志、错误提示或构建产物。
- PBKDF2 使用 SHA-256、随机 salt 和 310,000 次迭代；AES-GCM 使用 256 位密钥和 96 位随机 IV。
- 密钥库密码至少 10 位；连续 5 次失败后锁定 30 秒；刷新、退出登录、会话失效或后台 30 分钟后重新锁定。
- 左侧主导航新增 `03 AI Agent 配置`，顶层路由为 `/ai-agents`，生产环境必须登录后访问。
- 首版供应商：DeepSeek、Kimi、通义千问、智谱 GLM、豆包、OpenAI、Ollama、自定义 OpenAI 兼容接口。
- 配置解析顺序固定为“精确任务 → 功能覆盖组 → 全站默认”；首版 UI 只编辑全站默认、投研尽调 AI 和证券分析 AI。
- 自定义远程 Endpoint 必须使用 HTTPS；只有 Ollama 允许 `http://localhost` 和 `http://127.0.0.1`。
- 本批不修改 `StockAnalysisPage`、个股行情/K 线、估值、风险、回测、基金、债券和 ETF 数据接口。
- 旧 `dd-research-config` 只有在加密写入和校验成功后才删除；迁移失败必须保留旧配置。
- 工作区包含用户和其他模型的未提交改动；每次提交只暂存任务明确列出的文件。

---

## File Structure

- `app/src/features/ai-agents/types.ts`：供应商、任务、配置、密钥描述和 Gateway 公共类型。
- `app/src/features/ai-agents/provider-presets.ts`：八类供应商预设、默认模型和 Endpoint 验证。
- `app/src/features/ai-agents/config-resolution.ts`：任务到功能组映射和配置继承解析。
- `app/src/features/ai-agents/vault-crypto.ts`：PBKDF2、AES-GCM、Base64 编解码和密码校验。
- `app/src/features/ai-agents/ai-vault-db.ts`：独立 Dexie 密钥库数据库和按命名空间 CRUD。
- `app/src/features/ai-agents/ai-vault-service.ts`：创建、解锁、保存、改密和清空密钥库。
- `app/src/features/ai-agents/AiVaultProvider.tsx`：会话内明文 Key、自动锁定和登录用户命名空间。
- `app/src/features/ai-agents/useAiVault.ts`：Context 消费入口，避免 Provider 文件导出非组件。
- `app/src/features/ai-agents/ai-provider-adapter.ts`：OpenAI 兼容请求、响应和错误规范化。
- `app/src/features/ai-agents/ai-gateway.ts`：配置解析、密钥读取、任务执行和连接测试。
- `app/src/features/ai-agents/AiAgentSettingsPage.tsx`：密钥库、默认配置、覆盖配置和连接测试 UI。
- `app/src/features/ai-agents/legacy-config-migration.ts`：旧 `dd-research-config` 检测、确认迁移和核验删除。
- `app/src/features/research/ResearchPage.tsx`：移除页面内 API Key 表单，改用统一 Gateway。
- `app/src/app/AppShellBase.tsx`：增加 `03 AI Agent 配置` 导航。
- `app/src/app/router-base.tsx`：注册 `/ai-agents` 页面。
- `app/src/app/router.tsx`：将 `/ai-agents` 纳入登录保护。
- `app/src/main.tsx`：在 `AuthProvider` 内挂载 `AiVaultProvider`。

---

### Task 1: Define Provider Presets and Configuration Resolution

**Files:**
- Create: `app/src/features/ai-agents/types.ts`
- Create: `app/src/features/ai-agents/provider-presets.ts`
- Create: `app/src/features/ai-agents/provider-presets.test.ts`
- Create: `app/src/features/ai-agents/config-resolution.ts`
- Create: `app/src/features/ai-agents/config-resolution.test.ts`

**Interfaces:**
- Produces: `AiProviderId`, `AiTaskId`, `AiFeatureGroup`, `AiModelProfile`, `AiAgentSettings`, `AiSecretDescriptor`.
- Produces: `AI_PROVIDER_PRESETS`, `validateAiEndpoint(profile)`.
- Produces: `resolveAiModelProfile(settings, taskId)`.
- Consumed by: vault service, settings UI and AI Gateway.

- [ ] **Step 1: Write failing provider and inheritance tests**

Create tests that assert all provider IDs exist, Ollama is the only preset that does not need a Key, remote HTTP is rejected, local Ollama HTTP is accepted, and task inheritance is deterministic:

```ts
expect(Object.keys(AI_PROVIDER_PRESETS)).toEqual([
  'deepseek', 'kimi', 'qwen', 'glm', 'doubao', 'openai', 'ollama', 'custom',
]);
expect(AI_PROVIDER_PRESETS.ollama.needsKey).toBe(false);
expect(() => validateAiEndpoint({
  providerId: 'custom', model: 'model-a', endpoint: 'http://example.com/v1/chat/completions',
  temperature: 0.3, maxOutputTokens: 2000,
})).toThrow('远程 AI Endpoint 必须使用 HTTPS');
expect(validateAiEndpoint({
  providerId: 'ollama', model: 'qwen2.5:14b', endpoint: 'http://localhost:11434/v1/chat/completions',
  temperature: 0.3, maxOutputTokens: 2000,
})).toBeUndefined();
```

```ts
const resolved = resolveAiModelProfile(settings, 'securities.watchlist');
expect(resolved.source).toBe('feature_override');
expect(resolved.profile.model).toBe('deepseek-chat');
expect(resolveAiModelProfile(settings, 'due_diligence.research').profile.model)
  .toBe(settings.defaultProfile.model);
```

- [ ] **Step 2: Run tests and verify missing modules fail**

Run:

```powershell
cd app
npm test -- src/features/ai-agents/provider-presets.test.ts src/features/ai-agents/config-resolution.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Define the exact domain types**

Create:

```ts
export type AiProviderId =
  | 'deepseek' | 'kimi' | 'qwen' | 'glm'
  | 'doubao' | 'openai' | 'ollama' | 'custom';

export type AiFeatureGroup = 'due_diligence' | 'securities';

export type AiTaskId =
  | 'due_diligence.reasoning'
  | 'due_diligence.research'
  | 'document.extraction'
  | 'securities.stock_analysis'
  | 'securities.watchlist'
  | 'securities.portfolio'
  | 'securities.multi_agent';

export interface AiModelProfile {
  providerId: AiProviderId;
  model: string;
  endpoint: string;
  temperature: number;
  maxOutputTokens: number;
  secretId?: string;
}

export interface AiConnectionStatus {
  verifiedAt: string;
  latencyMs: number;
  actualModel: string;
}

export interface AiAgentSettings {
  defaultProfile: AiModelProfile;
  featureOverrides: Partial<Record<AiFeatureGroup, AiModelProfile>>;
  connectionStatuses: Partial<Record<AiFeatureGroup | 'default', AiConnectionStatus>>;
  updatedAt: string;
}

export interface AiSecretDescriptor {
  id: string;
  providerId: AiProviderId;
  lastFour: string;
}
```

- [ ] **Step 4: Implement presets and endpoint validation**

Use production API endpoints and these default models:

```ts
deepseek: deepseek-chat
kimi: moonshot-v1-8k
qwen: qwen-plus
glm: glm-4-flash
doubao: doubao-pro-32k
openai: gpt-4o-mini
ollama: qwen2.5:14b
custom: empty model and endpoint
```

Each preset exposes `id`, `label`, `endpoint`, `defaultModel`, `needsKey`, and `browserDirect`. `validateAiEndpoint` parses `new URL(profile.endpoint)`, rejects invalid URLs, rejects remote HTTP, and permits HTTP only when `providerId === 'ollama'` and hostname is `localhost`, `127.0.0.1`, `::1`, or `[::1]`.

- [ ] **Step 5: Implement task-to-group inheritance**

Define:

```ts
const TASK_FEATURE_GROUPS: Record<AiTaskId, AiFeatureGroup> = {
  'due_diligence.reasoning': 'due_diligence',
  'due_diligence.research': 'due_diligence',
  'document.extraction': 'due_diligence',
  'securities.stock_analysis': 'securities',
  'securities.watchlist': 'securities',
  'securities.portfolio': 'securities',
  'securities.multi_agent': 'securities',
};

export interface ResolvedAiModelProfile {
  profile: AiModelProfile;
  source: 'feature_override' | 'default';
  featureGroup: AiFeatureGroup;
}
```

`resolveAiModelProfile` returns the feature override when present and otherwise the default. Do not embed fallback models in this resolver.

- [ ] **Step 6: Run tests and type checking**

```powershell
cd app
npm test -- src/features/ai-agents/provider-presets.test.ts src/features/ai-agents/config-resolution.test.ts
npm run typecheck
```

Expected: tests and typecheck PASS.

- [ ] **Step 7: Commit the domain boundary**

```powershell
git add app/src/features/ai-agents/types.ts app/src/features/ai-agents/provider-presets.ts app/src/features/ai-agents/provider-presets.test.ts app/src/features/ai-agents/config-resolution.ts app/src/features/ai-agents/config-resolution.test.ts
git commit -m "feat: define ai agent provider configuration"
```

---

### Task 2: Build the Encrypted Local Vault

**Files:**
- Create: `app/src/features/ai-agents/vault-crypto.ts`
- Create: `app/src/features/ai-agents/vault-crypto.test.ts`
- Create: `app/src/features/ai-agents/ai-vault-db.ts`
- Create: `app/src/features/ai-agents/ai-vault-db.test.ts`
- Create: `app/src/features/ai-agents/ai-vault-service.ts`
- Create: `app/src/features/ai-agents/ai-vault-service.test.ts`

**Interfaces:**
- Produces: `deriveVaultKey`, `encryptVaultPayload`, `decryptVaultPayload`.
- Produces: `AiVaultRecord`, `AiVaultDatabase`, `getVaultRecord`, `putVaultRecord`, `deleteVaultRecord`.
- Produces: `createAiVault`, `unlockAiVault`, `saveAiVault`, `changeAiVaultPassword`, `clearAiVault`.
- Consumes: `AiAgentSettings`, `AiSecretDescriptor` from Task 1.

- [ ] **Step 1: Write crypto tests with fixed behavior, not fixed ciphertext**

Test:

- correct password round trip;
- wrong password rejects with `密钥库密码错误`;
- same payload encrypted twice produces different IV/ciphertext;
- persisted JSON does not contain `sk-sensitive-value`;
- passwords shorter than 10 characters are rejected.

Use `globalThis.crypto.subtle` and deterministic test payloads, but never mock `crypto.getRandomValues` to a constant in the ciphertext uniqueness test.

- [ ] **Step 2: Write database and service tests**

With `fake-indexeddb/auto`, assert:

```ts
await createAiVault('user-a', 'vault-pass-123', initialSettings);
expect(await hasAiVault('user-a')).toBe(true);
expect(await hasAiVault('user-b')).toBe(false);

const unlocked = await unlockAiVault('user-a', 'vault-pass-123');
expect(unlocked.settings).toEqual(initialSettings);
expect(unlocked.secrets).toEqual({});
```

After adding a Key and saving, read the raw Dexie row and assert `JSON.stringify(row)` does not contain the plaintext Key. Test password change by proving the old password fails and the new password succeeds. Test clear by proving the namespace row is deleted.

- [ ] **Step 3: Run tests and verify missing modules fail**

```powershell
cd app
npm test -- src/features/ai-agents/vault-crypto.test.ts src/features/ai-agents/ai-vault-db.test.ts src/features/ai-agents/ai-vault-service.test.ts
```

Expected: FAIL because the vault modules do not exist.

- [ ] **Step 4: Implement versioned crypto envelopes**

Define:

```ts
export interface EncryptedPayload {
  algorithmVersion: 1;
  iv: string;
  ciphertext: string;
}

export interface VaultKdfConfig {
  algorithm: 'PBKDF2-SHA256';
  iterations: 310000;
  salt: string;
}
```

Encode strings with `TextEncoder`, decode with `TextDecoder`, and convert binary values to/from Base64 without Node-only APIs. `deriveVaultKey(password, salt)` imports raw password material and derives a non-extractable AES-GCM 256-bit `CryptoKey` with `encrypt` and `decrypt` usages.

The verifier plaintext is the fixed string `investment-dd-ai-vault-v1`. Map AES-GCM decryption failure to `密钥库密码错误` without returning partial plaintext.

- [ ] **Step 5: Implement the independent Dexie database**

Create database name `investment-dd-ai-vault` with one `vaults` table keyed by `namespace`:

```ts
export interface AiVaultRecord {
  namespace: string;
  version: 1;
  kdf: VaultKdfConfig;
  verifier: EncryptedPayload;
  encryptedSecrets: EncryptedPayload;
  settings: AiAgentSettings;
  secretDescriptors: AiSecretDescriptor[];
  updatedAt: string;
}
```

Keep Key plaintext out of `AiVaultRecord`. Export repository functions rather than exposing Dexie calls to UI components.

- [ ] **Step 6: Implement atomic vault operations**

Define the unlocked return value:

```ts
export interface UnlockedAiVault {
  namespace: string;
  key: CryptoKey;
  settings: AiAgentSettings;
  secrets: Record<string, string>;
  secretDescriptors: AiSecretDescriptor[];
}
```

`createAiVault` validates password length, creates salt, derives key, encrypts verifier and `{}` secrets, and writes one row. `saveAiVault` re-encrypts the entire secrets map with a new IV and replaces the row in one Dexie transaction. `changeAiVaultPassword` decrypts with the old password, creates a new salt/key/verifier, re-encrypts secrets, and writes once. `clearAiVault` deletes only the exact namespace.

- [ ] **Step 7: Run vault tests and inspect persisted records**

```powershell
cd app
npm test -- src/features/ai-agents/vault-crypto.test.ts src/features/ai-agents/ai-vault-db.test.ts src/features/ai-agents/ai-vault-service.test.ts
npm run typecheck
```

Expected: tests and typecheck PASS; raw record assertions find no plaintext Key.

- [ ] **Step 8: Commit the encrypted vault**

```powershell
git add app/src/features/ai-agents/vault-crypto.ts app/src/features/ai-agents/vault-crypto.test.ts app/src/features/ai-agents/ai-vault-db.ts app/src/features/ai-agents/ai-vault-db.test.ts app/src/features/ai-agents/ai-vault-service.ts app/src/features/ai-agents/ai-vault-service.test.ts
git commit -m "feat: add encrypted local ai key vault"
```

---

### Task 3: Manage the Unlocked Vault Session

**Files:**
- Create: `app/src/features/ai-agents/AiVaultProvider.tsx`
- Create: `app/src/features/ai-agents/useAiVault.ts`
- Create: `app/src/features/ai-agents/AiVaultProvider.test.tsx`
- Modify: `app/src/main.tsx`

**Interfaces:**
- Produces: `AiVaultContextValue` and `useAiVault()`.
- Produces: `createVault`, `unlock`, `lock`, `saveSettings`, `setSecret`, `removeSecret`, `changePassword`, `clearVault`, `resolveSecret`.
- Consumes: `useAuth()` and Task 2 vault service.
- Consumed by: settings page, legacy migration and Gateway.

- [ ] **Step 1: Write Provider lifecycle tests**

Test these states:

- namespace is current `auth.user.id`;
- different user ID immediately locks and loads the other namespace status;
- `lock()` clears `resolveSecret()` access;
- document hidden for 30 minutes triggers lock;
- `SIGNED_OUT` state (`auth.user === null`) locks;
- five failed unlocks set `retryAfter` about 30 seconds in the future;
- successful unlock resets failure count;
- refresh starts locked even when an encrypted row exists.

Mock time with `vi.useFakeTimers()` only for inactivity and retry delay cases.

- [ ] **Step 2: Run Provider tests and verify failure**

```powershell
cd app
npm test -- src/features/ai-agents/AiVaultProvider.test.tsx
```

Expected: FAIL because the Provider does not exist.

- [ ] **Step 3: Define the Context contract**

```ts
export interface AiVaultContextValue {
  namespace: string | null;
  exists: boolean;
  locked: boolean;
  loading: boolean;
  retryAfter: number | null;
  settings: AiAgentSettings | null;
  secretDescriptors: AiSecretDescriptor[];
  createVault(password: string, settings: AiAgentSettings): Promise<void>;
  unlock(password: string): Promise<void>;
  lock(): void;
  saveSettings(settings: AiAgentSettings): Promise<void>;
  setSecret(secretId: string, providerId: AiProviderId, value: string): Promise<void>;
  removeSecret(secretId: string): Promise<void>;
  changePassword(oldPassword: string, newPassword: string): Promise<void>;
  clearVault(): Promise<void>;
  resolveSecret(secretId: string): string | null;
}
```

- [ ] **Step 4: Implement session-only plaintext handling**

Store the unlocked `CryptoKey` and secrets map in refs, never React DevTools-visible state. State contains only settings, descriptors and lock status. `resolveSecret` reads the ref only when unlocked. `lock` overwrites the secrets ref with `{}`, clears the CryptoKey ref, and resets settings/descriptors from memory.

Use `user.id` when authenticated. Do not activate `local-guest` in the production authenticated flow; keep a `resolveVaultNamespace(userId)` helper capable of returning `local-guest` only when an explicit future local mode passes `allowGuest: true`.

- [ ] **Step 5: Implement auto-lock and failure delay**

Listen to `visibilitychange`. Record the timestamp when hidden and lock when visible after at least `30 * 60 * 1000` ms. Lock immediately when namespace changes or becomes null. After five failed password attempts, reject unlock calls until `Date.now() >= retryAfter` with `尝试次数过多，请稍后再试`.

- [ ] **Step 6: Mount the Provider inside authentication**

Change `main.tsx` from:

```tsx
<AuthProvider><App /></AuthProvider>
```

to:

```tsx
<AuthProvider>
  <AiVaultProvider>
    <App />
  </AiVaultProvider>
</AuthProvider>
```

This ensures the vault can observe auth changes but no authentication code depends on the vault.

- [ ] **Step 7: Run Provider, auth and type tests**

```powershell
cd app
npm test -- src/features/ai-agents/AiVaultProvider.test.tsx src/features/auth/AuthProvider.test.tsx
npm run typecheck
```

Expected: tests and typecheck PASS.

- [ ] **Step 8: Commit the vault session Provider**

```powershell
git add app/src/features/ai-agents/AiVaultProvider.tsx app/src/features/ai-agents/useAiVault.ts app/src/features/ai-agents/AiVaultProvider.test.tsx app/src/main.tsx
git commit -m "feat: manage unlocked ai vault sessions"
```

---

### Task 4: Implement the AI Gateway and Connection Test

**Files:**
- Create: `app/src/features/ai-agents/ai-provider-adapter.ts`
- Create: `app/src/features/ai-agents/ai-provider-adapter.test.ts`
- Create: `app/src/features/ai-agents/ai-gateway.ts`
- Create: `app/src/features/ai-agents/ai-gateway.test.ts`

**Interfaces:**
- Produces: `AiGatewayErrorCode`, `AiGatewayError`, `executeAiTask`, `testAiConnection`.
- Consumes: Task 1 profile resolver and Task 3 secret resolver.
- Consumed by: settings page and ResearchPage.

- [ ] **Step 1: Write adapter request and error tests**

Assert:

- cloud providers send `Authorization: Bearer <key>`;
- Ollama sends no Authorization header;
- request includes configured model, temperature and max token limit;
- 401 → `invalid_key`;
- 403 → `permission_denied`;
- 404 → `model_not_found`;
- 429 → `rate_limited`;
- timeout AbortError → `timeout`;
- `TypeError: Failed to fetch` with an online browser → `cors_blocked`;
- invalid response body → `invalid_response`.

Test errors by code and Chinese user message; never assert or include the test Key in an error snapshot.

- [ ] **Step 2: Write Gateway resolution tests**

Create a fake runtime:

```ts
const runtime = {
  settings,
  resolveSecret: (id: string) => id === 'secret-default' ? 'sk-test-value' : null,
  fetchImpl: vi.fn(),
};
```

Assert securities tasks use the securities override, due-diligence tasks inherit default, locked runtime throws `vault_locked`, missing Key throws `missing_key`, and the connection test sends only the fixed `Return exactly: OK` prompt.

- [ ] **Step 3: Run tests and verify missing modules fail**

```powershell
cd app
npm test -- src/features/ai-agents/ai-provider-adapter.test.ts src/features/ai-agents/ai-gateway.test.ts
```

Expected: FAIL because adapter and Gateway are absent.

- [ ] **Step 4: Implement normalized Gateway types**

```ts
export type AiGatewayErrorCode =
  | 'vault_locked' | 'missing_key' | 'invalid_key' | 'permission_denied'
  | 'insufficient_balance' | 'rate_limited' | 'model_not_found'
  | 'cors_blocked' | 'timeout' | 'network_error'
  | 'invalid_response' | 'provider_error';

export interface AiTaskRequest {
  taskId: AiTaskId;
  systemPrompt: string;
  userPrompt: string;
  responseFormat?: 'text' | 'json';
  timeoutMs?: number;
}

export interface AiTaskResult {
  content: string;
  providerId: AiProviderId;
  model: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string | null;
}
```

- [ ] **Step 5: Implement OpenAI-compatible requests without secret logging**

The adapter receives a fully resolved profile and optional Key, constructs headers locally, uses an `AbortController`, parses `choices[0].message.content`, `usage.prompt_tokens`, `usage.completion_tokens`, and `choices[0].finish_reason`, then discards request headers. It must never return headers or Key-bearing request objects.

For provider-specific insufficient-balance messages, inspect only the first 500 characters of the response body and map known phrases such as `insufficient balance`, `余额不足`, and `quota exceeded` to `insufficient_balance`.

- [ ] **Step 6: Implement Gateway configuration resolution**

`executeAiTask(request, runtime)` requires unlocked settings, resolves the profile, validates Endpoint, looks up `profile.secretId` when the preset needs a Key, then calls the adapter. `testAiConnection(profile, key, fetchImpl)` bypasses task inheritance but uses the same adapter and a fixed prompt with `maxOutputTokens: Math.min(profile.maxOutputTokens, 16)`.

- [ ] **Step 7: Run Gateway tests and type checking**

```powershell
cd app
npm test -- src/features/ai-agents/ai-provider-adapter.test.ts src/features/ai-agents/ai-gateway.test.ts
npm run typecheck
```

Expected: tests and typecheck PASS.

- [ ] **Step 8: Commit the Gateway**

```powershell
git add app/src/features/ai-agents/ai-provider-adapter.ts app/src/features/ai-agents/ai-provider-adapter.test.ts app/src/features/ai-agents/ai-gateway.ts app/src/features/ai-agents/ai-gateway.test.ts
git commit -m "feat: add unified ai task gateway"
```

---

### Task 5: Add the AI Agent Settings Page and Protected Navigation

**Files:**
- Create: `app/src/features/ai-agents/AiAgentSettingsPage.tsx`
- Create: `app/src/features/ai-agents/AiAgentSettingsPage.test.tsx`
- Modify: `app/src/app/AppShellBase.tsx`
- Modify: `app/src/app/router-base.tsx`
- Modify: `app/src/app/router.tsx`
- Modify: `app/src/app/router-auth.test.tsx`
- Modify: `app/src/app/router.test.tsx`

**Interfaces:**
- Consumes: `useAiVault`, presets, validation and `testAiConnection`.
- Produces: protected `/ai-agents` route and `03 AI Agent 配置` navigation item.

- [ ] **Step 1: Write page tests for all vault states**

Mock `useAiVault` and test:

- no vault → create-password and confirm-password form;
- locked vault → unlock form and retry delay;
- unlocked vault → default profile, two override sections and masked Key;
- saved Key displays only `•••• 1234`;
- page has no control that reveals the full Key;
- clear vault requires typing `清空密钥库` before enabling confirmation;
- test connection updates only non-sensitive status fields;
- save rejects invalid remote HTTP Endpoint.

- [ ] **Step 2: Write navigation and route protection tests**

Assert `AppShellBase` contains a link named `03 AI Agent 配置` pointing to `/ai-agents`. Extend router auth cases with `/ai-agents` and assert unauthenticated users are redirected to `/login` with `{ from: '/ai-agents' }`. Add an authenticated route test that renders a mocked settings page.

- [ ] **Step 3: Run page and router tests and verify failure**

```powershell
cd app
npm test -- src/features/ai-agents/AiAgentSettingsPage.test.tsx src/app/router-auth.test.tsx src/app/router.test.tsx
```

Expected: FAIL because the page, route and navigation do not exist.

- [ ] **Step 4: Implement the four-section page**

Use existing application form and button classes. Keep these headings and labels stable for tests and accessibility:

```text
AI Agent 配置
本机 AI 密钥库
全站默认模型
投研尽调 AI
证券分析 AI
连接测试
```

For provider changes, fill preset Endpoint/model but keep customer-edited values after subsequent renders. Key inputs are empty password fields used only to replace an existing secret. When saving a Key, create a stable ID such as `default:<providerId>`, `due_diligence:<providerId>`, or `securities:<providerId>` and store only `secretId` in profiles.

- [ ] **Step 5: Implement connection testing and safe status display**

The test button is disabled when the vault is locked or a required Key is missing. Display provider, actual model, latency and test time. On failure display `AiGatewayError.userMessage`; do not render provider raw bodies containing secrets.

- [ ] **Step 6: Add the route and navigation**

Add to `AppShellBase.tsx` after securities:

```tsx
<NavLink to="/ai-agents">
  <span aria-hidden="true">03</span>
  AI Agent 配置
</NavLink>
```

Register `{ path: 'ai-agents', element: <AiAgentSettingsPage /> }` as a root child. Extend the route protection predicate so it protects paths containing `securities` or exactly `ai-agents`; do not wrap the route in `SecuritiesRouteBoundary`.

- [ ] **Step 7: Run page, router and type tests**

```powershell
cd app
npm test -- src/features/ai-agents/AiAgentSettingsPage.test.tsx src/app/router-auth.test.tsx src/app/router.test.tsx
npm run typecheck
```

Expected: tests and typecheck PASS.

- [ ] **Step 8: Commit the settings UI and route**

```powershell
git add app/src/features/ai-agents/AiAgentSettingsPage.tsx app/src/features/ai-agents/AiAgentSettingsPage.test.tsx app/src/app/AppShellBase.tsx app/src/app/router-base.tsx app/src/app/router.tsx app/src/app/router-auth.test.tsx app/src/app/router.test.tsx
git commit -m "feat: add ai agent settings workspace"
```

---

### Task 6: Migrate the Legacy Research Configuration Safely

**Files:**
- Create: `app/src/features/ai-agents/legacy-config-migration.ts`
- Create: `app/src/features/ai-agents/legacy-config-migration.test.ts`
- Modify: `app/src/features/ai-agents/AiAgentSettingsPage.tsx`
- Modify: `app/src/features/ai-agents/AiAgentSettingsPage.test.tsx`

**Interfaces:**
- Produces: `detectLegacyResearchConfig`, `migrateLegacyResearchConfig`.
- Consumes: unlocked vault operations from Task 3.
- Produces: confirmed, verified and idempotent migration behavior.

- [ ] **Step 1: Write migration tests**

Test these exact outcomes:

- no legacy key → `{ status: 'not_found' }`;
- malformed JSON → `{ status: 'invalid' }` without deletion;
- valid config preview contains provider/model/endpoint and Key tail only;
- successful migration writes default profile and encrypted Key, verifies them through the unlocked vault, then removes `dd-research-config`;
- save failure retains old localStorage value;
- verification mismatch retains old localStorage value;
- repeated migration after success returns `not_found` and creates no duplicate secret.

- [ ] **Step 2: Run migration tests and verify failure**

```powershell
cd app
npm test -- src/features/ai-agents/legacy-config-migration.test.ts
```

Expected: FAIL because migration helpers do not exist.

- [ ] **Step 3: Implement strict legacy parsing**

Accept only known provider strings `ollama`, `openai`, `deepseek`, `kimi`, and `custom`. Map them to new provider IDs. Require string types for optional `apiKey`, `endpoint`, and `model`. Return a preview object that never exposes the full Key:

```ts
export interface LegacyConfigPreview {
  providerId: AiProviderId;
  model: string;
  endpoint: string;
  hasKey: boolean;
  keyLastFour: string | null;
}
```

- [ ] **Step 4: Implement write-verify-delete order**

`migrateLegacyResearchConfig` receives the unlocked vault actions, creates/reuses secret ID `default:<providerId>`, saves settings and Key, reads the current in-memory settings/descriptors through a supplied verification callback, checks provider/model/endpoint/lastFour, and only then calls `localStorage.removeItem('dd-research-config')`.

- [ ] **Step 5: Add the confirmation panel to settings page**

When legacy config is found, show provider, model, Endpoint, `已保存 Key：•••• 1234`, a required checkbox `我确认导入到当前账户的本机密钥库`, and an import button. Do not automatically import after login or vault unlock.

- [ ] **Step 6: Run migration and page tests**

```powershell
cd app
npm test -- src/features/ai-agents/legacy-config-migration.test.ts src/features/ai-agents/AiAgentSettingsPage.test.tsx
npm run typecheck
```

Expected: tests and typecheck PASS.

- [ ] **Step 7: Commit legacy migration**

```powershell
git add app/src/features/ai-agents/legacy-config-migration.ts app/src/features/ai-agents/legacy-config-migration.test.ts app/src/features/ai-agents/AiAgentSettingsPage.tsx app/src/features/ai-agents/AiAgentSettingsPage.test.tsx
git commit -m "feat: migrate legacy ai keys into encrypted vault"
```

---

### Task 7: Migrate ResearchPage as the First Gateway Consumer

**Files:**
- Modify: `app/src/features/research/ResearchPage.tsx`
- Create: `app/src/features/research/ResearchPage.ai-gateway.test.tsx`
- Modify: `app/src/infrastructure/research/research-adapter.ts`
- Create: `app/src/infrastructure/research/research-adapter.test.ts`

**Interfaces:**
- Consumes: `useAiVault`, `executeAiTask` with task ID `due_diligence.research`.
- Produces: first production AI feature using the encrypted vault and unified Gateway.
- Preserves: research query form and source parsing behavior.

- [ ] **Step 1: Write ResearchPage integration tests**

Test:

- locked vault shows link to `/ai-agents` and does not render an API Key input;
- unlocked configured vault runs task `due_diligence.research`;
- Gateway receives the existing research system/user prompt but no Key argument from the component;
- successful content is parsed into summary and sources;
- Gateway error displays the normalized Chinese message;
- old inline Provider/API Key/Endpoint configuration form is absent.

- [ ] **Step 2: Run integration tests and verify old behavior fails**

```powershell
cd app
npm test -- src/features/research/ResearchPage.ai-gateway.test.tsx
```

Expected: FAIL because ResearchPage still owns plaintext API configuration.

- [ ] **Step 3: Separate research prompt parsing from transport**

Keep `ResearchQuery`, `ResearchResult`, `ResearchSource`, prompt builders and response parsing. Export the builders and parser for Gateway use. Retain `loadResearchConfig`, `saveResearchConfig`, `clearResearchConfig`, `PROVIDER_PRESETS`, and the old transport as compatibility exports during this foundation batch because remaining AI callers still import them; mark them deprecated and remove them only in the second migration batch. Export a function:

```ts
export function parseResearchResponse(
  content: string,
  query: ResearchQuery,
  provider: string,
  model: string,
): ResearchResult;
```

- [ ] **Step 4: Replace inline configuration with vault status**

ResearchPage obtains `locked`, `settings`, and `resolveSecret` through `useAiVault`. When locked or unconfigured, render a concise status and `<Link to="/ai-agents">配置 AI Agent</Link>`. Do not render or store an API Key.

- [ ] **Step 5: Execute research through the Gateway**

Call:

```ts
const response = await executeAiTask({
  taskId: 'due_diligence.research',
  systemPrompt: buildResearchSystemPrompt(),
  userPrompt: buildResearchQueryPrompt(query),
  responseFormat: 'text',
}, {
  settings,
  resolveSecret,
  fetchImpl: fetch,
});
```

Pass `response.content`, provider ID and model to `parseResearchResponse`. The page must not construct Authorization headers.

- [ ] **Step 6: Run ResearchPage, Gateway and regression tests**

```powershell
cd app
npm test -- src/features/research/ResearchPage.ai-gateway.test.tsx src/infrastructure/research/research-adapter.test.ts src/features/ai-agents/ai-gateway.test.ts
npm run typecheck
```

Expected: tests and typecheck PASS.

- [ ] **Step 7: Commit the first consumer migration**

```powershell
git add app/src/features/research/ResearchPage.tsx app/src/features/research/ResearchPage.ai-gateway.test.tsx app/src/infrastructure/research/research-adapter.ts app/src/infrastructure/research/research-adapter.test.ts
git commit -m "refactor: route ai research through encrypted gateway"
```

---

### Task 8: Security and Production Acceptance

**Files:**
- Create: `app/src/features/ai-agents/ai-vault-security.test.ts`
- Create: `docs/deployment/local-ai-agent-vault.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a repeatable security audit and deployment/user-support runbook.

- [ ] **Step 1: Add a cross-layer plaintext leak test**

Use a unique Key `sk-security-sentinel-20260807` to create, unlock and save a vault. Assert the sentinel does not appear in:

- serialized raw IndexedDB rows;
- localStorage values;
- settings and secret descriptor objects;
- normalized Gateway errors;
- console log/error calls captured during a failed request.

Then lock the Provider and assert `resolveSecret` returns `null`.

- [ ] **Step 2: Run the security test and fix only failures inside this feature**

```powershell
cd app
npm test -- src/features/ai-agents/ai-vault-security.test.ts
```

Expected: PASS. If it fails, correct the responsible vault/Gateway code and rerun its focused unit tests before continuing.

- [ ] **Step 3: Write the local vault support document**

Document:

- Key belongs to the current browser profile and does not sync.
- Vault password cannot be recovered.
- Clearing browser site data deletes the encrypted vault.
- Refresh, sign-out and 30-minute background time lock the vault.
- How to replace a Key and clear the vault.
- Why CORS may require a customer-owned OpenAI-compatible gateway.
- No platform server stores or proxies the Key in this version.
- Remaining AI features will be migrated in the second implementation batch.

- [ ] **Step 4: Run the complete foundation suite**

```powershell
cd app
npm test -- src/features/ai-agents src/features/research/ResearchPage.ai-gateway.test.tsx src/infrastructure/research/research-adapter.test.ts src/app/router-auth.test.tsx src/app/router.test.tsx src/features/auth/AuthProvider.test.tsx
npm run typecheck
npm run lint
```

Expected: all selected tests PASS; typecheck PASS; lint exits zero. Existing unrelated lint warnings may remain, but this feature must introduce no lint errors.

- [ ] **Step 5: Build and scan the production bundle**

Use valid hosted Supabase public test values required by the existing build guard:

```powershell
cd app
$env:VITE_SUPABASE_URL='https://example.supabase.co'
$env:VITE_SUPABASE_ANON_KEY='test-anon-key'
npm run build
rg -n "sk-security-sentinel-20260807|VITE_.*SERVICE_ROLE|dd-research-config.*apiKey" dist/assets
Remove-Item Env:VITE_SUPABASE_URL
Remove-Item Env:VITE_SUPABASE_ANON_KEY
```

Expected: build PASS and `rg` returns no matches.

- [ ] **Step 6: Confirm forbidden scope was untouched**

```powershell
git diff --name-only HEAD~8..HEAD
git status --short
```

Confirm this batch did not modify:

```text
app/src/features/securities/StockAnalysisPage.tsx
app/src/infrastructure/market-data/
app/src/engines/market-analysis/
app/src/features/securities/FundAnalysisPage.tsx
```

Do not discard unrelated pre-existing working-tree changes.

- [ ] **Step 7: Commit security acceptance and documentation**

```powershell
git add app/src/features/ai-agents/ai-vault-security.test.ts docs/deployment/local-ai-agent-vault.md
git commit -m "test: verify local ai vault security boundary"
```

---

## Completion Gate

This foundation batch is complete only when all statements below are true:

- The sidebar displays `03 AI Agent 配置` and `/ai-agents` is login-protected.
- A user can create, unlock, lock, change the password of and clear a namespace-isolated local vault.
- Plaintext API Keys exist only in the unlocked Provider memory and request construction scope.
- Refresh, sign-out, user change and 30-minute background inactivity lock the vault.
- Eight providers and custom OpenAI-compatible HTTPS endpoints are configurable.
- Default, due-diligence override and securities override resolution is deterministic.
- Connection tests send no customer business data.
- Legacy `dd-research-config` is deleted only after encrypted write and verification succeed.
- ResearchPage uses the Gateway without owning or reading an API Key.
- Production build and storage scans find no sentinel Key.
- Individual-stock analysis, market data and deterministic engines are untouched.
- A second implementation plan remains required to migrate the remaining due-diligence and securities AI callers to the Gateway.
