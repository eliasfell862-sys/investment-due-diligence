# Supabase 多租户数据平台与项目权限设计规格

日期：2026-07-31  
状态：已最终批准

## 1. 目标

把当前以 `localStorage` 和 Dexie/IndexedDB 为主的单机数据体系升级为可跨电脑、可多人协作、可审计、可按机构隔离的云端数据平台，同时保留离线使用能力。

本阶段采用 Supabase PostgreSQL、Supabase Auth、Row Level Security（RLS）和 Supabase Storage。第一版登录方式为邮箱加密码。

## 2. 范围

本设计覆盖：

- 用户注册、登录、退出和会话续期。
- 机构、机构成员、项目和项目成员。
- 四级角色与服务端权限校验。
- 项目模块数据云端持久化。
- Dexie 离线缓存及同步队列。
- 旧 `localStorage` 项目数据迁移。
- 分析快照、审计事件和私有文件元数据。
- 并发修改检测和冲突处理。

本阶段不包含：

- 企业 OIDC、SAML 或银行统一身份认证。
- 计费和订阅。
- 跨机构项目共享。
- 实时多人协同编辑同一字段。
- 自建 PostgreSQL 或私有化部署实施。

## 3. 架构

```text
React 页面
  -> ProjectDataService
      -> SyncCoordinator
          -> Supabase PostgreSQL / Auth / Storage
          -> Dexie IndexedDB 缓存与离线队列
```

页面不得新增对项目业务数据的直接 `localStorage` 调用。现有调用通过渐进迁移改为 `ProjectDataService`。

在线时 Supabase 是正式数据源。Dexie 用于快速展示、离线编辑和待同步操作。页面打开项目时先读取缓存，再获取云端最新版本并更新缓存。

## 4. 身份与租户模型

Supabase Auth 管理密码、会话和密码重置。业务表只保存 `auth.users.id` 的引用，不保存密码或令牌。

每个用户可以加入一个或多个机构。每个项目必须属于一个机构。所有项目业务表必须包含 `organization_id`，RLS 同时校验机构成员关系和项目成员关系。

### 4.1 角色

| 角色 | 机构管理 | 项目管理 | 修改项目数据 | 运行模型 | 查看与导出 |
|---|---:|---:|---:|---:|---:|
| `organization_admin` | 是 | 全部项目 | 是 | 是 | 是 |
| `project_owner` | 否 | 指定项目 | 是 | 是 | 是 |
| `analyst` | 否 | 否 | 是 | 是 | 是 |
| `reviewer` | 否 | 否 | 否 | 否 | 是 |

权限由数据库 RLS 强制执行，前端按钮隐藏仅作为用户体验优化，不能作为安全边界。

## 5. 数据模型

### 5.1 `profiles`

- `user_id uuid primary key references auth.users`
- `display_name text`
- `created_at timestamptz`
- `updated_at timestamptz`

### 5.2 `organizations`

- `id uuid primary key`
- `name text`
- `status text`
- `created_by uuid`
- `created_at timestamptz`
- `updated_at timestamptz`

### 5.3 `organization_members`

- `organization_id uuid`
- `user_id uuid`
- `role text`，第一版仅允许 `organization_admin` 或 `member`
- `status text`
- `created_at timestamptz`
- 联合主键：`organization_id, user_id`

### 5.4 `projects`

- `id uuid primary key`
- `organization_id uuid not null`
- `name text not null`
- `status text`
- `version bigint not null default 1`
- `created_by uuid`
- `updated_by uuid`
- `created_at timestamptz`
- `updated_at timestamptz`
- `deleted_at timestamptz null`

索引：

- `(organization_id, updated_at desc)`
- `(organization_id, status)`
- 过滤索引：`deleted_at is null`

### 5.5 `project_members`

- `project_id uuid`
- `organization_id uuid`
- `user_id uuid`
- `role text`：`project_owner | analyst | reviewer`
- `created_at timestamptz`
- 联合主键：`project_id, user_id`

