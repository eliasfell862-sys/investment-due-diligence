# 风险引擎设计规格

**日期：** 2026-07-27
**阶段：** 阶段 2——计算、估值、风险与投资判定引擎
**状态：** 待用户最终复核

## 1. 目标

构建一个纯 TypeScript、可离线运行、可审计且确定性的风险引擎。引擎覆盖九类风险、残余风险计算、六条致命缺陷红线、双损失概率建议区间、风险到条款的联动，以及红黄绿灯矩阵。

公开入口为：

```ts
export function evaluateRisk(
  input: unknown,
): RiskEngineResult<RiskAssessment>;
```

引擎使用现有 40 位 `ROUND_HALF_EVEN` `AnalysisDecimal`，复用共享 `EngineResult`、问题代码、冻结输出和计算轨迹约定。入口接受 hostile-safe `unknown` DTO；引擎不依赖 UI、IndexedDB、浏览器、网络或 AI 推断。

## 2. 范围与非目标

### 2.1 v1 范围

- 固定九类风险及分批评估；
- 单项、分类及总体残余风险；
- 默认或项目自定义分类权重；
- 默认或项目自定义红黄绿阈值；
- 固定六条致命缺陷检查表；
- 永久性损失和暂时性回撤建议区间；
- 固定、可审计的风险—条款规则目录；
- 风险矩阵、数据缺口、验证清单和完整计算轨迹。

### 2.2 v1 非目标

- 不从 BP、合同、财务表或自然语言中自动识别风险；
- 不使用 Monte Carlo、机器学习或黑箱概率；
- 不在风险引擎内重新计算估值安全边际、下行 MOIC 或现金断裂；
- 不自动修改已录入的缓释有效性或重新计算“接受条款后的风险”；
- 不生成可直接签署的法律文本，条款输出仅为谈判和法律核验辅助；
- 不实现 UI、持久化、Word 报告或投资五档判定。

## 3. 架构

单一公开入口协调四个内部纯计算单元：

1. `calculateRiskScores`：计算单项、分类和总体残余风险及灯号；
2. `evaluateFatalFlaws`：执行六条红线的状态和覆盖规则；
3. `estimateLossRanges`：根据上游快照和风险结果选择双损失概率区间；
4. `recommendClauses`：对黄灯、红灯风险及特定致命缺陷生成条款候选。

所有单元只消费一次 hostile-safe 快照后的规范化内部 DTO。公开输出通过共享结果工厂深度冻结，所有数组和问题均使用固定顺序，保证相同输入在不同电脑和区域设置下产生字节一致的 JSON。

## 4. 固定领域枚举

### 4.1 九类风险

```ts
export type RiskCategory =
  | 'market'
  | 'technology'
  | 'customer'
  | 'financial'
  | 'financing'
  | 'legal_compliance'
  | 'governance'
  | 'data_authenticity'
  | 'exit';
```

固定输出顺序与上述枚举顺序一致。

### 4.2 可选风险信号

风险项可携带零个或多个固定信号，用于选择更具体的条款候选：

```ts
export type RiskSignal =
  | 'market_adoption'
  | 'valuation_overhang'
  | 'technical_feasibility'
  | 'ip_ownership'
  | 'customer_concentration'
  | 'revenue_quality'
  | 'cash_runway'
  | 'reporting_quality'
  | 'financing_dependency'
  | 'regulatory_approval'
  | 'key_person'
  | 'governance_control'
  | 'data_integrity'
  | 'exit_delay';
```

信号必须唯一并按固定枚举顺序输出。未提供信号时仍使用分类默认条款规则。

信号与分类必须匹配：

| 分类 | 允许信号 |
| --- | --- |
| `market` | `market_adoption`、`valuation_overhang` |
| `technology` | `technical_feasibility`、`ip_ownership` |
| `customer` | `customer_concentration`、`revenue_quality` |
| `financial` | `cash_runway`、`reporting_quality` |
| `financing` | `financing_dependency` |
| `legal_compliance` | `regulatory_approval` |
| `governance` | `key_person`、`governance_control` |
| `data_authenticity` | `data_integrity` |
| `exit` | `exit_delay` |

分类不匹配的信号属于 `invalid_risk_item`。信号只调整本分类固定条款的选择顺序，不改变残余风险公式或灯号。

