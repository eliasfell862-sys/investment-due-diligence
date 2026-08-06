# 投资尽调模型 Investment Due Diligence

面向一级市场投资者（PE/VC/天使）的本地优先尽调工作台。纯前端离线运行，部署后任何设备浏览器打开即用。

**线上地址：[https://investment-dd.netlify.app/](https://investment-dd.netlify.app/)**

## 快速开始

```bash
cd app
npm install
npm run dev
```

打开 Vite 打印的地址（通常是 `http://localhost:5173`）。

## 桌面应用

```bash
npm run electron:dev       # 开发模式热加载
npm run electron:build     # 构建 .exe
npm run electron:dist      # 构建 .msi 安装包
```

输出在 `app/release/`。

## 功能

### 24 个分析模块

| 分类 | 模块 |
|------|------|
| 基础录入 | 公司概览、团队评估、产业链与市场、竞品对比、产品与技术 |
| 财务与估值 | 财务分析、估值模型（DCF + 热力图）、股权与融资、退出路径 |
| PE 专用 | LBO 杠杆收购模型、回报归因 Value Bridge、盈利质量 QoE |
| 风险与决策 | 风险评估（雷达图 + 条款建议）、投资建议（判定引擎） |
| VC/天使 | 创始人评估（6 维评分）、竞品地图（气泡图）、Deal Memo |
| 数据与搜索 | 销售分析、采购分析、融资历史、合同台账、AI 综合分析 |
| 报告 | 投资报告预览 + Word (.docx) 导出 |
| 搜索 | 公司信息搜索引擎（AI 20 路并行查询 + 一键填充） |

### 图表系统（纯 SVG，零依赖）

雷达图 · 热力图 · 瀑布图 · 趋势折线图 · 竞品气泡图

### 7 个计算引擎

- **决策引擎** — 阶段加权评分，5 级投资判定
- **风险引擎** — 残余风险评分、致命缺陷、损失概率、条款映射
- **估值引擎** — DCF + 可比公司 + VC 法 + LBO
- **股权引擎** — 股权结构表、清算瀑布、投资者回报
- **预测引擎** — 三情景预测（36/48/60 个月）
- **公式引擎** — 13 个财务指标定义
- **回报归因** — EBITDA增长 / 倍数变化 / 债务偿还 / FCF 四因子拆解

### 三套独立交易记录

- **历史回测**：使用历史K线验证策略。
- **前向模拟**：实时信号触发后自动进行100股虚拟成交，并记录T+1、持仓和盈亏。
- **实际持仓**：只有用户确认交易后才更新，绝不与虚拟账本混算。

### AI 能力

- 文档 AI 提取（PDF/Word/PPT → 结构化字段）
- AI 公司研究（20 路并行查询 → 14 个模块自动填充）
- AI 综合分析
- 支持 DeepSeek / OpenAI / Ollama / Kimi / 自定义端点

### Word 报告

一键导出 .docx，宋体排版，含封面、目录、财务表、风险矩阵、竞品对比。

## 架构

```
app/src/
├── domain/          # 纯 TypeScript 领域模型
├── engines/         # 7 个计算引擎（零 UI 依赖）
│   ├── decision/    # 投资决策引擎
│   ├── risk/        # 风险引擎
│   ├── valuation/   # DCF/可比/VC/LBO/回报归因/QoE
│   ├── equity/      # 股权结构表/清算瀑布
│   ├── forecast/    # 三情景预测
│   ├── formulas/    # 公式字典
│   └── team/        # 创始人评估
├── infrastructure/  # IndexedDB、解析、搜索、Word 导出
├── features/        # React UI（24 个分析模块 + 资料中心 + 报告）
└── app/             # 路由、状态管理
```

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19、TypeScript、Vite |
| 数据 | IndexedDB (Dexie)、Zod |
| 图表 | 纯 SVG（零依赖） |
| 报告 | docx (Word)、pdfjs-dist (PDF) |
| 计算 | decimal.js（40 位精度） |
| 桌面 | Electron + electron-builder |
| 测试 | Vitest、Testing Library（1,535 测试） |

## 数据隐私

所有项目数据存储在浏览器 IndexedDB 中，不上传云端。AI 调用直接发往用户配置的 API 端点，不经过中间服务器。API Key 存在 localStorage，不会写入报告或日志。

## License

MIT
