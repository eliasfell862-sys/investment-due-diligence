# Supabase 多租户数据平台 TDD 实施计划

**目标：** 在不破坏现有推理、估值、风险、报告和桌面打包能力的前提下，把项目数据从浏览器单机存储渐进升级为 Supabase 权威云数据、Dexie 离线缓存、四级项目权限和可追溯审计体系。

**方法：** 按“基础设施 → 数据库安全边界 → 身份 → 数据服务 → 项目 → 模块同步 → 迁移 → 快照/审计/文件 → 全量切换”推进。每个行为变更严格执行 RED（先写并确认失败）→ GREEN（最小实现）→ REFACTOR（保持全绿），每个任务独立提交；不得把当前工作区中尚未提交的推理、风险和页面改动混入这些提交。

**技术栈：** React 19、TypeScript 6、Vite 8、Vitest 4、Dexie 4、Supabase JS、Supabase PostgreSQL/Auth/Storage、PostgreSQL RLS、Supabase CLI 本地测试环境。

## 范围与固定约束

- 包含邮箱密码认证、机构与项目成员、四级角色、RLS、云端项目/模块数据、Dexie 缓存、离线队列、乐观并发、冲突处理、旧数据迁移、不可变快照、审计、私有文件、软删除和恢复。
- 不包含 OIDC/SAML、计费、跨机构共享、实时共同编辑、自建 PostgreSQL，以及所有模块一次性移除 `localStorage`。
- Supabase 是在线权威源；Dexie 保存可恢复缓存与待同步操作；旧本地数据迁移验证后只读保留三十天。
- 前端只能使用 Supabase URL 与 anon key，禁止出现 `service_role`；RLS/RPC 是最终安全边界。
- `reviewer` 只读；`analyst` 可改模块并运行模型；`project_owner` 管理本项目；`organization_admin` 管理本机构。
- 云写入必须携带 `operation_id` 和 `base_record_version`；重复操作幂等，版本落后明确冲突，不静默覆盖。
- `analysis_snapshots`、`audit_events` 对普通客户端只允许追加，不允许更新或删除。
- 所有新页面和服务不得新增项目业务数据的直接 `localStorage` 调用。

## Task 1：锁定基线、依赖、环境配置与公共契约

**文件：** `app/package.json`、`app/.env.example`、`app/src/infrastructure/supabase/*`、`app/src/infrastructure/data/project-data-*`。

- [ ] 记录当前 typecheck、相关测试、lint 和 build，只记录既有告警，不修改无关代码。
- [ ] RED：测试缺失/非法 Supabase URL、anon key，并锁定数据服务、同步状态、记录版本、四角色和统一错误类型。
- [ ] 确认失败原因为契约与配置模块尚不存在。
- [ ] GREEN：加入 `@supabase/supabase-js`，实现惰性客户端创建和环境校验；测试不得误连真实云项目。
- [ ] REFACTOR：把 Supabase SDK 类型限制在适配器层，页面和领域引擎只依赖本地接口。
- [ ] 验证聚焦测试、typecheck、lint；只提交本任务文件：`feat: define cloud data platform contracts`。

## Task 2：建立数据库模式、权限函数、RLS 与数据库测试

**文件：** `supabase/config.toml`、`supabase/migrations/*_multitenant_platform.sql`、`supabase/tests/*.sql`、`supabase/seed.sql`、`app/package.json`。

- [ ] RED：覆盖机构隔离、四角色矩阵、伪造机构 ID、reviewer 写入、快照/审计更新删除、软删除、重复 operation ID 和过期版本冲突。
- [ ] 启动本地 Supabase，确认测试因表、函数和策略缺失而失败。
- [ ] GREEN：创建设计批准的十张业务表、索引、外键、检查约束和时间戳触发器。
- [ ] GREEN：实现固定 `search_path` 的权限函数及事务化 `save_project_module` RPC，同时做权限、幂等、版本检查、写入和审计追加。
- [ ] GREEN：全部业务表和私有 Storage bucket 启用 RLS，拒绝跨机构访问和普通客户端修改不可变记录。
- [ ] REFACTOR：消除策略重复，检查函数所有者、执行权限和公开 schema 暴露面。
- [ ] 验证空库重建、全部 SQL 测试和数据库 lint/diff；提交 `feat: add multi-tenant Supabase schema and RLS`。

