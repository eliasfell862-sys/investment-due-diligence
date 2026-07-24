# 阶段 2：计算、估值、风险与投资判定引擎设计

## 1. 目标

阶段 2 交付六个不依赖 UI、Dexie 或浏览器环境的纯领域引擎：

1. 公式字典引擎；
2. 三情景预测引擎；
3. 估值引擎；
4. 股权与稀释引擎；
5. 风险引擎；
6. 投资判定引擎。

所有引擎必须测试先行、结果可序列化、计算过程可追溯，不得输出 `NaN`、`Infinity`、隐式单位换算或伪精确结论。阶段 2 只提供领域契约、纯函数与测试，不新增 UI、路由、IndexedDB 表、报告或联网能力。

## 2. 已批准的数值口径

- 所有金额计算使用项目私有的 `Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN })`。
- 公共输入与输出使用规范十进制字符串；`Decimal` 实例不得越过引擎边界或写入持久层。
- 金额统一使用项目基准币种的主单位。`Project.amountUnit` 只允许在输入适配层换算一次。
- 阶段 2 不提供 FX 引擎。混合币种返回 `currency_mismatch`，不得隐式换算。
- 所有百分比语义均使用小数比例字符串，例如 `25%` 表示为 `"0.25"`，不得混用百分数点。
- 取值域按字段语义分别校验：概率、普通持股比例、税率和缓释有效性使用 `[0, 1]`；用于交易约束的 `targetOwnership` 使用 `(0, 1]`；WACC 使用 `(0, 1]`；增长率和折溢价允许负值；IRR 必须大于 `-1` 且允许大于 `1`；普通 MOIC 可为 `0`，但作为估值反推目标的 `targetMoic` 必须严格大于 `0`；期间长度不得为负，估值持有期必须严格大于 `0`。
- 现有 `targetOwnershipPct: "10"` 和 `targetIrrPct: "25"` 由适配层转换为 `"0.10"` 和 `"0.25"`，不得直接传入引擎。
- 引擎内部不按展示位数提前舍入；展示小数位由后续 UI 和报告层负责。

## 3. 架构

采用纯函数引擎 DAG：

```text
正式证据 / 投资者假设 / 项目配置
                |
                v
        输入适配与快照构建
                |
                v
共享 Decimal / Money / Ratio / Period / Scenario / EngineResult 契约
       |                    |                         |
       v                    v                         v
  公式字典 ----------> 三情景预测 ----------> 估值 ----------> 股权与稀释
       |                                              |
       +---------------- 风险 ------------------------+
                              |
                              v
                         投资判定
```

原始 `EvidenceItem` 不直接进入任何引擎。适配层负责完成正式值选择、冲突检查、来源类型限制、单位换算、币种校验、期间映射和旧百分数字段迁移。引擎只消费已经锁定的只读 DTO。

### 3.1 版本化输入快照与引擎边界

适配层输出的每个分析值同时携带 `valueRef`、单位、期间、来源引用和冲突状态。冲突状态为 `none | resolved | conservative-selected | blocking`；`conservative-selected` 允许计算但必须产生 `unresolved_conflict` 警告并保留选择理由，`blocking` 禁止进入要求确定值的公式、估值和回报计算。引擎不反向读取证据表。

跨引擎只传递版本化只读 DTO：

- 公式字典提供唯一的基础指标计算与轨迹实现；预测引擎复用公式定义或其纯函数，不复制第二套 FCF/利润率口径；
- 预测输出 `ForecastSnapshot`，向估值提供年度 FCFF，向风险提供下行情景现金断裂和融资缺口；
- 估值输出 `ValuationSnapshot`，向股权、风险和判定提供方法区间、覆盖度和安全边际；
- 股权输出 `ReturnSnapshot`，向风险和判定提供各情景所得、MOIC、XIRR 和不可计算原因；
- 风险输出 `RiskSnapshot`，只消费上述快照，不自行重算预测、估值或回报；
- 投资判定消费 readiness、valuation、returns 和 risk 快照，并把所有上游版本及 trace 引用写入逻辑链。

上游结果不可用时，下游按显式覆盖度降级，不补造数值。

建议目录：

```text
app/src/domain/analysis/
  decimal.ts
  value.ts
  period.ts
  scenario.ts
  engine-result.ts
  calculation-trace.ts

app/src/engines/formulas/
app/src/engines/forecast/
app/src/engines/valuation/
app/src/engines/equity/
app/src/engines/risk/
app/src/engines/decision/
```

