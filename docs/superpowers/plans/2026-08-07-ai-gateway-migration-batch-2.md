# AI Gateway Migration Batch 2 Implementation Plan

> 第二批：把剩余 AI 调用方从旧 `research-adapter` 迁移到统一 AI Gateway + 本机加密密钥库。第一批（密钥库/Gateway/ResearchPage/旧配置迁移）已于 2026-08-07 完成（commits 89ec885..21983d4）。

**Goal:** 所有 AI 调用统一走 `executeAiTask`；明文 Key 只存在于解锁后的 Provider 内存；删除 `research-adapter` 的遗留导出。

**Architecture:** 新增 Gateway 运行时注册表：AiVaultProvider 在解锁/配置变更时注册 `{ settings, resolveSecret }`，锁定/登出时注销。引擎层（非 React）通过 `getAiGatewayRuntime()` 获取运行时调用 Gateway，因此 `StockAnalysisPage` 等禁区页面零改动。页面层的状态展示改用 `useAiVault`。

**Strict Constraints（继承第一批并补充）:**

- 不使用子代理。
- 不修改 `StockAnalysisPage`、`SecuritiesWorkbenchPageBase`、个股行情/K线、市场数据、估值、风险、回测、基金模块。
- API Key 不得进入 localStorage、Supabase、日志、错误提示或构建产物。
- 工作区很脏，每次提交只暂存本任务明确列出的文件；不使用 `git reset --hard` / `git checkout --`。
- 引擎函数签名保持向后兼容（调用方无需传新参数）。

**Task → 任务 ID 映射:**

| 模块 | AiTaskId |
|---|---|
| ai-reasoning.ts | `due_diligence.reasoning` |
| ai-field-extractor.ts | `document.extraction` |
| company-profiler.ts | `due_diligence.research` |
| multi-agent-debate.ts | `securities.multi_agent` |

---

### Task 1: Gateway Runtime Registry

**Files:**
- Create: `app/src/features/ai-agents/ai-gateway-runtime.ts`
- Create: `app/src/features/ai-agents/ai-gateway-runtime.test.ts`
- Modify: `app/src/features/ai-agents/AiVaultProvider.tsx`

- [ ] Step 1: 写测试：未注册时 `getAiGatewayRuntime()` 抛 `vault_locked`；注册后返回运行时；注销后再次抛错；Provider 解锁后注册、锁定后注销（用 AiVaultProvider 测试套路 mock auth）。
- [ ] Step 2: 跑测试确认失败。
- [ ] Step 3: 实现注册表（模块级单例，`register/unregister/getAiGatewayRuntime`），Provider 用 `useEffect` 按 `[locked, settings, resolveSecret]` 注册/注销。
- [ ] Step 4: 测试 + typecheck 通过。
- [ ] Step 5: 提交 `feat: register unlocked ai gateway runtime`。

### Task 2: Migrate ai-reasoning（投研综合推理）

**Files:**
- Modify: `app/src/infrastructure/research/ai-reasoning.ts`
- Modify: `app/src/features/analysis/AIReasoningPage.tsx`
- Create: `app/src/infrastructure/research/ai-reasoning.test.ts`

- [ ] Step 1: 写测试：锁定时返回中文锁定提示；Gateway 收到 `due_diligence.reasoning` + 推理 prompt；JSON 解析出 AIReasoningResult；Gateway 错误映射为 userMessage。
- [ ] Step 2: 跑测试确认失败。
- [ ] Step 3: `runAIReasoning` 内部改用 `executeAiTask`（responseFormat json），删除 fetch/Authorization/loadResearchConfig；保留 `collectAllContext`、`cleanJson`、结果映射。`config` 参数删除（无调用方传）。
- [ ] Step 4: AIReasoningPage 的 `loadResearchConfig` 状态判断改为 `useAiVault`（locked/settings）+ `/ai-agents` 链接。
- [ ] Step 5: 测试 + typecheck 通过。
- [ ] Step 6: 提交 `refactor: route ai reasoning through encrypted gateway`。

### Task 3: Migrate ai-field-extractor（文档字段提取）

