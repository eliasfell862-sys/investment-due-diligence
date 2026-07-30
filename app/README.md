# 投资尽调模型 Investment Due Diligence

面向一级市场投资者（PE/VC/天使）的本地优先尽调工作台。纯前端离线运行，部署后任何设备浏览器打开即用。

**线上地址：** [https://investment-dd.netlify.app/](https://investment-dd.netlify.app/)

---

## 分析模块（24 个）

### 基础录入
- 公司概览、团队评估、产业链与市场、竞品对比、产品与技术

### 财务与估值
- 财务分析（P&L / 现金流 / 单位经济 / SaaS / 消费品 / 硬科技指标）
- 估值模型（DCF 快速估算 + WACC×永续增长率 5×5 敏感度热力图）
- 股权与融资
- 退出路径（MOIC / IRR 自动计算）

### PE 专用
- LBO 杠杆收购模型（Sources & Uses、债务偿还表、现金流瀑布、5×5 IRR 敏感度矩阵）
- 回报归因 Value Bridge（EBITDA增长 / 倍数变化 / 债务偿还 / FCF 四因子拆解 + 瀑布图）
- 盈利质量 QoE（报告 EBITDA → Normalized EBITDA，10 类调整项，行业模板，可信度评分）

### 风险与决策
- 风险评估（9 类风险矩阵 + 致命缺陷检测 + 9 维雷达图 + 38 条条款建议）
- 投资建议（6 维质量评分 + 判定引擎 + 关键假设 + 反面逻辑）

### VC / 天使专用
- 创始人评估（6 维度结构化评分 + 团队完备度）
- 竞品地图（SVG 气泡图，规模×增速×融资额，对数/线性轴切换）
- Deal Memo（一页投资备忘录，自动填充，一键复制）

### 数据与搜索
- 销售分析、采购分析、融资历史、合同台账
- 自定义字段
- AI 综合分析
- 资料中心（上传 Excel/PDF/Word/PPT，AI 字段提取）
- **公司信息搜索引擎**（AI 20 路并行查询，覆盖概览/团队/行业/竞品/产品/财务/估值/融资/供应链/风险/用户增长/技术栈/合作/监管/ESG/并购/舆情/人才/定价/国际化）

### 报告
- 投资报告预览 + Word (.docx) 导出（宋体，四号标题，小四正文，20 磅行距）

---

## 图表系统（纯 SVG，零依赖）

- 风险雷达图（9 维）
- 估值敏感度热力图（5×5）
- 回报归因瀑布图
- 财务趋势折线图
- 竞品气泡图

---

## 本地启动

环境要求：Node.js `^20.19.0`、`^22.12.0` 或 `>=24.0.0`。

```powershell
cd app
npm install
npm run dev
```

Vite 默认在 `http://localhost:5173/` 启动。

生产构建：

```powershell
npm run build
npm run preview
```

部署：构建后将 `app/dist` 文件夹拖到 [Netlify Drop](https://app.netlify.com/drop) 即可上线。

---

## 本地存储与隐私

- 项目、证据和原始文件保存在当前浏览器 IndexedDB 中（数据库名 `investment-due-diligence`）。
- 没有云同步、账户系统、多人协作或远程备份。
- 清理浏览器数据或切换配置文件可能导致数据不可恢复。
- Excel 在 Web Worker 中解析，不阻塞主线程。
- AI 调用直接发往用户配置的 API 端点（DeepSeek / OpenAI / Ollama），不经过中间服务器。

---

## 文件格式与限制

- Excel：`.xlsx`、`.xls`
- PDF：`.pdf`
- Word：`.doc`、`.docx`
- PowerPoint：`.ppt`、`.pptx`

限制：单文件 ≤ 100 MiB，单次 ≤ 50 文件，总大小 ≤ 250 MiB。

---

## 验证命令

```powershell
npm run check     # TypeScript + Vitest + Oxlint
npm run build     # 生产构建
npm audit --offline --audit-level=high
```