## 4. 共享领域契约

### 4.1 数值和值类型

```ts
type DecimalString = string;
type FractionString = DecimalString;
type UnitIntervalString = FractionString;
type ProbabilityString = UnitIntervalString;
type OwnershipString = UnitIntervalString;
type NonNegativeRateString = FractionString;
type SignedRateString = FractionString;
type ReturnRateString = FractionString;
type MultipleString = DecimalString;

interface MoneyValue {
  readonly amount: DecimalString;
  readonly currency: CurrencyCode;
}

type CountKind = 'customer' | 'user' | 'unit' | 'share' | 'order';
type AnalysisUnit =
  | { readonly kind: 'currency'; readonly currency: CurrencyCode }
  | { readonly kind: 'ratio'; readonly rateKind: 'unit-interval' | 'non-negative-rate' | 'signed-rate' | 'return-rate' }
  | { readonly kind: 'multiple' }
  | { readonly kind: 'duration'; readonly durationUnit: 'months' | 'days' | 'years' }
  | { readonly kind: 'count'; readonly countKind: CountKind }
  | { readonly kind: 'currency-per-count'; readonly currency: CurrencyCode; readonly countKind: CountKind; readonly perPeriod?: 'month' | 'year' };

interface MetricValue {
  readonly value: DecimalString;
  readonly unit: AnalysisUnit;
}
```

`CurrencyCode` 必须是大写三字母 ISO 4217 代码。`currency` 和 `currency-per-count` 单位必须携带币种，`count` 必须携带业务计数类型；不同计数类型不得仅因都叫 `count` 而相乘或相除。解析器必须拒绝空字符串、非有限值、十六进制、混合分隔符和字段语义之外的取值。金额允许负数；是否有业务意义由具体公式决定。

### 4.2 期间

```ts
interface FlowPeriod {
  readonly kind: 'flow';
  readonly id: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly durationMonths: number;
  readonly granularity: 'month' | 'year';
}

interface AsOfPeriod {
  readonly kind: 'as-of';
  readonly id: string;
  readonly date: string;
}

type AnalysisPeriod = FlowPeriod | AsOfPeriod;
```

日期统一为真实存在的 ISO `YYYY-MM-DD` 公历日期，区间首尾均包含。月度 `FlowPeriod` 必须从月初到月末；年度 `FlowPeriod` 必须由连续 12 个月度期间组成；`durationMonths` 必须等于首尾月份差加一，否则输入无效。公式定义必须声明 `same-flow-period`、`same-as-of`、`ordered-as-of-endpoints` 或 `mixed-stock-flow` 期间策略；不满足策略时返回 `period_mismatch`，不得自动猜测。

预测引擎使用 36–60 个从预测起始月连续生成的月度期间，并按每连续 12 个月形成 `model-year-1`、`model-year-2` 等年度汇总，不因自然年边界产生不完整年度。DCF 消费这些模型年度 FCFF。Cap Table 使用 `AsOfPeriod`；XIRR 现金流使用独立 ISO 日期并采用 Actual/365 日计数。

### 4.3 情景

```ts
type ScenarioId = 'downside' | 'base' | 'upside';

interface ScenarioDefinition<TAssumptions> {
  readonly id: ScenarioId;
  readonly probability: ProbabilityString;
  readonly assumptions: TAssumptions;
}
```

情景集合必须恰好包含三个唯一情景，概率使用 Decimal 精确合计为 `1`。引擎不提供隐式默认概率。

### 4.4 结果、诊断和轨迹

```ts
type EngineResult<T> =
  | { readonly status: 'ok'; readonly value: T; readonly warnings: readonly EngineIssue[]; readonly trace: CalculationTrace }
  | { readonly status: 'blocked'; readonly reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful'; readonly issues: readonly EngineIssue[]; readonly trace: CalculationTrace };
```

稳定诊断码至少包括：

- `missing_input`；
- `invalid_decimal`；
- `value_out_of_range`；
- `currency_mismatch`；
- `unit_mismatch`；
- `period_mismatch`；
- `division_by_zero`；
- `non_positive_denominator`；
- `probability_sum_mismatch`；
- `circular_dependency`；
- `unsupported_formula`；
- `root_not_found`；
- `insufficient_comparables`；
- `invalid_terminal_value`；
- `unresolved_conflict`。