**Files:**
- Modify: `app/src/infrastructure/import/ai-field-extractor.ts`
- Modify: `app/src/features/data-room/DocumentExtractionWorkspace.tsx`
- Create: `app/src/infrastructure/import/ai-field-extractor.test.ts`

- [ ] Step 1: 写测试：锁定时报错；`document.extraction` 任务经 Gateway；多 pass 提示词保持；JSON 提取合并逻辑不变。
- [ ] Step 2: 跑测试确认失败。
- [ ] Step 3: `callAI` 改用 Gateway；删除 apiKey/endpoint/model 参数和 fetch。
- [ ] Step 4: DocumentExtractionWorkspace 的 hasAiConfigured 改为 vault 状态。
- [ ] Step 5: 测试 + typecheck 通过。
- [ ] Step 6: 提交 `refactor: route document extraction through encrypted gateway`。

### Task 4: Migrate company-profiler（公司画像）

**Files:**
- Modify: `app/src/engines/research/company-profiler.ts`
- Modify: `app/src/features/data-room/CompanySearchPanel.tsx`
- Modify: `app/src/features/research/CompanySearchPage.tsx`
- Create: `app/src/engines/research/company-profiler.test.ts`

- [ ] Step 1: 写测试：锁定时报错；`due_diligence.research` 任务经 Gateway；think 标签清理与 JSON 提取逻辑不变。
- [ ] Step 2: 跑测试确认失败。
- [ ] Step 3: `callAI` 改用 Gateway，删除 loadResearchConfig/PROVIDER_PRESETS/fetch。
- [ ] Step 4: 两个页面的 `hasAI` 改为 vault 状态 + `/ai-agents` 链接。
- [ ] Step 5: 测试 + typecheck 通过。
- [ ] Step 6: 提交 `refactor: route company profiler through encrypted gateway`。

### Task 5: Migrate multi-agent-debate（多空辩论）

**Files:**
- Modify: `app/src/engines/market-analysis/multi-agent-debate.ts`
- Create: `app/src/engines/market-analysis/multi-agent-debate.test.ts`

- [ ] Step 1: 写测试：锁定时抛 `vault_locked`；各 agent 调用 `securities.multi_agent` 任务；响应解析不变。
- [ ] Step 2: 跑测试确认失败。
- [ ] Step 3: `callAI` 改用 `executeAiTask` + `getAiGatewayRuntime()`；删除 loadResearchConfig/PROVIDER_PRESETS/fetch/Authorization。**不改 StockAnalysisPage / SecuritiesWorkbenchPageBase。**
- [ ] Step 4: 测试 + typecheck 通过。
- [ ] Step 5: 提交 `refactor: route multi agent debate through encrypted gateway`。

### Task 6: Remove Legacy research-adapter Exports

**Files:**
- Modify: `app/src/infrastructure/research/research-adapter.ts`
- Modify: `app/src/infrastructure/research/research-adapter.test.ts`（如有兼容断言）

- [ ] Step 1: 全仓 grep 确认 `loadResearchConfig / saveResearchConfig / clearResearchConfig / executeResearch / PROVIDER_PRESETS（research-adapter 的）` 零引用（`legacy-config-migration.ts` 直接读 localStorage，不依赖这些导出）。
- [ ] Step 2: 删除遗留导出与 `isDev` 代理端点逻辑；保留类型（ResearchQuery/Result/Source）、prompt builders、`parseResearchResponse`、`isOnline`。
- [ ] Step 3: 全量测试 + typecheck。
- [ ] Step 4: 提交 `refactor: remove legacy research adapter transport`。

### Task 7: Batch 2 Acceptance

- [ ] Step 1: 全套件 `npm test`（ai-agents + research + import + engines 相关）+ typecheck + lint 零新增错误。
- [ ] Step 2: 哨兵 Key 安全测试仍通过；生产构建 + dist 扫描无哨兵/无明文。
- [ ] Step 3: 更新 `docs/deployment/local-ai-agent-vault.md`（移除「后续批次」段落，记录运行时注册表行为）。
- [ ] Step 4: `git status` 确认禁区未触碰、无关改动未提交。
- [ ] Step 5: 提交 `docs: close out ai gateway migration batch 2`（如有文档变更）。