## Task 3：实现邮箱密码认证、会话恢复和受保护路由

**文件：** 新建 `app/src/features/auth/`；修改 `app/src/main.tsx`、`app/src/app/router.tsx`。

- [ ] RED：覆盖注册、登录、退出、重置密码、刷新恢复会话、会话过期、未登录跳转和登录后返回原路径。
- [ ] GREEN：封装 Supabase Auth；Provider 不在日志或错误中泄露 token。
- [ ] GREEN：增加登录/重置页面和受保护路由；离线已有会话时可读缓存，但不得伪装云写成功。
- [ ] REFACTOR：统一中文错误、loading 状态和订阅生命周期。
- [ ] 验证聚焦测试、typecheck、lint及刷新/退出手工流程；提交 `feat: add email password authentication`。

## Task 4：扩展 Dexie 为离线缓存、操作队列与迁移映射

**文件：** 修改 `app/src/infrastructure/db/app-db.ts`；新建 `app/src/infrastructure/sync/` 的类型、离线操作仓储和迁移映射仓储及测试。

- [ ] RED：覆盖 Dexie v3 无损升级、云项目/模块缓存、待同步队列、重试、冲突载荷和旧/新项目 ID 映射。
- [ ] GREEN：新增 Dexie 版本和表，复合索引以机构、项目和更新时间为边界。
- [ ] GREEN：实现入队、幂等读取、成功确认、可重试失败、永久失败和冲突状态转换。
- [ ] REFACTOR：集中生成时间戳和 operation ID，禁止 UI 直接操作队列表。
- [ ] 验证升级/仓储及现有仓储回归；提交 `feat: add offline cache and sync queue`。

## Task 5：实现 Supabase/Dexie 适配器与同步协调器

**文件：** 新建 `supabase-project-data-adapter.ts`、`dexie-project-cache.ts`、`create-project-data-service.ts`、`sync-coordinator.ts` 及测试。

- [ ] RED：覆盖缓存优先、后台云刷新、在线双写、离线排队、恢复重放、重复 operation ID、401/403、限流、暂时失败和版本冲突。
- [ ] GREEN：Supabase 适配器只负责 DTO/RPC，Dexie 只负责缓存，协调器负责编排状态机。
- [ ] GREEN：保存先原子写本地模块与队列，再尝试云端；成功后更新 record version 并确认操作。
- [ ] GREEN：冲突保留本地、云端、base 三份数据，提供“使用云端 / 本地另存新版本 / 人工合并”，不任意深合并 JSON。
- [ ] REFACTOR：用依赖注入替代全局 SDK mock，统一错误映射。
- [ ] 验证协调器全状态测试、typecheck、lint；提交 `feat: coordinate cloud and offline project data`。

## Task 6：迁移项目、成员权限和软删除

- [ ] RED：覆盖跨电脑项目列表、缓存首屏、创建、角色操作、成员增删改、reviewer 禁写、软删除隐藏、管理员恢复和重试。
- [ ] GREEN：路由注入 `ProjectDataService`，项目页面不再直接依赖本地 `ProjectRepository`。
- [ ] GREEN：增加 `ProjectMembersPage` 和 `useProjectPermissions`；RLS 最终裁决。
- [ ] GREEN：删除改为软删除并提供恢复期，移除“永久清除”文案。
- [ ] REFACTOR：旧仓储仅保留迁移读取，禁止新增调用点。
- [ ] 验证页面、路由、仓储回归和双浏览器权限检查；提交 `feat: migrate projects and member permissions to cloud`。

## Task 7：迁移首批核心模块并实现同步/冲突 UI

**首批模块：** `company-overview`、`financials`、`industry`、`valuation`、`equity`、`risk-items`、`fatal-flaws`、`exit`。

- [ ] RED：锁定 module key/schema version；覆盖缓存显示、云刷新、本地已保存、等待同步、同步中、失败可重试和冲突。
- [ ] RED：证明页面保存会产生云同步操作，而不是只写 `localStorage`。
- [ ] GREEN：实现 `module-registry`、`useSyncedProjectModule`、同步状态和冲突对话框；旧 key 只作首次读取。
- [ ] GREEN：逐页迁移八个模块，冲突选择追加审计，智能推理链读取同一份规范化数据。
- [ ] REFACTOR：集中 schema、默认值和迁移函数，禁止散落 key 拼接。
- [ ] 验证 hook/UI、页面、推理、估值、市值、股权、风险和集成流程；提交 `feat: dual-write core due diligence modules`。