`CalculationTrace` 使用数组和普通对象记录公式 ID、版本、输入引用、中间值、规则结果和最终值，不暴露 `Map`、`Set` 或函数。所有成功与阻塞结果均 deep-freeze。

公开 API 的错误边界固定如下：

| 情况 | 处理 |
| --- | --- |
| DTO 缺字段、字段类型错误、未知公共 `formulaId`、注册表 AST 损坏 | 抛出带稳定 code 的 `DomainContractError` |
| 公共 ID 存在，但请求的版本或当前引擎上下文不支持 | `blocked/invalid-input + unsupported_formula` |
| DTO 结构合法，但十进制、值域、单位、币种或期间非法 | 返回 `EngineResult.blocked` 和对应 issue |
| 数据缺失、冲突阻断或业务上无意义 | 返回 `EngineResult.blocked`，不抛异常 |

字符串 `"abc"`、非有限值和越界概率属于“结构合法但值非法”；缺少 `value` 字段或传入数字代替规范字符串属于“DTO 结构损坏”。

## 5. 公式字典引擎

### 5.1 边界

```ts
evaluateMetric(input: MetricEvaluationInput): EngineResult<MetricCalculation>
evaluateFormulaGraph(input: FormulaGraphInput): EngineResult<FormulaGraphResult>
```

公式由固定注册表和受限 AST 定义，不执行任意字符串、`eval` 或动态函数。每个定义包含稳定 ID、版本、输入单位、输出单位、期间规则、分母策略和方向。

### 5.2 v1 规范公式表

`formulaId` 与 `version` 分离存储；以下 ID 的初始版本均为 `1`，轨迹使用 `formulaId@version`。

| formulaId | 输入与符号约定 | 公式 | 输出 | 期间策略 | 字段与业务约束 |
| --- | --- | --- | --- | --- | --- |
| `gross_margin` | `revenue`、`cost_of_goods_sold` 为同币种流量 | `(revenue - cost_of_goods_sold) / revenue` | signed-rate ratio | same-flow-period | revenue 必须严格为正；允许负毛利率 |
| `ebitda_margin` | `ebitda`、`revenue` 为同币种流量 | `ebitda / revenue` | signed-rate ratio | same-flow-period | `revenue <= 0` |
| `free_cash_flow` | `operating_cash_flow` 可正可负；`capital_expenditure` 是非负现金流出额 | `operating_cash_flow - capital_expenditure` | currency | same-flow-period | CapEx 不得为负 |
| `burn_multiple` | `net_cash_burn`、`net_new_arr` 为同币种流量 | `net_cash_burn / net_new_arr` | multiple | same-flow-period | `net_new_arr <= 0` |
| `cac_payback_months` | `customer_acquisition_cost` 为每新客金额；`monthly_gross_profit_per_new_customer` 为每新客每月金额 | `customer_acquisition_cost / monthly_gross_profit_per_new_customer` | months | same-flow-period | 月度单客新增毛利 `<= 0` |
| `cash_runway_months` | `cash_balance` 为期末存量；`monthly_net_cash_burn` 为下一月或明确的代表月现金消耗 | `cash_balance / monthly_net_cash_burn` | months | mixed-stock-flow | 现金余额 `< 0` 或月净消耗 `<= 0` |
| `revenue_cagr` | `beginning_revenue`、`ending_revenue` 为有序端点；`duration_years = durationMonths / 12` | `(ending_revenue / beginning_revenue) ^ (1 / duration_years) - 1` | signed-rate ratio | ordered-as-of-endpoints | 期初收入 `<= 0`、期末收入 `< 0` 或期限 `<= 0` |
| `customer_concentration` | `concentrated_customer_revenue` 是调用方明确的 Top 1 或 Top N 汇总，口径写入输入标签；`total_revenue` 为同期间总收入 | `concentrated_customer_revenue / total_revenue` | unit-interval ratio | same-flow-period | 总收入 `<= 0` 或分子不在 `[0, total]` |
| `repeat_purchase_rate` | `repeat_customers` 是观察窗内购买至少两次的唯一客户；`eligible_customers` 是同一观察窗内至少购买一次的唯一客户 | `repeat_customers / eligible_customers` | unit-interval ratio | same-flow-period | 分母 `<= 0` 或分子不在 `[0, denominator]` |
| `nrr` | `opening_recurring_revenue` 为期初 cohort ARR/MRR；扩张、收缩和流失只含该 cohort，均为非负金额 | `(opening + expansion - contraction - churn) / opening` | non-negative ratio，允许大于 `1` | mixed-stock-flow | opening 必须严格为正；变动额不得为负；`contraction + churn <= opening + expansion` |
| `ltv_cac` | `customer_lifetime_value` 与 `customer_acquisition_cost` 均为同币种每客户金额；LTV 由上游明确模型提供，本公式不推断 LTV | `customer_lifetime_value / customer_acquisition_cost` | multiple | same-as-of | CAC `<= 0` 或 LTV `< 0` |
| `inventory_turnover_days` | `average_inventory = (beginning_inventory + ending_inventory) / 2`；`period_days` 是流量期间实际公历天数 | `average_inventory / cost_of_goods_sold * period_days` | days | mixed-stock-flow | COGS `<= 0`、库存为负或天数 `<= 0` |
| `net_new_arr` | 期初与期末 ARR 为同币种有序端点 | `ending_arr - beginning_arr` | currency | ordered-as-of-endpoints | 端点不得倒置；ARR 不得为负 |

