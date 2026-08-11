# 实际持仓动态做 T 信号设计规格

日期：2026-08-11

## 1. 目标

为证券工作台的实际持仓增加完整的日内做 T 能力。系统针对每只实际持仓独立计算动态卖出价、建议卖出数量和回补价，在达到条件时向现有信号收件箱发送提醒。用户确认实际成交后，系统以真实成交价格和数量继续跟踪回补，完成后计算完整周期的费用、净收益和持仓成本改善。

本功能只生成信号并记录用户确认的成交，不连接券商自动下单。

## 2. 已确认规则

- 只监控实际持仓，不扫描全部 A 股。
- 同时支持“盈利做 T”和“亏损仓降本做 T”。
- 单次建议数量为 100 股整数倍，最高不超过当前可用股数的 35%。
- 做 T 周期默认只在卖出当日有效。
- 当日临近收盘仍未回补时发送风险提醒，由用户决定回补或保留减仓状态。
- 卖出和回补都必须由用户确认实际成交价格和数量。
- 交易费用使用用户级账户费率配置，并提供保守默认值。
- 采用费用、波动率和技术结构共同约束的混合动态模型。

## 3. 范围

### 3.1 包含

- 用户级交易费用配置。
- 实际持仓逐股动态做 T 参数计算。
- 卖出数量优化。
- 做 T 卖出、回补和未完成风险提醒。
- 部分卖出、部分回补和剩余待回补数量管理。
- 完整周期费用、净收益和降本效果计算。
- 云端持久化、多用户隔离、状态去重和审计记录。
- 与现有实际持仓、T+1 可用股数、实时行情、收件箱和云端常驻监控串联。
- 使用历史数据对逐股 ATR 参数进行无未来数据校准。

### 3.2 不包含

- 券商自动下单。
- 融资融券、港股、美股和 ETF 的费用规则。
- 卖空做 T。
- 改造个股分析页面或股票 K 线加载链路。
- 将未执行的建议信号记作真实成交。

## 4. 核心原则

1. **完整周期核算**：信号必须同时考虑卖出和预计回补两段费用，不能只看卖出端浮盈。
2. **实际成交优先**：用户输入的真实成交价格和数量覆盖建议值，并触发后续目标重算。
3. **逐股动态参数**：不同价格、波动率、流动性和技术结构的股票使用不同阈值。
4. **成本只是分类条件**：卖出价高于持仓成本属于盈利做 T；卖出价低于持仓成本但完整周期可降低成本属于降本做 T。
5. **风险优先于机械回补**：跌破关键支撑且风险继续扩大时暂停回补并提示复核。
6. **T+1 约束**：只允许卖出可用股数；当日回补的股票进入冻结数量，下一交易日才可再次卖出。
7. **信号不等于成交**：只有用户确认执行后才修改实际持仓和做 T 周期状态。

## 5. 交易费用引擎

### 5.1 用户费率配置

新增 `trading_fee_profiles`，每位用户维护一份有效配置：

- `commission_rate`：券商佣金率，默认 0.0003。
- `minimum_commission`：单笔最低佣金，默认 5 元。
- `sell_stamp_duty_rate`：卖出印花税率，默认 0.0005。
- `transfer_fee_rate`：买卖双向过户费率，默认 0.00001。
- `slippage_mode`：动态或固定滑点。
- `fixed_slippage_rate`：固定模式下的滑点率。
- `updated_at`：配置更新时间。

费率可由用户修改，修改记录进入审计轨迹。没有配置时使用默认值，并在信号中标注“使用默认费用参数”。

### 5.2 单边费用

对成交金额 `amount = price × shares`：

```text
commission = max(minimum_commission, amount × commission_rate)
transfer_fee = amount × transfer_fee_rate
stamp_duty = side == sell ? amount × sell_stamp_duty_rate : 0
slippage_cost = amount × effective_slippage_rate
total_fees = commission + transfer_fee + stamp_duty + slippage_cost
```

滑点根据成交金额、近期成交量和流动性动态估计；缺失流动性数据时使用用户配置的固定滑点率。

