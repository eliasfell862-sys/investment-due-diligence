# 三情景预测引擎设计

**状态：** 已批准  
**日期：** 2026-07-27  
**上游规格：** `docs/superpowers/specs/2026-07-24-phase-two-analysis-engines-design.md`

## 1. 目标与范围

本设计交付阶段 2 的第二个纯领域引擎：

```ts
forecastThreeScenarios(
  input: ThreeScenarioForecastInput,
): EngineResult<ScenarioForecastSet>
```

引擎接收一份共享预测基准和悲观、基准、乐观三个完整且独立的情景假设，生成 36、48 或 60 个月的月度利润表、现金流、FCF、FCFF、模型年度汇总、最低现金点和最小融资需求。

本阶段不新增 UI、路由、数据库表、文件导入、报告、联网能力、融资轮次、利息反馈循环、股权稀释或估值逻辑。预测引擎只输出可供后续估值、股权、风险和投资判定引擎消费的冻结快照。

## 2. 已批准的关键决策

1. 三个情景分别提供完整、独立的预测假设，不采用基准情景继承或差异覆盖。
2. 币种、预测起始月、预测期限、期初现金和最低现金余额属于共享基准事实，不在情景中重复。
3. 预测期限只允许 `36 | 48 | 60` 个月，保证形成 3、4 或 5 个完整模型年度。
4. 收入因子和金额驱动使用“首个预测月最终值 + 月增长率 + 可选季节性”。月增长从第二个月开始生效。
5. 季节性使用按自然月排列的 12 个正乘数；Decimal 精确合计必须为 `12`，即算术平均值为 `1`。
6. 首月输入值是应用季节性后的最终首月值。引擎先反推出未季调趋势基准，再对每个月直接应用对应自然月乘数，不使用链式季节比值。
7. COGS、销售、研发和管理费用支持按收入比例或金额增长两种模式。
8. 收入比例模式按模型年度提供比例，每连续 12 个月使用同一比例，不做隐式插值或平滑。
9. 折旧摊销、利息、CapEx 和营运资本增加必须显式使用金额生成规则。
10. 所有算术使用 `AnalysisDecimal`，精度 40、舍入规则 `ROUND_HALF_EVEN`；公共边界只暴露规范十进制字符串。

## 3. 架构

采用分层确定性流水线：

```text
严格 DTO 快照
      |
      v
结构与业务值校验
      |
      v
假设展开为月度序列
      |
      v
三个情景逐月计算
      |
      v
模型年度与现金摘要聚合
      |
      v
冻结 ScenarioForecastSet + ForecastCalculationTrace
```

各层职责固定：

- 校验层只解析、规范化和报告问题，不计算预测结果；
- 序列层只负责增长、季节性和年度比例展开；
- 收入层只负责五类收入驱动的单位校验与乘法；
- 情景层按固定财务链逐月计算；
- 聚合层只对月度结果求模型年度和现金摘要；
- 入口层负责三个情景的稳定顺序、警告合并、轨迹组装和结果冻结。

不采用通用电子表格式 DAG，也不把全部逻辑写入一个逐月循环函数。文件按单一职责拆分，使每层可以独立测试和审查。

## 4. 输入契约

### 4.1 顶层与共享基准

```ts
type ForecastEngineVersion = '1';
type ForecastHorizonMonths = 36 | 48 | 60;

interface ThreeScenarioForecastInput {
  readonly version: ForecastEngineVersion;
  readonly baseline: ForecastBaseline;
  readonly scenarios: readonly ScenarioDefinition<ForecastScenarioAssumptions>[];
}

interface ForecastBaseline {
  readonly currency: CurrencyCode;
  readonly forecastStartMonth: string; // YYYY-MM
  readonly horizonMonths: ForecastHorizonMonths;
  readonly beginningCash: ForecastScalar;
  readonly minimumCashBalance: ForecastScalar;
}
```

`forecastStartMonth` 表示首个预测自然月。引擎生成从该月月初到月末的 `FlowPeriod`，之后逐月连续推进。共享现金字段必须是基准币种金额，且不得为负。

### 4.2 可审计标量

所有业务数值使用带来源的标量，而不是裸字符串：