## 5. 输入契约

```ts
export interface RiskAssessmentInput {
  readonly version: '1';
  readonly asOfDate: string;
  readonly riskItems: readonly RiskItemInput[];
  readonly fatalFlaws: readonly FatalFlawCheckInput[];
  readonly categoryWeights?: Readonly<Record<RiskCategory, DecimalString>>;
  readonly trafficLightThresholds?: TrafficLightThresholdInput;
  readonly upstreamSnapshots?: RiskUpstreamSnapshots;
}

export interface RiskItemInput {
  readonly riskId: string;
  readonly category: RiskCategory;
  readonly title: string;
  readonly probability: DecimalString;
  readonly impact: DecimalString;
  readonly mitigationEffectiveness: DecimalString;
  readonly mitigationDescription?: string;
  readonly signals?: readonly RiskSignal[];
  readonly evidenceRefs?: readonly string[];
}

export interface TrafficLightThresholdInput {
  readonly greenUpper: DecimalString;
  readonly redLower: DecimalString;
  readonly changeReason: string;
}
```

### 5.1 风险项校验

- `riskId` 全局唯一、非空，最长 256 字符；
- `title` 非空，最长 2,048 字符；
- `probability`、`impact` 和 `mitigationEffectiveness` 均为 `[0,1]` 内的规范 Decimal 字符串；
- `mitigationEffectiveness > 0` 时必须提供非空 `mitigationDescription`；
- `signals` 和 `evidenceRefs` 内部唯一；
- 相同风险信号可被多个风险项复用；
- `riskItems` 允许为空，最大 4,096 项；
- 缺少某一分类的风险项不属于非法输入。

### 5.2 权重校验

- 未提供 `categoryWeights` 时，已评估分类等权；
- 自定义权重必须包含全部九类；
- 每项权重位于 `[0,1]`；
- 九项权重使用 Decimal 精确合计 `1`；
- 至少存在一个已评估分类时，已评估分类的权重合计必须大于 `0`，否则总体风险不可计算并返回语义 blocked；
- 缺失分类的权重不计入本次总体风险分母，但保留在权重覆盖率中。

### 5.3 灯号阈值校验

默认值：

```text
greenUpper = 0.33
redLower   = 0.67
```

项目自定义阈值必须满足：

```text
0 <= greenUpper < redLower <= 1
```

自定义阈值必须提供非空 `changeReason`。阈值原值、变更值和原因全部写入审计轨迹。

## 6. 残余风险计算

### 6.1 单项残余风险

```text
residualRisk = probability × impact × (1 - mitigationEffectiveness)
```

所有中间步骤使用 `AnalysisDecimal`。输出保留规范 Decimal 字符串，不使用 JavaScript `number` 进行风险算术。

### 6.2 分类风险

- 分类内存在风险项时，分类状态为 `assessed`；
- 分类残余风险为该分类所有单项残余风险的最大值；
- 最大值并列时，按 Unicode 代码点顺序选择最小 `riskId` 作为主要风险；
- 分类无风险项时状态为 `unassessed`，残余风险和灯号均为 `null`；
- 未评估分类不会被当成零风险或绿灯。

### 6.3 总体残余风险

默认等权：

```text
overallResidualRisk = sum(assessedCategoryRisk) / assessedCategoryCount
```

自定义权重：

```text
assessedWeight = sum(weight of assessed categories)
overallResidualRisk =
  sum(categoryRisk × configuredWeight) / assessedWeight
```

同时输出：

```text
categoryCoverageRatio = assessedCategoryCount / 9
weightCoverageRatio   = assessedWeight
riskPenalty           = overallResidualRisk × 20
```

未提供自定义权重时，每类隐含权重为 `1/9`，因此 `weightCoverageRatio` 等于 `categoryCoverageRatio`。提供自定义权重时，`weightCoverageRatio` 等于已评估类别原始配置权重之和，不使用重新归一化后的 `1`。
未提供任何风险项时，九类均为 `unassessed`，总体残余风险、风险惩罚和总体灯号为 `null`。顶层仍返回可用结果，以便继续报告致命缺陷和可判断的双损失规则。

### 6.4 红黄绿灯

灯号应用于单项、已评估分类和可计算总体风险：

```text
risk < greenUpper                  => green
greenUpper <= risk < redLower      => yellow
risk >= redLower                   => red
```