统一校验与错误优先级如下；同一输入同时命中多项时只按最先命中的类别决定主 issue，其余可作为附加 issue：

1. 缺失必需输入：`blocked/insufficient-data + missing_input`；
2. 十进制格式非法：`blocked/invalid-input + invalid_decimal`；字段或交叉字段值域非法：`blocked/invalid-input + value_out_of_range`；
3. 单位、币种或期间策略不匹配：`blocked/invalid-input + unit_mismatch | currency_mismatch | period_mismatch`；
4. 公式要求严格正分母时，分母等于零返回 `blocked/not-meaningful + division_by_zero`，分母小于零返回 `blocked/not-meaningful + non_positive_denominator`；
5. 通过上述基础校验后仍无业务解释的情形返回 `blocked/not-meaningful` 和公式专属 issue。

因此，币种错配永远优先于分母判断；`net_new_arr = 0` 唯一映射为 `division_by_zero`，`net_new_arr < 0` 唯一映射为 `non_positive_denominator`。合法计算可以返回零；阻塞或错误路径不得用零、无穷大或其他数字充当占位结果。

受限 AST 只允许 `literal`、`operand`、`formula-ref`、`add`、`subtract`、`multiply`、`divide` 和 `power` 节点。注册时验证节点形状、引用存在性和单位结果；运行时不执行任意字符串、条件表达式、函数或动态代码。

`evaluateFormulaGraph` 先按稳定 ID 排序建立依赖图，再做确定性拓扑排序。循环引用返回 `blocked/invalid-input + circular_dependency`，轨迹必须列出规范化后的循环路径。

## 6. 三情景预测引擎

### 6.1 输入与输出

```ts
forecastThreeScenarios(input: ThreeScenarioForecastInput): EngineResult<ScenarioForecastSet>
```

支持四种固定收入驱动和一个受限自定义乘法驱动：

- 客户数 × 客单价；
- 用户数 × ARPU；
- GMV × Take Rate；
- 销量 × 单价；
- 已声明单位的多个因子连乘。

每个情景覆盖 36–60 个月。输出包括月度模型、年度利润表汇总、现金流、FCFF、最低现金点和融资需求。

### 6.2 财务链

月度计算顺序固定为：

1. 收入驱动；
2. 收入；
3. 销售成本与毛利；
4. 销售、研发、管理费用；
5. EBITDA；
6. 折旧摊销与 EBIT；
7. 利息与税前利润；
8. 所得税；
9. 净利润；
10. 营运资本变动、CapEx 和经营现金流；
11. FCFF；
12. 期末现金与融资缺口。

v1 所得税使用 `max(税前利润, 0) × 税率`，不模拟递延所得税和亏损结转。营运资本、CapEx、折旧摊销和利息均由显式假设提供，不从缺失数据推断。每个月先把驱动假设解析为金额，再按以下固定符号计算：