```ts
interface ForecastScalar {
  readonly valueRef: string;
  readonly metricId: string;
  readonly value: MetricValue;
  readonly sourceRefs: readonly string[];
  readonly conflict: {
    readonly status:
      | 'none'
      | 'resolved'
      | 'conservative-selected'
      | 'blocking';
    readonly selectionReason?: string;
  };
}
```

`valueRef` 在整个请求内必须唯一。`blocking` 冲突阻止计算；`conservative-selected` 允许计算，但必须产生 `unresolved_conflict` 警告并保留选择理由。轨迹引用 `valueRef` 和 `sourceRefs`，不得反向读取证据数据库。

实现时把 `ConflictStatus` 与标量的公共字段提取到 `domain/analysis`，公式观察值和预测假设共同复用，避免形成两套冲突语义。

### 4.3 季节性与月度生成规则

```ts
interface SeasonalityPattern {
  readonly valueRef: string;
  readonly sourceRefs: readonly string[];
  readonly multipliers: readonly [
    DecimalString, DecimalString, DecimalString, DecimalString,
    DecimalString, DecimalString, DecimalString, DecimalString,
    DecimalString, DecimalString, DecimalString, DecimalString,
  ]; // January ... December
}

interface GeneratedValueRule {
  readonly startingValue: ForecastScalar;
  readonly monthlyGrowthRate: ForecastScalar;
  readonly seasonality?: SeasonalityPattern;
}
```

`startingValue` 是首个预测月应用季节性后的最终数值。`monthlyGrowthRate` 使用 signed-rate 小数比例。对必须保持非负的驱动和费用，要求 `monthlyGrowthRate >= -1`，且生成的每个月均不得为负。

未提供 `seasonality` 时，内部使用 12 个 `1`，但不会把隐式值伪装成用户输入或来源证据。

### 4.4 收入驱动

```ts
type RevenueModel =
  | {
      readonly kind: 'customer-count-times-average-revenue';
      readonly customerCount: GeneratedValueRule;
      readonly averageRevenuePerCustomer: GeneratedValueRule;
    }
  | {
      readonly kind: 'user-count-times-arpu';
      readonly userCount: GeneratedValueRule;
      readonly arpu: GeneratedValueRule;
    }
  | {
      readonly kind: 'gmv-times-take-rate';
      readonly gmv: GeneratedValueRule;
      readonly takeRate: GeneratedValueRule;
    }
  | {
      readonly kind: 'unit-sales-times-unit-price';
      readonly unitsSold: GeneratedValueRule;
      readonly unitPrice: GeneratedValueRule;
    }
  | {
      readonly kind: 'custom-product';
      readonly factors: readonly CustomRevenueFactor[];
    };

interface CustomRevenueFactor {
  readonly factorId: string;
  readonly rule: GeneratedValueRule;
}
```

固定模型的单位要求如下：

| 模型 | 第一个因子 | 第二个因子 | 输出 |
| --- | --- | --- | --- |
| 客户数 × 客单价 | customer count | currency/customer/month | currency/month |
| 用户数 × ARPU | user count | currency/user/month | currency/month |
| GMV × Take Rate | currency/month | non-negative ratio | currency/month |
| 销量 × 单价 | unit count | currency/unit | currency/month |

自定义乘法只允许 2–5 个因子。去除 ratio 因子后，单位组合必须为一个月度 currency，或一组匹配的 count 与 currency-per-count；不得接受 count×count、两个货币因子、币种混合或无法约简的单位。

### 4.5 费用、税率和现金流假设

```ts
interface RevenueRatioRule {
  readonly kind: 'revenue-ratio';
  readonly modelYearRates: readonly ForecastScalar[];
}

interface AmountGrowthRule {
  readonly kind: 'amount-growth';
  readonly rule: GeneratedValueRule;
}

type OperatingCostRule = RevenueRatioRule | AmountGrowthRule;

interface ForecastScenarioAssumptions {
  readonly revenue: RevenueModel;
  readonly costOfGoodsSold: OperatingCostRule;
  readonly salesAndMarketing: OperatingCostRule;
  readonly researchAndDevelopment: OperatingCostRule;
  readonly generalAndAdministrative: OperatingCostRule;
  readonly depreciationAndAmortization: AmountGrowthRule;
  readonly interestExpense: AmountGrowthRule;
  readonly capitalExpenditure: AmountGrowthRule;
  readonly increaseInNetWorkingCapital: AmountGrowthRule;
  readonly taxRate: ForecastScalar;
}
```