阈值相等时按“达到”处理。未评估分类的灯号为 `null`。

## 7. 六条致命缺陷红线

### 7.1 固定检查表

```ts
export type FatalFlawId =
  | 'material_data_or_business_fraud'
  | 'core_ownership_or_license_unclear'
  | 'irremediable_major_illegality'
  | 'business_model_unverifiable'
  | 'pre_close_cash_break'
  | 'founder_integrity_failure';
```

默认严重度固定为：

| 红线 | 默认严重度 |
| --- | --- |
| 财务或业务数据重大造假 | `reject` |
| 核心知识产权、股权权属或必需牌照不清 | `pause` |
| 重大违法违规且无法补救 | `reject` |
| 商业模式无法通过客户、合同或流水验证 | `pause` |
| 资金链可能在交易交割前断裂 | `pause` |
| 创始人或核心团队存在严重诚信问题 | `reject` |

### 7.2 状态契约

```ts
export type FatalFlawStatus = 'clear' | 'open' | 'covered' | 'resolved';

export interface FatalFlawCheckInput {
  readonly fatalFlawId: FatalFlawId;
  readonly status: FatalFlawStatus;
  readonly evidenceRefs?: readonly string[];
  readonly coverageReason?: string;
  readonly bindingConditions?: readonly string[];
  readonly resolutionNote?: string;
}
```

- 六条检查必须全部且仅出现一次；
- `clear` 不要求额外说明；
- `open` 可携带证据，但不能携带覆盖理由或解决说明；
- `covered` 必须提供非空书面 `coverageReason` 和至少一条 `bindingConditions`；
- `resolved` 必须提供非空 `resolutionNote`；
- 风险分类是否已评估不影响致命缺陷计算。

### 7.3 覆盖结论

优先级固定为：

```text
open + reject > open + pause > covered > none
```

输出：

- `open + reject`：`fatalOutcome = reject`；
- `open + pause`：`fatalOutcome = pause`；
- 任一 `covered` 且无 open：`fatalOutcome = conditional_cap`；
- 仅有 `clear/resolved`：`fatalOutcome = none`。

`resolved` 永久保留在轨迹和结果中，但不再覆盖风险分数。`open + reject` 明确标记 `notCurableByClause: true`。

## 8. 上游快照与双损失概率

### 8.1 上游快照

```ts
export interface RiskUpstreamSnapshots {
  readonly valuation?: {
    readonly snapshotId: string;
    readonly sourceRef: 'valuation-triangulation@1';
    readonly safetyMargin: DecimalString;
  };
  readonly forecast?: {
    readonly snapshotId: string;
    readonly sourceRef: 'scenario-forecast@1';
    readonly downsideCashBreak: boolean;
  };
  readonly investorReturns?: {
    readonly snapshotId: string;
    readonly sourceRef: 'investor-returns@1';
    readonly downsideMoic: DecimalString;
  };
  readonly exit?: {
    readonly snapshotId: string;
    readonly sourceRef: 'exit-assessment@1';
    readonly exitDelayed: boolean;
  };
}
```

- 风险引擎只读取并验证快照值，不重算上游指标；
- `safetyMargin` 接受任意有限规范 Decimal，可为负数；
- `downsideMoic` 必须大于等于 `0`；
- 每个快照 ID 非空且最长 256 字符；
- 快照缺失不阻断仍可判断的规则，但必须列入 `missingInputs`。

### 8.2 永久性损失规则

按下表顺序选择第一个命中区间，同时记录全部命中规则：

| 优先级 | 规则 | 区间 |
| ---: | --- | --- |
| 1 | 存在 `open + reject` | `[0.75, 1]` |
| 2 | 存在 `open + pause` | `[0.50, 0.80]` |
| 3 | 下行情景现金断裂且下行 MOIC `< 1` | `[0.40, 0.70]` |
| 4 | 总体残余风险 `>= 0.67` | `[0.30, 0.60]` |
| 5 | 总体残余风险 `>= 0.33` | `[0.15, 0.35]` |
| 6 | 其他 | `[0.05, 0.20]` |

### 8.3 暂时性回撤规则