索引：`(user_id, project_id)`。

### 5.6 `project_modules`

保存公司概况、财务、行业、团队、估值、风险、股权等模块的当前版本。

- `id uuid primary key`
- `organization_id uuid`
- `project_id uuid`
- `module_key text`
- `schema_version integer`
- `data jsonb`
- `record_version bigint`
- `updated_by uuid`
- `updated_at timestamptz`
- 唯一约束：`project_id, module_key`

`data` 使用 JSONB 是为了支持现有模块的渐进迁移；稳定且需要统计查询的核心字段后续拆成结构化表。禁止把权限、成员关系和审计记录放入 JSONB。

索引：

- `(project_id, module_key)` 唯一索引。
- `(organization_id, updated_at desc)`。
- 仅在出现明确查询需求时增加 JSONB GIN 索引。

### 5.7 `analysis_snapshots`

保存预测、估值、风险、股权和投资决策的不可变结果。

- `id uuid primary key`
- `organization_id uuid`
- `project_id uuid`
- `engine_type text`
- `engine_version text`
- `input_hash text`
- `input_snapshot jsonb`
- `output_snapshot jsonb`
- `trace_snapshot jsonb`
- `created_by uuid`
- `created_at timestamptz`

普通客户端无 UPDATE、DELETE 权限。新计算必须 INSERT 新记录。

索引：

- `(project_id, engine_type, created_at desc)`
- `(project_id, input_hash)`

### 5.8 `evidence_files`

- `id uuid primary key`
- `organization_id uuid`
- `project_id uuid`
- `storage_path text`
- `original_name text`
- `mime_type text`
- `size_bytes bigint`
- `sha256 text`
- `uploaded_by uuid`
- `created_at timestamptz`
- `deleted_at timestamptz null`

文件存储桶必须为私有。下载使用短时签名链接。

### 5.9 `audit_events`

只允许追加。

- `id uuid primary key`
- `organization_id uuid`
- `project_id uuid null`
- `actor_user_id uuid`
- `event_type text`
- `entity_type text`
- `entity_id text`
- `request_id text`
- `metadata jsonb`
- `created_at timestamptz`

记录登录失败、成员变更、数据修改、模型运行、报告导出、投委会提交和越权尝试。

### 5.10 `sync_operations`

- `operation_id uuid primary key`
- `organization_id uuid`
- `project_id uuid`
- `user_id uuid`
- `module_key text`
- `base_record_version bigint`
- `operation_type text`
- `payload_hash text`
- `applied_at timestamptz`

`operation_id` 用于幂等处理，重复请求不得重复修改数据。

## 6. RLS 策略

所有业务表启用 RLS。

- 用户只能读取自己仍处于有效状态的机构。
- `organization_admin` 可以管理本机构成员和所有项目。
- `project_owner` 可以管理指定项目成员和项目数据。
- `analyst` 可以读取和修改指定项目模块、上传文件、运行模型并创建快照。
- `reviewer` 只能读取项目、模块、证据元数据、快照和报告。
- 普通用户不能更新或删除 `audit_events`。
- 普通用户不能更新或删除 `analysis_snapshots`。
- 所有写操作同时校验 `organization_id` 与项目归属，防止伪造跨机构项目 ID。

复杂权限判断封装为 `security definer` 数据库函数，并固定 `search_path`，避免在每条策略中重复逻辑。

## 7. 客户端数据接口

`ProjectDataService` 提供稳定接口：

- `listProjects()`
- `getProject(projectId)`
- `createProject(input)`
- `getModule(projectId, moduleKey)`
- `saveModule(projectId, moduleKey, data, baseVersion)`
- `createAnalysisSnapshot(input)`
- `listAnalysisSnapshots(projectId, engineType)`
- `uploadEvidence(projectId, file)`
- `listProjectMembers(projectId)`
- `updateProjectMember(input)`

页面不知道数据来自 Supabase 还是 Dexie。返回值必须包含同步状态和记录版本。

## 8. 双写与离线同步

保存流程：