上述滑点只用于**信号生成前的预计核算**。用户确认真实成交价后，实际核算以真实成交价和券商实际费用为准；若用户未填写实际费用，则仅按费率重算佣金、印花税和过户费，不再额外扣除模拟滑点，避免真实成交价已经包含市场冲击后再次重复扣减。系统可单独记录“建议价与实际成交价偏差”用于策略复盘，但该偏差不重复计入费用。

### 5.3 完整周期净收益

```text
完整回补：
cycle_net_profit
= (sell_price - buyback_price) × matched_shares
- sell_total_fees
- buyback_total_fees

部分回补：
realized_t_profit
= (sell_price - buyback_price) × bought_back_shares
- allocated_sell_fees
- buyback_total_fees

allocated_sell_fees
= sell_total_fees × bought_back_shares / actual_sell_shares
```

完整回补时 `matched_shares = sell_shares = buyback_shares`。部分回补只按已配对的回补数量确认做 T 收益，禁止把尚未回补部分对应的卖出收入提前计入已实现收益。剩余卖出费用按未配对数量保留在周期中，剩余数量继续处于待回补状态。

完整回补且持仓总股数恢复后，做 T 对持仓账面成本的改善按以下口径展示：

```text
cost_reduction_per_share = cycle_net_profit / restored_total_shares
adjusted_average_cost = pre_cycle_average_cost - cost_reduction_per_share
```

实际持仓台账仍以用户确认的券商成本价和真实交易流水为准，模型计算值作为解释与核对字段。若用户最终选择将未回补部分保留为普通减仓，则该部分只确认减仓损益，不再标记为“做 T 降本”。

实际持仓的 `averageCost` 使用券商显示成本价或用户确认成本价，例如成交价 11.05、券商成本价 11.10 时，持仓基准使用 11.10。

## 6. 逐股动态做 T 决策引擎

### 6.1 输入

- 实际持仓总股数、可用股数、平均成本和交易流水。
- 当前实时价格和时间戳。
- 至少 60 个、优先 250 个交易日的前复权日线。
- ATR20、ATRP20、20 日历史波动率。
- 支撑位、阻力位、均线、成交量和资金流。
- 市场状态、行业状态、涨跌停和停牌状态。
- 用户费用配置和现有未完成做 T 周期。

可复用下载的 `daily_stock_analysis` 中的 ATRP、历史波动率、支撑阻力、资金流和狙击止盈点算法，但必须通过本项目的 TypeScript 适配层形成稳定接口，不能让前端直接依赖 Python 进程。

### 6.2 卖出候选

卖出候选必须满足：

- 可用股数不少于 100 股。
- 行情有效、未停牌且数据未过期。
- 当前价格达到逐股 ATRP 有效波动要求。
- 接近阻力位、出现冲高转弱，或资金流边际减弱。
- 存在可解释的预计回补区间。
- 按候选数量核算后，预计完整周期净收益为正且超过风险缓冲。

盈利做 T 与降本做 T 使用不同确认强度。降本做 T 至少需要阻力或冲高转弱确认，并且不得仅因股价低于成本就机械触发。

### 6.3 回补候选

用户确认卖出后，以实际卖出价格、实际数量和实际费用重算回补目标。回补至少满足一项价格条件和一项稳定条件：

- 价格条件：到达支撑位、短期均线附近或校准后的 ATR 回撤幅度。
- 稳定条件：下跌动能减弱、资金流从流出转稳、分时量价不再恶化或支撑位确认有效。

如果跌破关键支撑并伴随风险扩大，状态转为 `buyback_paused_risk_review`，不发送机械买回指令。

### 6.4 逐股滚动校准

使用最近约 250 个交易日进行 walk-forward 校准，候选参数包括：

- ATRP 目标价差倍数。
- 阻力位接近范围。
- 回补回撤幅度。
- 成交量确认阈值。
- 单次仓位比例。

目标函数综合扣费后胜率、平均净收益、最大连续失败次数、未回补概率、踏空损失和信号频率，不允许仅按最高历史收益选择参数。

历史不足 60 个共同交易日时不进行个股校准，使用保守默认参数并显示“样本不足”。任何校准只能使用信号时点之前的数据，禁止未来函数。

## 7. 数量优化

候选数量从 100 股开始，以 100 股递增，最高为：

```text
floor(available_shares × 35% / 100) × 100
```

若计算结果低于 100 股，则不产生做 T 信号。

每个候选数量分别计算：