| 优先级 | 规则 | 区间 |
| ---: | --- | --- |
| 1 | 退出延迟且估值安全边际 `< 0.15` | `[0.45, 0.75]` |
| 2 | 下行 MOIC `< 1` | `[0.35, 0.65]` |
| 3 | 估值安全边际 `< 0.20` | `[0.25, 0.50]` |
| 4 | 总体残余风险 `>= 0.33` | `[0.15, 0.40]` |
| 5 | 其他 | `[0.05, 0.25]` |

### 8.4 区间输出

```ts
export interface LossProbabilityRange {
  readonly lower: DecimalString;
  readonly upper: DecimalString;
  readonly selectedRuleId: string;
  readonly triggeredRuleIds: readonly string[];
  readonly missingInputs: readonly string[];
  readonly requiresInvestorConfirmation: true;
}
```

缺失上游快照时，引擎仍应用致命缺陷、总体残余风险和默认规则。`missingInputs` 明确说明哪些更高优先级规则无法判断，不得把缺失数据描述为低风险。

双损失规则中的 `0.33` 和 `0.67` 是固定、跨项目可比的概率建议规则边界，不随项目自定义红黄绿灯阈值变化。自定义灯号阈值只影响矩阵展示和条款触发优先级。

## 9. 风险—条款联动

### 9.1 触发范围

- 红灯风险生成 `must_have` 候选；
- 黄灯风险生成 `high` 候选；
- 绿灯和未评估分类不自动生成条款；
- `open + reject` 不生成暗示可继续投资的补救条款，输出 `blocked_by_fatal_flaw`；
- `open + pause` 生成强制先决条件和验证清单；
- `covered` 的绑定条件逐条转为 `must_have` 条款；
- `resolved` 不自动生成新条款。

### 9.2 固定分类目录

| 风险类别 | 固定 `ClauseType` |
| --- | --- |
| 市场 | `staged_pricing`、`performance_milestone`、`valuation_adjustment`、`anti_dilution` |
| 技术 | `technical_verification_condition`、`development_milestone_tranche`、`ip_representation_and_warranty` |
| 客户 | `customer_concentration_covenant`、`revenue_milestone`、`information_rights`、`customer_diversification_plan` |
| 财务 | `use_of_proceeds`、`budget_approval`、`periodic_financial_reporting`、`financial_covenant` |
| 融资 | `staged_funding`、`minimum_cash_balance`、`financing_condition_precedent`、`pro_rata_right` |
| 法律合规 | `compliance_remediation_condition`、`representation_and_warranty`、`specific_indemnity`、`regulatory_approval_condition` |
| 治理 | `founder_vesting`、`key_person_protection`、`founder_repurchase_right`、`reserved_matters`、`board_seat` |
| 数据真实性 | `audit_rights`、`data_authenticity_warranty`、`specific_indemnity`、`pre_closing_data_verification` |
| 退出 | `redemption_right`、`drag_along_right`、`tag_along_right`、`exit_milestone`、`liquidity_protection` |

风险信号可把默认目录收窄为更具体的候选。例如 `customer_concentration` 优先客户集中度约束和信息权，`key_person` 优先 vesting、关键人条款和回购权，`regulatory_approval` 优先监管批准先决条件。

### 9.3 固定条款类型

```ts
export type ClauseType =
  | 'staged_pricing'
  | 'performance_milestone'
  | 'valuation_adjustment'
  | 'anti_dilution'
  | 'technical_verification_condition'
  | 'development_milestone_tranche'
  | 'ip_representation_and_warranty'
  | 'customer_concentration_covenant'
  | 'revenue_milestone'
  | 'information_rights'
  | 'customer_diversification_plan'
  | 'use_of_proceeds'
  | 'budget_approval'
  | 'periodic_financial_reporting'
  | 'financial_covenant'
  | 'staged_funding'
  | 'minimum_cash_balance'
  | 'financing_condition_precedent'
  | 'pro_rata_right'
  | 'compliance_remediation_condition'
  | 'representation_and_warranty'
  | 'specific_indemnity'
  | 'regulatory_approval_condition'
  | 'founder_vesting'
  | 'key_person_protection'
  | 'founder_repurchase_right'
  | 'reserved_matters'
  | 'board_seat'
  | 'audit_rights'
  | 'data_authenticity_warranty'
  | 'pre_closing_data_verification'
  | 'redemption_right'
  | 'drag_along_right'
  | 'tag_along_right'
  | 'exit_milestone'
  | 'liquidity_protection'
  | 'fatal_flaw_condition_precedent'
  | 'covered_flaw_binding_condition';
```