比例驱动的 `modelYearRates` 长度必须严格等于 `horizonMonths / 12`。比例使用 non-negative-rate，允许大于 `1`，因为亏损业务的 COGS 或费用可能超过收入。

COGS、三项费用、折旧摊销、利息和 CapEx 的生成金额必须逐月非负。`increaseInNetWorkingCapital` 允许为负，负值表示营运资本释放。税率使用 unit-interval，且在一个情景的完整预测期内保持不变。

## 5. 序列生成算法

### 5.1 直接季节计算

自然月乘数按 1 月至 12 月排列。设首个预测月对应乘数为 `S_start`，首月最终输入值为 `V_start`，月增长率为 `g`，第 `t` 月从零开始计数，则：

```text
trend_base = V_start / S_start
V_t = trend_base * (1 + g)^t * S_calendar(t)
```

因此：

- `V_0` 精确等于 `V_start`；
- 每月直接乘对应自然月乘数，不使用 `S_t / S_(t-1)` 的链式递推；
- 12 月到次年 1 月的跳变由 `S_December` 与 `S_January` 自然决定；
- 增长幂只由距首月的月数决定，季节变化不会污染长期增长基准；
- 计算全程使用 `AnalysisDecimal`，不把月份幂转换为 JavaScript `number` 算术。

季节乘数必须全部严格大于 `0`，并使用 Decimal 精确校验总和为 `12`。不接受近似容差。

### 5.2 年度比例

第 `t` 月使用：

```text
modelYearIndex = floor(t / 12)
expense_t = revenue_t * modelYearRates[modelYearIndex]
```

年度边界只由预测起始月起连续 12 个月划分，与自然年无关。例如从 2026-04 开始时，模型年度 1 为 2026-04 至 2027-03。

## 6. 月度财务链

每个情景、每个月严格按以下顺序计算：

```text
gross_profit = revenue - cost_of_goods_sold
ebitda = gross_profit
         - sales_and_marketing
         - research_and_development
         - general_and_administrative
ebit = ebitda - depreciation_and_amortization
pre_tax_income = ebit - interest_expense
income_tax = max(pre_tax_income, 0) * tax_rate
net_income = pre_tax_income - income_tax
operating_cash_flow = net_income
                      + depreciation_and_amortization
                      - increase_in_net_working_capital
free_cash_flow = operating_cash_flow - capital_expenditure
fcff = ebit
       - max(ebit, 0) * tax_rate
       + depreciation_and_amortization
       - capital_expenditure
       - increase_in_net_working_capital
pre_financing_ending_cash = beginning_cash + free_cash_flow
financing_inflow = max(
  minimum_cash_balance - pre_financing_ending_cash,
  0,
)
ending_cash = pre_financing_ending_cash + financing_inflow
```

首月 `beginning_cash` 来自共享基准，之后等于上月 `ending_cash`。融资按月即时补足到最低现金余额。引擎不把融资流入计入 FCF 或 FCFF，也不因融资自动生成利息或股权变化。

月度 `free_cash_flow` 必须复用公式字典 `free_cash_flow@1` 的既有实现或其共享纯算术边界，不复制第二套公式口径。预测轨迹合并该公式的输入与步骤。

## 7. 输出契约

```ts
interface ScenarioForecastSet {
  readonly version: ForecastEngineVersion;
  readonly currency: CurrencyCode;
  readonly forecastStartMonth: string;
  readonly horizonMonths: ForecastHorizonMonths;
  readonly scenarios: readonly ScenarioForecast[];
}

interface ScenarioForecast {
  readonly id: ScenarioId;
  readonly probability: ProbabilityString;
  readonly months: readonly MonthlyForecast[];
  readonly modelYears: readonly ModelYearForecast[];
  readonly cashSummary: ForecastCashSummary;
}

interface MonthlyForecast {
  readonly period: FlowPeriod;
  readonly driverValues: readonly ForecastDriverValue[];
  readonly revenue: DecimalString;
  readonly costOfGoodsSold: DecimalString;
  readonly grossProfit: DecimalString;
  readonly salesAndMarketing: DecimalString;
  readonly researchAndDevelopment: DecimalString;
  readonly generalAndAdministrative: DecimalString;
  readonly ebitda: DecimalString;
  readonly depreciationAndAmortization: DecimalString;
  readonly ebit: DecimalString;
  readonly interestExpense: DecimalString;
  readonly preTaxIncome: DecimalString;
  readonly incomeTax: DecimalString;
  readonly netIncome: DecimalString;
  readonly increaseInNetWorkingCapital: DecimalString;
  readonly operatingCashFlow: DecimalString;
  readonly capitalExpenditure: DecimalString;
  readonly freeCashFlow: DecimalString;
  readonly fcff: DecimalString;
  readonly beginningCash: DecimalString;
  readonly preFinancingEndingCash: DecimalString;
  readonly financingInflow: DecimalString;
  readonly endingCash: DecimalString;
}
```