- 完整周期预计费用和净收益。
- 最低 5 元佣金造成的单位成本。
- 卖出后剩余底仓比例。
- 流动性和预计冲击成本。
- 未回补时的方向暴露。

系统选择费用效率、净收益和风险的综合最优解，不强制使用 35% 上限。若增加 100 股不能显著提高净收益或会跨越流动性/底仓风险阈值，则选择更小数量。

## 8. 做 T 周期状态机

```text
sell_signal_pending
→ sell_executed
→ buyback_monitoring
→ buyback_signal_pending
→ partially_bought_back / completed
```

异常和终止状态：

- `sell_signal_cancelled`
- `buyback_paused_risk_review`
- `expired_unfilled`
- `kept_as_reduction`
- `cancelled_by_user`

卖出信号只在用户确认实际卖出后创建待回补周期。实际卖出数量低于建议数量时，周期数量使用实际数量。部分回补后只监控剩余未回补数量。

周期默认在卖出交易日有效。临近收盘仍未完成时发送一次风险提醒，展示实时回补的预计净损益。用户可选择按实时价格回补、继续等待至收盘或将本次操作确认成普通减仓。系统不得自动替用户做选择。

若收盘后用户仍未处理，周期进入 `expired_unfilled`，停止自动生成回补信号，但保留真实卖出流水和剩余未回补数量。用户之后只能明确选择“按实际成交补录回补”或“转为普通减仓”；系统不得在下一交易日自动延续原日内回补逻辑。

## 9. 云端数据模型

### 9.1 `trading_fee_profiles`

- `user_id uuid primary key references auth.users(id) on delete cascade`
- 费率字段和滑点配置
- `created_at timestamptz`
- `updated_at timestamptz`

### 9.2 `t_trade_cycles`

- `id uuid primary key`
- `user_id uuid`
- `position_id uuid`
- `code text`
- `cycle_type text`：`profit_t` / `cost_reduction_t`
- `status text`
- 建议卖出价格区间、数量和依据快照
- 实际卖出汇总价格、数量、时间和费用
- 建议回补价格区间和依据快照
- 实际回补汇总价格、数量、时间和费用
- 剩余待回补数量
- 预计及实际净收益
- 预计及实际成本改善
- `fee_profile_snapshot jsonb`：周期创建时冻结的费率口径
- `signal_basis_snapshot jsonb`：行情、指标、支撑阻力和数据时间戳快照
- `strategy_id`、`strategy_version`
- `trading_date date`
- `expires_at timestamptz`
- `created_at timestamptz`
- `updated_at timestamptz`

### 9.3 `t_trade_executions`

每一次用户确认的卖出或回补都单独记录，支持部分成交和多次回补：

- `id uuid primary key`
- `user_id uuid`
- `cycle_id uuid references t_trade_cycles(id) on delete cascade`
- `position_id uuid`
- `side text`：`sell` / `buyback`
- `price numeric`
- `shares integer`
- 佣金、印花税、过户费和实际总费用
- `fee_source text`：`broker_actual` / `profile_calculated`
- `executed_at timestamptz`
- `idempotency_key text`
- `created_at timestamptz`

周期表保存聚合结果，执行表保存不可变的逐笔事实。部分回补不得覆盖上一笔回补记录；所有聚合值必须能够从执行表重新计算。

所有表启用 RLS，用户只能访问自己的记录。写入成交、持仓、周期和信号状态时使用单个事务或 RPC，避免出现持仓已变但周期未更新的半完成状态。

## 10. 收件箱交互

新增消息种类：

- `actual_t_sell`：做 T 卖出。
- `actual_t_buyback`：做 T 回补。
- `actual_t_expiry_risk`：当日未完成风险提醒。
- `actual_t_risk_review`：跌破结构后暂停回补。

卖出消息展示股票、做 T 类型、实时触发价、建议数量、卖出区间、预计回补区间、ATR/阻力/量价/资金流依据、双边费用、预计净收益、预计降本金额和有效期。

回补消息展示实际卖出数据、剩余待回补数量、实时价格、目标区间、当前完整周期净收益估计和回补依据。

执行对话框要求用户确认实际成交价格和数量。成功后同时刷新实际持仓、周期和收件箱。查看股票继续使用现有个股分析路由，不改变个股分析页面。