分类目录中的中文条款名称必须映射到上述固定 ID。风险信号只能在同一分类的默认目录中提高相关条款优先顺序，不能引入目录外条款。`open + pause` 使用 `fatal_flaw_condition_precedent`；`covered` 的每条绑定条件使用 `covered_flaw_binding_condition`。

### 9.4 条款输出

```ts
export interface ClauseRecommendation {
  readonly clauseId: string;
  readonly clauseType: ClauseType;
  readonly sourceRiskIds: readonly string[];
  readonly sourceFatalFlawIds: readonly FatalFlawId[];
  readonly applicability: string;
  readonly protectionMechanism: string;
  readonly riskTreatment:
    | 'transfer'
    | 'constraint'
    | 'verification_condition'
    | 'partial_mitigation';
  readonly negotiationPriority: 'must_have' | 'high';
  readonly sideEffects: readonly string[];
  readonly legalReviewRequired: true;
  readonly disclaimer: string;
}
```

相同 `clauseType` 的候选按固定规则去重，聚合并按 Unicode 代码点排序全部来源风险和致命缺陷。优先级取最高值。`covered_flaw_binding_condition` 按绑定条件的规范化文本分别保留，不把不同条件错误合并。免责声明固定说明：条款只能转移、约束、验证或部分缓释风险，不能消除底层经营风险，也不替代法律意见。

## 10. 输出契约

```ts
export interface RiskAssessment {
  readonly version: '1';
  readonly asOfDate: string;
  readonly thresholds: AppliedTrafficLightThresholds;
  readonly riskItems: readonly RiskItemAssessment[];
  readonly categoryMatrix: readonly CategoryRiskAssessment[];
  readonly overall: OverallRiskAssessment;
  readonly fatalFlaws: FatalFlawAssessment;
  readonly permanentLoss: LossProbabilityRange;
  readonly temporaryDrawdown: LossProbabilityRange;
  readonly clauseRecommendations: readonly ClauseRecommendation[];
  readonly verificationChecklist: readonly VerificationChecklistItem[];
  readonly dataGaps: readonly RiskDataGap[];
}
```

### 10.1 九行矩阵

每一行固定包含：

- `category`；
- `status: assessed | unassessed`；
- `riskItemCount`；
- `residualRisk: DecimalString | null`；
- `light: green | yellow | red | null`；
- `topRiskId: string | null`；
- `topRiskTitle: string | null`；
- `clauseRecommendationCount`；
- `evidenceRefCount`；
- `dataGaps`。

### 10.2 总体输出

```ts
export interface OverallRiskAssessment {
  readonly assessedCategoryCount: number;
  readonly categoryCoverageRatio: DecimalString;
  readonly weightCoverageRatio: DecimalString;
  readonly residualRisk: DecimalString | null;
  readonly riskPenalty: DecimalString | null;
  readonly light: 'green' | 'yellow' | 'red' | null;
}
```

## 11. 轨迹、排序与问题语义

### 11.1 风险轨迹

共享 `CalculationTrace` 增加：

```ts
export interface RiskCalculationTrace {
  readonly engine: 'risk';
  readonly riskRef: 'risk-assessment@1';
  readonly inputs: readonly TraceInput[];
  readonly steps: readonly TraceStep[];
}
```

轨迹按以下顺序输出：

1. 每个风险项的三步乘法；
2. 九类最大值选择或未评估记录；
3. 权重覆盖与重新归一化；
4. 总体风险、风险惩罚和灯号；
5. 自定义阈值审计；
6. 六条致命缺陷状态和覆盖判定；
7. 双损失全部规则的命中、无法判断和最终选择；
8. 条款映射、去重和优先级提升。

### 11.2 确定性排序

- 风险项：分类固定顺序后按 `riskId` Unicode 代码点排序；
- 致命缺陷：固定六条顺序；
- 损失规则：规则优先级顺序；
- 条款：`negotiationPriority` 后按 `clauseType` Unicode 代码点排序；
- 证据、来源风险、缺口和问题：Unicode 代码点排序；
- 禁止使用依赖系统 locale 的 `localeCompare`。