1. 在 Dexie 写入模块数据和待同步操作。
2. UI 立即显示“本地已保存”。
3. 在线时携带 `operation_id` 和 `base_record_version` 调用 Supabase RPC。
4. 服务端在事务中检查权限、幂等记录和版本。
5. 成功后递增版本、写审计事件并标记操作已同步。
6. 失败时保留离线操作并显示可重试状态。

冲突流程：

- 云端版本等于基础版本：正常保存。
- 云端版本高于基础版本：返回冲突，不覆盖云端。
- UI 提供“使用云端”“保留本地为新版本”“人工合并”。
- 自动合并只允许用于经过明确证明可交换的独立字段，不对任意 JSON 自动深度合并。

## 9. 旧数据迁移

首次登录后扫描：

- `dd-projects`
- `dd-p-{projectId}-{module}`
- Dexie 中已有的项目、证据和导入记录

迁移步骤：

1. 生成迁移清单和内容哈希。
2. 用户选择目标机构。
3. 逐项目创建云端项目和模块记录。
4. 保存旧项目 ID 到迁移映射。
5. 校验记录数和哈希。
6. 写入 `local_migration_completed` 标记。
7. 默认保留本地数据三十天，不立即删除。

迁移必须可重复执行且幂等。

## 10. 安全要求

- 客户端仅配置 Supabase URL 和 anon key。
- `service_role` 密钥只能放在受控服务端环境变量中。
- 禁止记录密码、访问令牌、刷新令牌和私有签名链接。
- 会话过期后停止云端写入，保留本地待同步操作。
- 敏感导出和文件下载写入审计事件。
- 文件路径必须包含机构和项目隔离前缀。
- 项目删除使用软删除并保留恢复窗口。
- 数据库迁移必须可回滚或具有向前修复方案。

## 11. 错误处理

客户端统一错误类型：

- `unauthenticated`
- `forbidden`
- `not_found`
- `version_conflict`
- `offline`
- `rate_limited`
- `validation_failed`
- `storage_failed`
- `unknown`

权限失败不得降级为本地“成功”。离线可以保存本地，但必须明确显示尚未同步。

## 12. 测试与验收标准

必须覆盖：

- 邮箱密码注册、登录、退出、密码重置和会话过期。
- 四级角色权限矩阵。
- 跨机构读取和写入全部失败。
- reviewer 无法修改模块或运行需要写快照的模型。
- 分析快照不可更新或删除。
- 审计记录不可由普通客户端修改或删除。
- 本地保存、离线队列和恢复同步。
- 重复 `operation_id` 不产生重复数据。
- 并发写入返回版本冲突。
- 旧 `localStorage` 与 Dexie 数据迁移幂等。
- 文件私有访问和签名链接过期。
- 删除项目后普通列表不可见，管理员可在恢复期恢复。

验收条件：

- 用户在另一台电脑登录后可以访问获授权项目。
- 两个机构之间不存在任何数据可见性泄漏。
- 离线修改恢复网络后可以同步或明确进入冲突处理。
- 每次关键修改、模型运行和报告导出都有可追溯审计记录。
- 现有推理、估值、风险和报告功能在迁移期间继续工作。

## 13. 实施顺序

1. Supabase 项目配置、环境变量和本地开发环境。
2. 数据库迁移、RLS 策略及数据库权限测试。
3. 登录页面、会话提供器和受保护路由。
4. `ProjectDataService` 与 Supabase/Dexie 适配器。
5. 项目列表和项目创建迁移。
6. 模块数据双写与同步状态 UI。
7. 旧数据迁移向导。
8. 分析快照和审计事件。
9. 私有文件存储。
10. 逐模块移除直接 `localStorage` 调用。

## 14. 后续扩展

- 企业 OIDC/SAML 和强制 MFA。
- 客户自有 Supabase 或私有 PostgreSQL 部署。
- 数据驻留区域选择。
- 字段级敏感信息脱敏。
- 审批工作流和电子签名。
- 更细粒度的报告导出权限。