```text
gross_profit = revenue - cost_of_goods_sold
ebitda = gross_profit - sales_and_marketing - research_and_development - general_and_administrative
ebit = ebitda - depreciation_and_amortization
pre_tax_income = ebit - interest_expense
income_tax = max(pre_tax_income, 0) * tax_rate
net_income = pre_tax_income - income_tax
operating_cash_flow = net_income + depreciation_and_amortization - increase_in_net_working_capital
free_cash_flow = operating_cash_flow - capital_expenditure
fcff = ebit - max(ebit, 0) * tax_rate + depreciation_and_amortization - capital_expenditure - increase_in_net_working_capital
pre_financing_ending_cash = beginning_cash + free_cash_flow
financing_inflow = max(minimum_cash_balance - pre_financing_ending_cash, 0)
ending_cash = pre_financing_ending_cash + financing_inflow
```

销售成本、三项费用、折旧摊销、利息、CapEx 和营运资本增加均以非负现金消耗额输入；营运资本释放使用负的 `increase_in_net_working_capital`。融资算法按月即时补足到最低现金余额，累计 `financing_inflow` 即最小融资需求；首次非零月份是触发月份。引擎只输出融资快照，不自动创建融资轮次。年度汇总对流量求和，对期末现金等存量取模型年度最后一个月。

## 7. 估值引擎

估值引擎提供四个独立函数：

```ts
calculateDcf(input: DcfInput): EngineResult<DcfResult>
calculateComparableValuation(input: ComparableValuationInput): EngineResult<ComparableValuationResult>
calculateVcMethod(input: VcMethodInput): EngineResult<VcMethodResult>
triangulateValuations(input: ValuationTriangulationInput): EngineResult<ValuationRange>
```


所有 `ValuationSnapshot` 区间统一表示估值日的当前 pre-money 股权价值。DCF 的净债务桥只使用投资前资产负债表现金，不包含拟议新增投资；可比公司和 VC 法也必须桥接到同一 pre-money 基准。需要 post-money 值时统一使用 `postMoneyEquityValue = preMoneyEquityValue + investmentAmount`，三角验证不得混合 pre-money、post-money、企业价值或不同估值日。
### 7.1 DCF

- 估值日固定为首个预测模型年度开始日前一日；v1 只接受完整的连续 12 个月模型年度，不接受部分年度；
- 年末折现的第 `t` 年指数为 `t`，年中折现为 `t - 0.5`；
- 永续增长终值位于第 `N` 年末：`TV = FCFF_N × (1 + g) / (WACC - g)`，强制 `WACC > g`；
- 退出倍数终值位于第 `N` 年末：`TV = terminal_metric_N × exit_multiple`，终值指标和单位必须显式声明；
- 年中惯例只影响逐年 FCFF；两种终值都位于第 `N` 年末并始终使用指数 `N` 折现；所有年度 FCFF 与终值现值之和为企业价值；
- `netDebt = interestBearingDebt - cashAndCashEquivalents`，股权价值为 `enterpriseValue - netDebt`，净现金因此提高股权价值；
- 输出两种终值、终值占比、关键假设和版本化敏感性矩阵，不输出未声明权重的伪单点。

### 7.2 可比公司

- 支持 EV/Revenue、EV/EBITDA 和 P/E；负 EBITDA 不进入 EV/EBITDA 样本，负净利润不进入 P/E 样本；
- 每个倍数至少需要 3 个有效样本，否则该倍数返回 `insufficient_comparables`；
- 样本先按规范化公司 ID 去重并按倍数、公司 ID 稳定排序；中位数和 25/75 分位数使用 Hyndman-Fan Type 7 线性插值；
- 增长、利润、规模和流动性折溢价逐项以小数比例相加，每项先限制在 `[-0.50, 0.50]`，再把总和限制在 `[-0.50, 0.50]`；
- 调整后倍数为 `rawMultiple × (1 + totalAdjustment)`；EV 倍数结果通过同一净债务桥转为股权价值，P/E 直接得到股权价值；
- 每种有效倍数分别输出 P25/中位数/P75，不跨不同倍数直接平均。

### 7.3 VC 法与三角验证

VC 法要求 `holdingYears > 0`、`investmentAmount > 0`。若给定目标 MOIC，要求 `targetMoic > 0`；若给定目标 IRR，要求 `targetIrr > -1` 并使用 `targetMoic = (1 + targetIrr) ^ holdingYears`。两者同时提供时必须在 `1e-12` 内一致，否则返回 `invalid-input`。预期稀释是退出前本轮投资持股被稀释的比例，先反推 `impliedPostMoney = exitEquityValue × (1 - expectedDilution) / targetMoic`，再桥接 `impliedPreMoney = impliedPostMoney - investmentAmount`。`impliedPostMoney` 必须严格为正；`impliedPreMoney <= 0` 返回 `not-meaningful`，VC 的 `ValuationSnapshot` 输出统一使用 pre-money 值。