## Task 8：实现旧 localStorage/Dexie 数据迁移向导

- [ ] RED：覆盖 `dd-projects`、`dd-p-{projectId}-{module}`、Dexie 扫描、损坏 JSON、重复项目、内容哈希和迁移清单。
- [ ] RED：覆盖断网、重试、重复执行、部分成功、目标机构、记录数/哈希校验和完成标记。
- [ ] GREEN：实现纯扫描器和幂等迁移器，不自动删除本地数据，不跨机构复用映射。
- [ ] GREEN：迁移页显示项目/模块/证据数量、失败原因和重试项，完成后提示三十天保留期。
- [ ] REFACTOR：迁移只经 `ProjectDataService` 写云端。
- [ ] 验证迁移测试、真实旧 key 浏览器测试和迁移后一致性；提交 `feat: migrate legacy local project data`。

## Task 9：接入不可变快照、审计和私有文件

- [ ] RED：覆盖每次运行创建新快照、相同 input hash 不覆盖、快照/审计不可改删及关键事件类型。
- [ ] RED：覆盖私有上传、机构/项目路径、SHA-256、权限拒绝、签名 URL、过期和软删除元数据。
- [ ] GREEN：推理、预测、估值、股权、风险和决策写不可变快照；失败时标记“仅本地，未形成正式快照”。
- [ ] GREEN：接入登录、成员变更、模块修改、冲突决策、模型运行、报告导出、投委会提交和下载审计。
- [ ] GREEN：新文件写私有 Storage；离线上传排队，签名 URL 不持久化。
- [ ] REFACTOR：规范化哈希与 metadata，禁止令牌、签名 URL 和文件正文进入审计。
- [ ] 验证数据室、报告、模型回归和 Storage RLS；提交 `feat: persist immutable analysis and private evidence`。

## Task 10：逐模块收口、商业化安全验证与发布切换

- [ ] RED：增加静态架构测试，禁止 `features/` 新增项目业务数据的直接 `localStorage` 调用，临时豁免逐项归零。
- [ ] GREEN：迁移剩余页面、AI 提取器、公司搜索、报告和数据管理，只保留非项目偏好类 localStorage。
- [ ] GREEN：系统状态展示认证、云连接、缓存、待同步、冲突和最近同步时间。
- [ ] 验证完整流程：管理员建机构/项目 → 邀请三角色 → analyst 离线修改 → 恢复同步 → 冲突 → 模型 → 快照 → reviewer 复核 → 导出。
- [ ] 验证双机构隔离，跨租户读取、写入、文件访问和伪造 ID 全部失败。
- [ ] 运行 typecheck、全量测试、lint、build、数据库/Storage/RLS 测试和 `git diff --check`；不得强制修复依赖。
- [ ] 验证 Netlify/Vercel 环境变量与 SPA 路由，以及 Electron 登录、会话恢复、离线缓存和安装包构建。
- [ ] 编写迁移、回滚、恢复、密钥轮换和故障处理说明；提交 `chore: complete cloud data platform rollout`。

## 每个任务的 TDD 验收模板

- [ ] 新测试先失败，失败原因确为行为尚未实现。
- [ ] 只写让当前失败测试通过的最小生产代码。
- [ ] 聚焦测试通过后运行相关回归，重构期间保持全绿。
- [ ] 新网络边界覆盖成功、未认证、无权限、离线、冲突和未知错误。
- [ ] 新权限行为同时有客户端测试与数据库 RLS 测试。
- [ ] 提交前运行 `git diff --check`，只暂存本任务文件。

## 最终验收标准

- 用户在另一台电脑登录后，只能看到获授权项目。
- 四级角色的读写、模型运行、成员管理和导出权限与设计矩阵一致。
- 离线编辑不丢失；恢复网络后成功同步或明确进入冲突处理。
- 重复操作不重复写入，并发修改不静默覆盖。
- 六项致命缺陷、估值、市值、股权回报、风险联动和报告功能保持回归全绿。
- 关键修改、模型运行、文件访问与报告导出均有可追溯审计。
- 不存在跨机构数据可见性漏洞，前端包和日志中不存在高权限密钥或会话秘密。
