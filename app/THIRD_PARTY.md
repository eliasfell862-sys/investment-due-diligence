# 第三方代码与数据来源清单

## 数据源

| 来源 | 用途 | 接口 | 授权 |
|------|------|------|------|
| 腾讯行情 `qt.gtimg.cn` | A 股实时行情、基金净值、可转债行情 | XHR | 公开免费 |
| 腾讯 K 线 `web.ifzq.gtimg.cn` | A 股历史 K 线数据 | XHR | 公开免费 |
| 东方财富 `datacenter-web` | 可转债列表、国债收益率（部分） | XHR | 公开免费 |
| 东方财富 `fundmobapi` | 基金持仓数据 | fetch | 公开免费 |
| 东方财富 `fundsuggest` | 基金搜索 | JSONP | 公开免费 |
| BaoStock `baostock` | A 股基础信息（股票名称/代码） | Python SDK | 开源 Apache 2.0 |
| 新浪财经 `hq.sinajs.cn` | 海外股票行情（美股/港股） | XHR | 公开免费 |

## GitHub 开源项目引用

| 项目 | 作者 | 用途 | 许可证 |
|------|------|------|--------|
| [InStock](https://github.com/myhhub/stock) | myhhub | 技术指标算法（MACD/KDJ/RSI/BOLL 等）、K 线形态识别、选股策略逻辑 | MIT |
| [TradingAgents-CN](https://github.com/hsliuping/TradingAgents-CN) | hsliuping | 多智能体辩论分析架构（多头/空头/风控/估值/策略） | Apache 2.0 |
| [real-time-fund](https://github.com/hzm0321/real-time-fund) | hzm0321 | 基金实时估值、持仓管理、交易记录 | MIT |
| [efinance](https://github.com/Micro-sheep/efinance) | Micro-sheep | 东方财富 API 封装、股票/基金/债券/期货数据接口文档 | MIT |
| [FinanceDatabase](https://github.com/JerBouma/FinanceDatabase) | JerBouma | 全球 ETF 分类数据（320 家族/51 类别） | MIT |

## 本地数据文件

| 文件 | 来源 | 记录数 | 更新方式 |
|------|------|--------|---------|
| `public/data/a-share-directory.json` | BaoStock + 启发式分类 | 5,203 只 | 手动更新 |
| `public/data/a-share-etfs.json` | 人工整理 | 38 只 | 手动更新 |

## 免责声明

- 行情数据来自公开免费接口，延迟约 3 秒，不保证实时性
- 技术指标分析结果仅供学习参考，不构成投资建议
- 所有第三方代码均已标注原始仓库及许可证
- 本项目的 AI 分析功能使用用户自行配置的 AI 模型（DeepSeek/OpenAI/Ollama）