三角验证只接受同一估值日、同一币种、同为当前 pre-money 股权价值基准的低/中/高区间及权重，权重使用 Decimal 精确合计 `1`。不可用的方法不补造数值；调用方必须提供剔除后的新权重快照，否则返回 `invalid-input`。正式投资判定默认要求至少两种有效估值方法。

## 8. 股权与稀释引擎

```ts
modelCapTable(input: CapTableModelInput): EngineResult<CapTableModel>
calculateLiquidationWaterfall(input: LiquidationWaterfallInput): EngineResult<LiquidationWaterfall>
calculateInvestorReturns(input: InvestorReturnInput): EngineResult<InvestorReturnSet>
```

Cap Table 以完全稀释股份数为基础，持股比例只作为派生结果。支持：

- pre-money/post-money 定价轮；
- 多轮后续融资；
- ESOP 新设和扩池；
- `pre_money` 或 `post_money` 扩池时点；
- 多层清算优先级；
- 参与型与非参与型优先股；
- 清算倍数和参与上限；
- 自动比较优先清算所得与转普通股所得。

v1 不实现复杂反稀释重定价、可转债、SAFE 和期权归属明细；这些通过后续计划扩展。

定价轮中 `pricePerShare = preMoneyEquityValue / preRoundFullyDilutedShares`，`newShares = investmentAmount / pricePerShare`；若同时提供 post-money，必须与 `preMoney + investment` 一致。pre-money ESOP 扩池发生在定价前并由老股东承担，post-money 扩池发生在新股发行后并由全体股东承担。每个事件后完全稀释股份数必须等于各持有人股份之和，派生持股比例必须精确合计 `1`。

清算瀑布按数值越小越优先的 `seniorityRank` 执行；同级证券按各自未支付优先权金额比例分配。参与型先取优先权，再按转换后持股参与剩余分配，参与上限以原始投资额的声明倍数为总所得上限。

非参与型优先股的转股选择按组合求解，不得逐证券独立取最大值。v1 最多接受 12 个非参与型证券类别：按稳定 security ID 排序后枚举全部转换组合，对每个组合完整重算瀑布；组合只有在每个类别保持当前选择的所得都不低于单独翻转自身选择后的所得时才是自洽组合。若有多个自洽组合，选择转换布尔向量按 security ID 字典序最小的组合；无自洽组合或超过 12 类返回 `invalid-input`。每一级分配后剩余退出价值不得为负，所有持有人所得之和必须等于可分配退出价值。

XIRR 采用 Actual/365：`NPV(r) = Σ cashFlow_i / (1 + r) ^ (days_i / 365)`。v1 只接受一次符号变化的现金流序列；搜索区间从 `[-0.999999999999, 1]` 开始并把上界逐次翻倍至最多 `1000`，找到异号区间后最多二分 512 次。以 `scale = max(Σ |cashFlow_i|, 1)` 归一化，当 `|NPV| / scale <= 1e-20` 或利率括区间宽度 `<= 1e-24` 时收敛。无符号变化、超过一次符号变化、无括区间或未收敛均返回 `root_not_found`。MOIC 为总流入除以总流出；预期 MOIC 按情景概率加权投资人退出所得后再除以投入资本，不平均各情景 IRR。

## 9. 风险引擎

风险类别固定为市场、技术、客户、财务、融资、法律合规、治理、数据真实性和退出九类。

单项残余风险：

```text
发生概率 × 影响程度 × (1 - 缓释有效性)
```

三项输入均为 `[0,1]`。分类风险取该分类单项残余风险的最大值，避免重大风险被平均稀释。未提供项目权重时总体残余风险为九个分类风险的算术平均；自定义权重必须逐项位于 `[0,1]` 且 Decimal 精确合计 `1`。风险惩罚点为 `overallResidualRisk × 20`，作为独立输出，不改写基础质量分。

致命缺陷包含严重度 `pause | reject` 和状态 `open | covered | resolved`：