## 11. 信号去重与常驻监控

云端常驻监控只扫描当前用户实际持仓和未完成做 T 周期。卖出信号唯一键至少包含：

```text
user_id + position_id + trading_date + strategy_version + signal_direction
```

同一条件持续成立时更新原信号快照，不重复创建消息。只有状态从不满足变为满足、上一信号被明确取消后再次形成新边沿，或策略版本变化时，才允许创建新信号。

回补信号绑定 `t_trade_cycle_id`。同一周期只维护一条有效回补信号，目标变化时更新而不是新增。

## 12. 异常处理

- 行情、K 线或技术指标过期时不产生新信号。
- 停牌、涨跌停、流动性不足或报价异常时阻断信号并记录原因。
- 可用股数变化后立即重算数量，建议数量不得超过最新可用股数。
- 用户费率缺失时使用默认值并明确标注。
- 云端写入失败时不修改本地展示为“已执行”。
- 重复执行相同消息必须幂等。
- 实际卖出后持仓被外部修改时，以最新持仓与交易流水重建周期约束，冲突时要求用户复核。
- 临近收盘提醒失败时保留周期状态，下一次前台恢复或 worker 运行时补发一次，不重复轰炸。

## 13. 测试要求

实施使用 TDD，至少覆盖：

1. 实际成交价 11.05、成本价 11.10 时使用 11.10 作为持仓成本基准。
2. 100 股低价交易触发最低 5 元佣金。
3. 大额交易使用比例佣金而不是最低佣金。
4. 卖出包含佣金、印花税、过户费和滑点；回补不收印花税。
5. 完整周期净收益同时扣除卖出和回补费用。
6. 真实成交价已包含冲击时，实际费用不重复扣除模拟滑点。
7. 不同价格和数量产生不同费用及目标价。
8. 数量不超过可用股数的 35%，并按 100 股取整。
9. 最优数量可以低于 35% 上限。
10. 买入当日冻结股数不进入可卖数量。
11. 盈利做 T 与降本做 T 正确分类。
12. 降本做 T 需要更强技术确认。
13. 样本不足时采用保守默认参数并显示原因。
14. 无未来数据的 walk-forward 校准。
15. 用户实际卖出价格和数量覆盖建议值。
16. 多次部分回补分别留痕，已实现收益只按配对数量计算。
17. 回补完成后实际净收益和成本改善正确。
18. 未回补部分转普通减仓后不再计作做 T 降本。
19. 跌破支撑时暂停机械回补。
20. 临近收盘只发送一次未完成提醒。
21. 收盘后未处理周期停止自动回补，不跨日机械延续。
22. 同一卖出或回补状态不重复创建消息。
23. 多用户费率、持仓、周期、执行记录和信号严格隔离。
24. 云端 RPC 幂等和事务失败回滚。
25. 个股分析和 K 线页面回归测试保持通过。

## 14. 验收标准

- 每只实际持仓显示独立的动态做 T 卖出区间、回补区间和计算依据。
- 中山公用等低价股的小额交易能够体现最低佣金造成的高单位成本。
- 系统不会发送扣除完整双边费用后预计亏损的做 T 信号。
- 单次建议数量永远不超过最新可用股数的 35%。
- 用户确认卖出后能收到绑定实际成交数据的回补信号。
- 完整或部分回补后持仓数量、成本、周期收益和交易流水一致。
- 亏损持仓允许产生明确标记的降本做 T 信号。
- 当日未完成时收到一次风险提醒，系统不自动下单。
- 云端部署版关闭页面后仍能由常驻监控产生信号。
- 所有用户数据通过 RLS 隔离，并保留策略版本和审计轨迹。

## 15. 参考依据

- Fidelity Average True Range：<https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr>
- Fidelity Average True Range Percent：<https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atrp>
- 财政部、税务总局关于减半征收证券交易印花税的公告：<https://www.gov.cn/zhengce/zhengceku/202308/content_6900443.htm>
- 中国证券登记结算有限责任公司收费标准：<http://www.chinaclear.cn/zdjs/fbzyls/service_tlist.shtml>
- 本地下载工程 `daily_stock_analysis` 的 ATRP、波动率、支撑阻力、资金流和 sniper points 实现。
