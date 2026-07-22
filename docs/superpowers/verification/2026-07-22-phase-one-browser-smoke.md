# Phase 1 浏览器 Smoke 记录

## 执行环境

- 日期：2026-07-22
- 时区：Asia/Shanghai（UTC+08:00）
- 本地地址：`http://127.0.0.1:5173/`
- 启动方式：`npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`
- 浏览器控制通道：Chrome extension binding；连接失败页面的浏览器品牌显示为 Microsoft Edge
- 测试项目：`浏览器 Smoke 多模板项目`

## 浏览器实际执行步骤

| 步骤 | 浏览器观察结果 | 结论 |
| --- | --- | --- |
| 打开项目列表 | 显示“项目工作台”和“从一份清晰的投资命题开始”空态 | 通过 |
| 进入新建项目 | 显示项目名称、投资阶段和三个行业模板控件 | 通过 |
| 创建多模板项目 | 输入项目名称，勾选 `SaaS / 软件` 与 `硬科技 / 制造`，提交后导航到 `/projects/:projectId` | 通过 |
| 查看 Dashboard 初始状态 | 显示项目名、完整度 `0%`、`5 项`待补字段、`0 组`冲突和“尚未就绪”；待补字段包含公司名称、业务描述、营业收入、毛利率、ARR | 通过 |
| 服务重启后刷新 | 首个 Vite 长运行单元在 120 秒达到托管时限，页面短暂显示 `ERR_CONNECTION_REFUSED`；重启相同地址后刷新原项目 URL，项目名、路由和 Dashboard 状态仍存在 | 通过，确认 IndexedDB 持久化 |
| 进入资料中心 | 通过“进入资料中心”导航到 `/projects/:projectId/data-room`，显示项目名、返回项目总览链接和“尚未上传资料”空态 | 通过 |

## Smoke 中发现并修复的问题

Dashboard 首次渲染时，项目名称被放在介绍段落 `<p class="page-intro">` 内的另一个 `<p>` 中。React 测试输出确认该结构会导致 hydration 错误。

处理结果：

1. 在 `ProjectDashboardPage.test.tsx` 增加回归断言，确认项目名不属于 `.page-intro`。
2. 将项目名移动为独立段落。
3. 浏览器重新加载后，DOM 快照显示项目名和介绍文案为两个并列段落。

## 文件选择器结果与限制

为 smoke 生成了两个不含用户数据的本地合成文件：

- `smoke.pdf`：47 bytes
- `smoke.xlsx`：16,432 bytes，包含 `Operating` 工作表和两行冲突数据

PDF 上传尝试按浏览器控制文档执行：先等待 `filechooser`，再点击页面的 `input[type="file"]`。该浏览器调用约 951.7 秒没有返回，最终被人工中止。配置在 `waitForEvent` 上的 10 秒等待没有终止外层浏览器工具调用。

因此：

- 未确认 PDF 是否通过真实浏览器文件选择器写入资料中心。
- 未在真实浏览器中执行 Excel 文件选择、Worker 解析、工作表选择和字段映射。
- 不得把下面的集成测试补证表述为浏览器上传实测。

## Phase D 集成测试补证

独立自动化测试：`app/src/integration/investment-due-diligence-flow.test.tsx`。

该测试在 Vitest、fake-indexeddb 和真实领域/仓储代码下验证：

1. 使用 Node 原生 `File` 通过 `FileVault.store()` 保存 Excel 文件，并在 IndexedDB 重开后保留项目和文件记录。
2. 通过 Data Room 组件重新打开已保存 Excel。
3. 调用真实 `inspectWorkbookInWorker()` 边界，并使用 fake Worker 返回经过边界校验的工作簿消息。
4. 在映射 UI 中把 Company、Description、Period、Revenue、Margin、ARR 六列映射到规范字段。
5. 两行数据生成 12 条证据；重建数据库连接、repositories 和组件后重复导入，证据 ID 稳定且不重复。
6. Revenue、Gross Margin 和 ARR 形成 3 组未解决冲突。
7. `higher_is_better` 冲突解析为营业收入选择保守值 `100`。
8. Dashboard 完整度为 `100%`，但因 3 组冲突保持“尚未就绪”。

这些结果补证本地 FileVault、IndexedDB、Worker 边界、Excel 映射、冲突和 readiness 代码链路；它们不补证 Chrome/Edge 原生文件选择器本身。

## 总结

- 浏览器已验证：项目列表、新建多模板项目、Dashboard 导航与初始准备度、服务重启后的项目持久化、Data Room 路由与空态。
- 浏览器未验证：真实 PDF/Excel 文件选择与上传，以及浏览器内 Excel 映射。
- 自动化集成测试已验证：真实 File 对象进入 FileVault、IndexedDB 持久化、fake Worker 消息边界、Excel 映射、稳定回放、冲突保守值和导出阻塞。
