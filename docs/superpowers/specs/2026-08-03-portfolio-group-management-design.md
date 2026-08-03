# 持仓分组管理设计规格

## 1. 目标

在证券项目的“持仓分配系统”中增加独立的持仓组管理能力。用户完成持仓配比计算后即可保存方案；如果已完成 AI 组合审查，则同时保存 AI 结论。保存到已有持仓组时创建新版本，不覆盖历史记录。

## 2. 范围

本期包含：

- 新建持仓组。
- 将当前持仓分配方案保存到已有持仓组。
- 每次保存生成不可变的历史版本，并更新该组的当前版本。
- 查看持仓组列表、当前版本和历史版本。
- 加载某个历史版本到页面查看。
- 删除持仓组。
- 明确的保存成功、校验失败和存储失败反馈。

本期不包含：

- 不修改自选股池和自选股分组结构。
- 不自动执行真实交易或同步券商账户。
- 不提供复杂的版本差异对比图。
- 不提供云端同步、多人协作或权限控制。
- 不允许加载历史版本后覆盖其原始内容；再次保存必须形成新版本。

## 3. 存储设计

持仓组使用独立 localStorage 键：

```text
sec_portfolio_groups_v1
```

数据结构：

```ts
interface PortfolioGroup {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentVersionId: string;
  versions: PortfolioVersion[];
}

interface PortfolioVersion {
  id: string;
  createdAt: string;
  capital: number;
  riskLevel: 'conservative' | 'balanced' | 'aggressive';
  sourceWatchlistId?: string;
  sourceWatchlistName?: string;
  aiSummary?: string;
  positions: PortfolioPositionSnapshot[];
}

interface PortfolioPositionSnapshot {
  code: string;
  name: string;
  groupName: string;
  groupColor: string;
  score: number;
  allocation: number;
  amount: number;
  shares: number;
  price: number;
  rationale: string;
}
```

股票行情对象不整体持久化，只保存复核方案所需的快照字段，避免缓存无关数据和未来字段结构变化。

## 4. 模块边界

新增独立存储模块 `portfolio-group-storage.ts`，负责：

- 安全解析和校验本地数据。
- 加载全部持仓组。
- 新建持仓组并保存首个版本。
- 向已有组追加版本。
- 删除持仓组。
- 根据组和版本 ID 查询快照。

页面组件只负责表单状态、当前分析结果转换和交互展示，不直接拼装 localStorage 读写逻辑。

## 5. 页面交互

### 5.1 保存区域

当 `candidates.length > 0` 时显示“保存到持仓组”区域，不要求 AI 审查必须成功。

区域包含：

- 已有持仓组下拉选择。
- “新建持仓组”选项。
- 选择新建时显示组名输入框。
- “保存当前方案”按钮。
- 保存状态与结果提示。

如果存在 `aiSummary`，保存时一并写入；为空时保存不受影响。

### 5.2 版本规则

- 新组首次保存产生版本 1。
- 保存到已有组始终追加版本。
- 新版本自动成为 `currentVersionId`。
- 同名组不允许重复创建，提示用户选择已有组。
- 空名称、空持仓或无效资金不得保存。

### 5.3 管理区域

页面提供“持仓组管理”区域：

- 展示组名、版本数、最新更新时间和当前总资金。
- 选择组后列出版本时间、风险偏好、持仓数量和是否包含 AI 审查。
- 点击版本可将快照加载到只读查看状态。
- 删除持仓组前使用浏览器确认框。

加载历史版本仅用于查看。用户若希望基于历史方案形成新方案，应重新运行分析或将当前结果再次保存为新版本。

## 6. 数据流

```text
自选股池
  → 持仓分析与配比计算
  → 可选 AI 组合审查
  → 用户选择/新建持仓组
  → 转换为 PortfolioVersion 快照
  → 存储模块追加版本
  → 刷新持仓组管理列表
```

## 7. 错误处理

- localStorage 内容损坏时返回空组列表，不让页面崩溃。
- 写入失败时保留当前分析结果，并显示“保存失败，请检查浏览器存储空间”。
- 组不存在或版本不存在时显示提示，不清空当前页面。
- 删除当前正在查看的组后，退出历史查看状态。
- 保存操作进行中时禁用按钮，防止重复版本。

## 8. 测试要求

存储层测试：

- 空存储返回空数组。
- 新建组保存首个版本。
- 已有组追加版本且保留旧版本。
- 当前版本 ID 指向最新版本。
- 同名组创建失败。
- 删除组不会影响其他组。
- 损坏 JSON 安全降级。

页面测试：

- 无分析结果时不显示保存区域。
- 有配比结果时可新建组并保存。
- AI 结果为空时仍可保存。
- 选择已有组时追加新版本。
- 保存成功后显示组名和版本信息。
- 无效组名和存储错误显示明确反馈。

## 9. 兼容与迁移

- 不修改 `sec_watchlists_v2` 和 `sec_active_watchlist`。
- 新存储键带版本号，未来结构升级时可以迁移到 `sec_portfolio_groups_v2`。
- 当前 localStorage 数据结构应保持可序列化，未来可直接迁移到 IndexedDB 或服务端数据库。

## 10. 完成标准

- 用户完成配比计算后能够保存到新组或已有组。
- 保存到已有组不会丢失历史版本。
- AI 审查失败不影响保存。
- 用户能够查看持仓组及其历史方案。
- 自选股池、个股分析和其他证券模块行为不受影响。
- 新增测试、证券相关回归测试、类型检查和生产构建全部通过。