### 11.3 问题代码

共享稳定问题代码增加：

```ts
| 'invalid_risk_item'
| 'invalid_risk_weight'
| 'invalid_risk_threshold'
| 'invalid_fatal_flaw'
| 'invalid_risk_snapshot'
| 'missing_risk_coverage'
```

- 结构破坏、访问器、Proxy、循环、过深或超预算 DTO 抛出新的 `DomainContractError('invalid_dto')`；
- 非法概率、权重、阈值、红线或快照返回 blocked `invalid-input`；
- 无风险项不是非法输入，输出九类未评估并列出覆盖缺口；
- 自定义权重下至少存在一个已评估分类、但已评估权重为零时返回 blocked `not-meaningful`。

## 12. 资源预算与安全边界

风险快照复用预测、估值和股权引擎的 hostile-safe 预算：

- 最大深度 64；
- 最大节点 16,384；
- 单数组最大 4,096；
- 总数组槽位最大 32,768；
- 单对象最大 4,096 个属性；
- 总属性最大 32,768；
- 单字符串最大 65,536 字符；
- 总字符串字符最大 1,048,576。

输入不得包含 class instance、symbol key、accessor、稀疏数组、循环或非有限数字。共享别名允许存在；快照必须保留别名关系，首次遍历时计入节点预算，后续复用不得重复计入预算。所有正常和 blocked 输出必须深度冻结、JSON-safe、无 `NaN`/`Infinity`，且不得修改输入。

## 13. 测试与验收标准

### 13.1 契约和快照

- 公共 DTO、结果、轨迹和问题代码类型测试；
- hostile Proxy、访问器、循环、稀疏数组、共享别名和预算边界；
- 空风险列表和九类分批评估；
- null-prototype DTO 和跨电脑 Unicode 排序。

### 13.2 风险计算

- `0`、`1` 和 40 位 HALF_EVEN 边界；
- 分类最大值不被平均稀释；
- 默认等权、自定义权重和缺失类别重新归一化；
- 权重覆盖率和九项精确合计；
- 默认阈值、自定义阈值、相等边界和审计原因；
- 全部未评估时总体为 `null`。

### 13.3 致命缺陷

- 六条完整性、重复和缺失；
- `clear/open/covered/resolved` 字段约束；
- reject、pause、conditional_cap 和 none 优先级；
- resolved 保留轨迹但不覆盖评分；
- 致命缺陷不受风险类别缺失影响。

### 13.4 双损失概率

- 两张规则表的每一行及边界值；
- 多规则同时命中时选最高优先级并记录全部；
- 安全边际仅来自估值快照；
- 缺少快照时列出缺口并继续低覆盖计算；
- `requiresInvestorConfirmation` 永远为 `true`。

### 13.5 条款联动

- 九类默认映射；
- 风险信号细化；
- 黄灯、红灯优先级；
- 相同条款去重和来源聚合；
- open reject 不生成可补救暗示；
- open pause 和 covered 生成强制条件；
- 固定免责声明和法律核验标志。

### 13.6 黄金向量

完整向量必须包含：

- 至少六类已评估、三类未评估；
- 默认和自定义权重覆盖审计；
- 自定义灯号阈值；
- open pause、covered 和 resolved 红线；
- 完整估值、预测、股权回报和退出快照；
- 永久性损失和暂时性回撤多规则命中；
- 条款去重、来源聚合和验证清单；
- 重复调用字节一致、输出冻结、输入不变。

## 14. 完成定义

风险引擎 v1 完成时必须满足：

1. 九类风险可分批录入，未评估类别明确显示且不被当成低风险；
2. 所有风险算术使用 40 位 HALF_EVEN Decimal；
3. 自定义权重和灯号阈值经过严格校验并可审计；
4. 六条致命缺陷检查完整且独立于风险覆盖；
5. 双损失区间完全由可解释规则和上游快照产生；
6. 安全边际只读估值引擎快照，风险引擎不重算；
7. 黄红风险和可覆盖红线生成稳定、去重、带副作用的条款候选；
8. 所有结果、问题和轨迹冻结、确定、JSON-safe；
9. 聚焦测试、完整测试、类型检查、lint 和生产构建全部通过；
10. 功能在独立分支完成，未获用户选择前不自动合并或清理。