- `open + reject` 强制“不投资”；
- `open + pause` 强制“暂缓”；
- `covered` 必须带书面理由和绑定条件，判定最高只能为“有条件投资”；
- `resolved` 不再覆盖评分，但永久保留轨迹。

双损失概率不使用 Monte Carlo。若多条规则命中，选择表中靠前的最高严重度区间，并记录全部触发规则。

永久性损失建议区间：

| 规则 | 区间 |
| --- | --- |
| 存在 `open + reject` | `[0.75, 1]` |
| 存在 `open + pause` | `[0.50, 0.80]` |
| 下行情景现金断裂且下行 MOIC `< 1` | `[0.40, 0.70]` |
| 总体残余风险 `>= 0.67` | `[0.30, 0.60]` |
| 总体残余风险 `>= 0.33` | `[0.15, 0.35]` |
| 其他 | `[0.05, 0.20]` |

暂时性回撤建议区间：

| 规则 | 区间 |
| --- | --- |
| 退出延迟且估值安全边际 `< 0.15` | `[0.45, 0.75]` |
| 下行 MOIC `< 1` | `[0.35, 0.65]` |
| 估值安全边际 `< 0.20` | `[0.25, 0.50]` |
| 总体残余风险 `>= 0.33` | `[0.15, 0.40]` |
| 其他 | `[0.05, 0.25]` |

两个区间均带 `requiresInvestorConfirmation: true`；缺少规则所需上游快照时保留可计算的较低覆盖结果并列出缺口，不把缺失当成低风险。

## 10. 投资判定引擎

```ts
decideInvestment(input: InvestmentDecisionInput): EngineResult<InvestmentDecision>
```

六维质量评分使用现有阶段权重：

| 维度 | 早期 VC | 成长期 | PE/并购 |
| --- | ---: | ---: | ---: |
| 团队与治理 | 0.25 | 0.15 | 0.10 |
| 市场与产业链 | 0.20 | 0.15 | 0.10 |
| 产品、技术与壁垒 | 0.20 | 0.15 | 0.10 |
| 商业化与增长质量 | 0.15 | 0.20 | 0.15 |
| 财务与现金流质量 | 0.10 | 0.20 | 0.25 |
| 估值、回报与退出 | 0.10 | 0.15 | 0.30 |

每个维度输入 `rawScore ∈ [0,100]` 和 `evidenceConfidence ∈ [0,1]`，先按 `effectiveScore = 50 + (rawScore - 50) × evidenceConfidence` 向中性分收缩，再按阶段权重加权得到 `baseQualityScore`。项目可提供版本化权重覆盖，但六项权重必须 Decimal 精确合计 `1`；默认阈值和目标回报也可通过经过校验的项目快照覆盖，并在 trace 中同时记录默认值、覆盖值和理由。

`riskAdjustedQualityScore = baseQualityScore - riskPenaltyPoints`。默认规则按以下优先级执行，先命中的门槛覆盖后续评分：

| 优先级 | 条件 | 判定 |
| ---: | --- | --- |
| 1 | `open + reject` 致命缺陷、投资逻辑已证伪，或“下行 MOIC < 0.5 且永久性损失区间上界 >= 0.5” | `do_not_invest` |
| 2 | `open + pause`、阻断性冲突、报告准备度不足、有效估值方法少于 2、目标回报或回报快照不可计算 | `defer` |
| 3 | `baseQualityScore >= 80`、`riskAdjustedQualityScore >= 75`、风险惩罚 `<= 5`、无 open/covered 致命缺陷、基准 IRR `>= targetIrr + 0.05`、基准 MOIC `>= targetMoic × 1.15` 且下行 MOIC `>= 1` | `strong_recommend` |
| 4 | `baseQualityScore >= 70`、`riskAdjustedQualityScore >= 60`、基准 IRR 和 MOIC 达到目标，且剩余问题可由价格、条款或补充尽调形成可执行条件 | `conditional_invest` |
| 5 | `baseQualityScore >= 60` 且不存在更高优先级门槛，但仍有非阻断性里程碑待验证 | `observe` |
| 6 | 输入充分但 `baseQualityScore < 60` | `do_not_invest` |
| 7 | 其他无法形成可靠结论的情况 | `defer` |