`ScenarioForecastSet.currency` 是上述金额字符串的统一币种。`driverValues` 保留稳定 `factorId`、规范数值和单位，便于审计收入计算。

`ModelYearForecast` 对收入、成本、费用、利润、税、现金流、FCF、FCFF 和融资流入求和；对期初现金取模型年度首月值，对融资前期末现金和期末现金取模型年度最后一个月值。

`ForecastCashSummary` 至少包含：

- 整个预测期最低的 `preFinancingEndingCash` 及月份；
- 第一次 `financingInflow > 0` 的月份，若从未触发则省略；
- 所有月度融资流入之和，即最小融资需求；
- 最后一个预测月的融资后期末现金。

情景顺序固定为 `downside`、`base`、`upside`，不保留调用方输入顺序。所有成功和阻塞结果均为深冻结、可 JSON 序列化的快照。

## 8. 轨迹设计

现有 `CalculationTrace` 扩展为可辨识联合类型：

```ts
type CalculationTrace = FormulaCalculationTrace | ForecastCalculationTrace;

interface ForecastCalculationTrace {
  readonly engine: 'forecast';
  readonly forecastRef: 'three-scenario@1';
  readonly inputs: readonly TraceInput[];
  readonly scenarios: readonly ForecastScenarioTrace[];
}
```

轨迹要求：

- `inputs` 按 `valueRef` 稳定排序且全局唯一，记录规范值、单位和来源；
- 每个情景按固定 ID 排序，每个月按期间顺序记录步骤；
- 月度步骤使用稳定 ID，例如 `base:2026-04:revenue`；
- 记录序列展开、收入因子乘法、年度比例选择、财务链、FCF 公式引用、融资补足和年度聚合；
- 阻塞步骤不写伪造 `result`；
- 不暴露 `Decimal`、`Map`、`Set`、函数或可变对象；
- 相同输入重复运行产生逐字节一致的 JSON 输出和轨迹。

## 9. 错误边界与优先级

### 9.1 结构错误

缺字段、字段类型错误、未知联合类型 `kind`、稀疏数组、类实例、访问器属性、循环对象或非普通 JSON DTO 抛出：

```text
DomainContractError('invalid_dto')
```

### 9.2 业务值错误

结构合法但业务值非法时返回 `EngineResult.blocked`，不抛异常。新增稳定 issue code：

- `invalid_scenario_set`；
- `unsupported_engine_version`；
- `invalid_forecast_horizon`；
- `invalid_seasonality`；
- `invalid_revenue_driver`。

并继续复用 `missing_input`、`invalid_decimal`、`value_out_of_range`、`currency_mismatch`、`unit_mismatch`、`period_mismatch`、`probability_sum_mismatch` 和 `unresolved_conflict`。

校验优先级固定为：

1. 版本、情景集合和概率；
2. 预测起始月、期限和模型年度数组长度；
3. 十进制格式与数值域；
4. 季节性长度、正值和精确合计；
5. 单位与币种；
6. `valueRef` 唯一性、来源和冲突状态；
7. 月度展开后非负约束；
8. 业务计算中的无意义结果。

任一情景非法时，整个三情景集合返回 blocked，不输出部分成功快照。问题按情景 ID、字段路径、月份稳定排序。不得用零、空数组或 `NaN` 作为失败占位结果。

## 10. 输入预算与防御性边界

为保持 60 月三情景计算可预测：

- 情景数必须恰好为 3；
- 期限只允许 36、48、60；
- 自定义收入因子只允许 2–5 个；
- 季节数组必须恰好 12 个稠密元素；
- 年度比例数组只允许 3–5 个稠密元素，且必须与期限一致；
- 每个标量最多 32 个 `sourceRefs`；
- `valueRef`、`metricId`、`factorId` 和 source ref 必须为非空且有长度上限的字符串；
- 在读取完整数组或遍历所有来源前先校验公开长度预算；
- 解析器捕获 hostile getter、Proxy 和原型异常，并统一映射为 `invalid_dto`。

