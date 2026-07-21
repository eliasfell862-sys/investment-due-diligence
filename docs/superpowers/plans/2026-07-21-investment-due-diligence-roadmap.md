# 一级市场投资尽调模型实施路线图

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each phase plan task-by-task.

**Goal:** 分五个可独立验收阶段交付完整的本地一级市场投资尽调、计算、决策和 Word 报告工具。

**Architecture:** 前端优先，领域计算与 UI 分离，IndexedDB 本地持久化，联网研究作为可选适配器。每个阶段完成后都保持应用可运行、数据可迁移和测试可验证。

**Tech Stack:** React、TypeScript、Vite、Dexie、Zod、decimal.js、SheetJS、ECharts、docx、Vitest、Testing Library。

---
本规格包含多个可独立验收的子系统，因此拆成五份实施计划，按依赖顺序推进。

## 阶段 1：项目框架与数据证据底座

交付一个可运行的本地网页：创建项目、选择并组合行业模板、上传并本地保存文件、导入并映射 Excel、保存结构化证据、按指标方向保守处理冲突、展示数据完整度和冲突告警。

详细计划：`docs/superpowers/plans/2026-07-21-investment-due-diligence-foundation.md`

## 阶段 2：计算、估值、风险与投资判定引擎

交付高精度公式字典、财务指标、三情景预测、DCF/可比/VC 法、Cap Table 稀释、IRR/MOIC、风险树、双损失概率、阶段权重、致命缺陷和五档判定。所有引擎先写测试，且不依赖 UI。

## 阶段 3：11 个分析模块与行业工作台

交付公司、团队、产业链、竞品、产品、财务、估值、股权、风险、退出和投资建议页面；完成文本型 PDF 提取与引用定位；完成 SaaS、消费品、硬科技/制造模板；支持模板组合和自定义指标；实现风险—条款联动和逻辑链编辑。

## 阶段 4：图表与 Word 报告引擎

交付 IC 快速备忘录和完整尽调报告；生成产业链、竞品、财务、估值、稀释、风险和回报图表；执行导出前校验、快照锁定、DOCX 生成和黄金样本验证。

## 阶段 5：可选联网研究与生产级加固

交付可插拔 AI/API 适配器、来源与日期标注、最小数据发送、会话级密钥管理、失败降级、项目备份恢复、性能和浏览器兼容性测试。联网模块不可改变核心计算和判定。

每个阶段完成后必须保持应用可运行、测试通过、数据可迁移，并单独提交可审阅的变更。