任一 `covered` 致命缺陷都要求书面理由和绑定条件，并把最高判定限制为 `conditional_invest`。阈值相等时按“达到”处理。若只配置 IRR 或 MOIC 目标，规则只检查已配置目标；两个目标都缺失属于资料不足。

对于结构合法但资料不足的输入，`decideInvestment` 返回 `status: 'ok'` 且 `decision: 'defer'`，因为“暂缓”是产品需要展示的正式结论；输出包含缺失资料、验证动作和反转条件。只有判定 DTO 本身损坏、权重/阈值非法等契约问题才返回 blocked 或抛 `DomainContractError`。无法计算的基础分、最大可接受估值、目标持股或回报字段使用显式 `null`，不得填零。

目标持股优先取经过适配且严格大于零的 `DealProfile.targetOwnership`；未配置但已有严格正的投资额和严格正的最大 post-money 估值时，派生为 `investmentAmount / maximumAcceptablePostMoney`。最大可接受 pre-money 估值取可用约束的最小值：VC 法按目标回报反推的当前 pre-money 股权价值，以及持股约束值 `investmentAmount × (1 - targetOwnership) / targetOwnership`。最大可接受 post-money 估值为 `maximumAcceptablePreMoney + investmentAmount`，用于任何除法前必须验证严格为正。只存在一项约束时可使用该值但必须警告；两项都缺失时两个估值字段均输出 `null` 并触发 `defer`。

输出包括：五档判定、基础质量分、风险惩罚、风险调整质量分、阶段权重与覆盖审计、最大可接受估值、目标持股、关键假设、反方风险、先决条件、建议条款、验证清单、结论反转条件，以及“证据 → 指标 → 标准 → 投资含义 → 建议动作”的结构化逻辑链。

现有 `ReportReadiness.decisionState` 只代表报告准备度，不复用为投资判定枚举。

## 11. 错误处理与确定性

- 业务上的不可解释、缺数据和无意义计算返回 `EngineResult`，不抛异常。
- 领域异常与 blocked 结果严格遵循第 4.4 节错误矩阵；公开函数不得对同一类输入有时抛异常、有时返回 issue。
- 输入数组在计算前快照，不修改调用方数据。
- 所有排序使用稳定 tie-break；所有公式、规则和默认权重带版本。
- 禁止读取当前时间、随机数、浏览器全局、Dexie 或网络。
- 同一输入、公式版本和 Decimal 配置必须产生字节级一致的 JSON 输出。

## 12. 测试策略

每个引擎的测试只构造内存 DTO：

- 公式：手算黄金向量、单位/期间错配、零和负分母、极大数、长小数、依赖循环和轨迹；
- 预测：五类收入驱动、36/60 月边界、利润表和现金流勾稽、融资缺口、三情景概率、输入不变性；
- 估值：DCF 手算、`WACC <= g`、双终值、可比异常样本、折溢价边界、VC 反推和估值单调性；
- 股权：持股合计、ESOP 时点、多轮稀释、清算顺序、转股选择、XIRR 失败和概率加权所得；
- 风险：九类完整性、残余风险边界、致命缺陷覆盖、双损失区间和规则轨迹；
- 判定：三类阶段权重、60/70/80 边界、资料不足、致命缺陷、估值覆盖、回报门槛和逻辑链；
- 最后增加一个纯内存黄金项目，验证六引擎 DTO 串联，但不引入 UI 或数据库。

除例子测试外，使用 `it.each` 覆盖边界矩阵，并增加适合的单调性、守恒和输入顺序不变属性测试。

## 13. 实施拆分

阶段 2 拆成六份连续计划：

1. 共享契约与公式字典；
2. 三情景预测；
3. 估值；
4. 股权与稀释；
5. 风险；
6. 投资判定与纯内存跨引擎黄金测试。

每份计划均按 TDD 实施，每个任务使用独立实现子代理、独立规格审查和独立代码质量审查，审查通过后逐任务提交。风险引擎可在共享契约完成后与预测/估值链并行开发，但最终投资判定必须等待估值、股权和风险契约稳定。

## 14. 非目标

- UI、图表、报告和 IndexedDB 持久化；
- 汇率和跨币种转换；
- Monte Carlo 或黑箱概率模型；
- 任意字符串公式执行；
- 可转债、SAFE、复杂反稀释和期权归属明细；
- 递延所得税、亏损结转和完整债务摊销表；
- AI 修改公式、风险等级或投资结论。