具体字符串长度和总体节点预算在实施计划中与现有公式引擎预算对齐，避免同一领域层出现相互矛盾的限制。

## 11. 文件职责

```text
app/src/domain/analysis/
  analysis-scalar.ts              # 共享 valueRef/source/conflict 契约
  calculation-trace.ts            # Formula/Forecast 轨迹联合类型
  engine-result.ts                 # 扩展稳定 issue code

app/src/engines/forecast/
  forecast-types.ts               # 输入、输出和内部规范化类型
  validate-forecast-input.ts      # 严格结构与业务值校验
  generate-monthly-series.ts      # 增长、直接季节计算和年度比例展开
  calculate-revenue.ts            # 五类收入模型与单位约简
  calculate-scenario.ts           # 单情景月度财务链
  aggregate-model-years.ts        # 12 月模型年度与现金摘要
  forecast-three-scenarios.ts     # 公共入口、顺序、轨迹和冻结
  forecast-test-fixtures.ts       # 小型人工可核算夹具
  forecast-golden-vectors.test.ts # 三情景完整黄金向量
```

每个生产文件配套聚焦测试；不创建 UI、数据库或报告文件。

## 12. 测试策略

所有实现严格遵循 RED → GREEN → REFACTOR，并至少覆盖：

### 12.1 序列生成

- 首月严格等于输入起始值；
- 无季节性、正增长、零增长、`-1` 增长边界；
- 非 1 月起始时正确选择首月自然月乘数；
- 12 月→1 月直接季节切换；
- 60 个月内无链式季节漂移；
- 季节乘数精确合计 12，拒绝近似但不相等的输入；
- 年度比例在第 12→13、24→25 月准确切换。

### 12.2 收入驱动

- 四种固定驱动各有人工可核算向量；
- 自定义 2–5 因子乘法；
- count 与 currency-per-count 匹配；
- GMV 与 Take Rate 匹配；
- 币种混合、count kind 混合、重复货币因子和非法单位被阻塞。

### 12.3 财务链

- 正常盈利、亏损、零税前利润和负 EBIT；
- 所得税不对亏损确认税收利益；
- 营运资本释放使用负值并增加现金流；
- 月度 FCF 与公式字典 `free_cash_flow@1` 一致；
- 月度利润表和现金流逐项勾稽；
- FCFF 与 FCF 保持各自定义，不互相替代。

### 12.4 融资与聚合

- 无融资需求；
- 首月触发融资；
- 多月连续补足；
- 融资后现金精确等于或高于最低余额；
- 最低融资前现金、首次触发月和累计融资需求准确；
- 36、48、60 个月分别生成 3、4、5 个完整模型年度；
- 流量求和、存量取首月或末月的规则准确。

### 12.5 契约与防御

- 三情景缺失、重复、未知 ID 和概率不等于 1；
- 年度数组长度错误；
- 非规范十进制、负的非负项目、非法税率和增长率；
- blocking 与 conservative-selected 冲突；
- 重复 `valueRef`；
- 稀疏数组、类实例、访问器、循环对象、过宽数组和 hostile Proxy；
- 输入对象在调用后不变；
- 输出与轨迹深冻结、可序列化且确定；
- 既有公式、Decimal、Scenario、Period 和 EngineResult 回归全部通过。

### 12.6 黄金向量

至少建立一套 36 月完整黄金向量，手工断言悲观、基准和乐观情景的关键月份、每个模型年度、现金低点和融资需求。另以聚焦向量覆盖 48/60 月边界，不为每个月复制大量脆弱快照。

## 13. 完成标准

设计完成后的实施必须满足：

1. 所有新增行为先有准确失败的测试；
2. 每项计划任务依次经过实现、独立规格审查和独立代码质量审查；
3. 聚焦测试、公式回归、全量测试、typecheck、lint 和生产构建全部通过；
4. 整体独立审查无未关闭的 Critical 或 Important 问题；
5. 工作树干净，提交范围只包含预测引擎及必要的共享契约调整；
6. 后续估值引擎可以直接消费模型年度 FCFF，无需重算预测口径。
