# 本机 AI 密钥库 — 部署与用户支持说明

适用范围：`03 AI Agent 配置`（`/ai-agents`）及其统一 AI Gateway（第一批：ResearchPage）。

## 用户侧要点

### Key 存在哪里？

- API Key 只保存在**当前电脑的当前浏览器配置文件**中，使用 PBKDF2-SHA256（310,000 次迭代，随机 salt）派生密钥后以 AES-GCM 256 位加密，存储于独立的 IndexedDB 数据库 `investment-dd-ai-vault`。
- Key **不会**上传到 Supabase 或任何平台服务器，**不会**跨设备、跨浏览器同步。换电脑/换浏览器需要重新录入。
- 本版本没有任何平台服务器存储或代理转发用户的 Key。

### 密钥库密码

- 密码至少 10 位，**无法找回**。忘记密码只能清空密钥库后重建（清空会删除本机保存的所有模型配置和 Key）。
- 连续 5 次解锁失败后锁定 30 秒。

### 什么时候会重新锁定？

- 刷新或重开页面；
- 退出登录或切换登录账户；
- 页面切到后台超过 30 分钟。

锁定后明文 Key 只从内存中清除，加密数据仍在本地，重新输入密码即可解锁。

### 清除浏览器数据的影响

清除浏览器「网站数据 / IndexedDB」会**永久删除**加密密钥库，Key 与配置无法恢复，需要重新创建密钥库并录入。

### 如何更换 Key / 清空密钥库

- 更换：在对应模型配置的 API Key 输入框填入新 Key 并「加密保存配置」；留空则保留现有 Key。已保存的 Key 只显示尾四位（`•••• 1234`），无法再次查看完整值。
- 清空：在「保存与安全操作」区输入 `清空密钥库` 后确认。

### 旧版 dd-research-config 迁移

- 系统检测到旧版本地配置时，会在设置页显示迁移面板（供应商、模型、Endpoint、Key 尾四位）。
- **不会自动迁移**；必须勾选确认后手动导入。只有加密写入并核验成功后才删除旧配置；任何失败都会保留旧配置。

## 部署侧要点

### 环境变量

生产构建由 `assertProductionAuthEnvironment` 守护，需要合法的 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`。AI 密钥库不依赖任何新的环境变量。

### CORS 与浏览器直连

- 浏览器直连大模型供应商时受 CORS 限制。开发环境通过 Vite proxy（`/api/deepseek`、`/api/kimi`、`/api/openai`）转发。
- 若目标供应商不发送 CORS 头且没有可用代理，客户需要自建的 OpenAI 兼容网关（使用「自定义」供应商，**远程 Endpoint 必须 HTTPS**；只有 Ollama 允许 `http://localhost` / `http://127.0.0.1`）。

### 安全边界（本版本）

- 明文 Key 只存在于解锁后的 Provider 内存和请求构造作用域；不进入 localStorage、日志、错误提示或构建产物。
- 跨层泄漏由 `app/src/features/ai-agents/ai-vault-security.test.ts` 用哨兵 Key `sk-security-sentinel-20260807` 回归验证。

### 运行时注册表（第二批起）

- 密钥库解锁期间，`AiVaultProvider` 会把 `{ settings, resolveSecret }` 注册到 Gateway 运行时注册表（`ai-gateway-runtime.ts`），供引擎层（非 React 模块）直接调用 `executeAiTask`；锁定、登出或切换账户时自动注销。
- 注册表只保存引用，不保存 Key 本体；明文 Key 仍只存在于 Provider 内存。
- 第二批已迁移：AI 综合分析（`due_diligence.reasoning`）、文档智能提取（`document.extraction`）、公司画像（`due_diligence.research`）、多空辩论（`securities.multi_agent`）、深度研究（`securities.stock_analysis`）、自选股/持仓 AI 点评（`securities.portfolio`）。

### 已知例外

- `StockAnalysisPage` 的「人工博弈」对话仍读取旧 `dd-research-config`（该页面属冻结范围，未改动）。`research-adapter` 仅保留 `loadResearchConfig` / `PROVIDER_PRESETS` 两个 deprecated 兼容导出供其使用；已无任何代码可以写入新的明文配置。第三批迁移该对话功能后可删除这两个导出。
