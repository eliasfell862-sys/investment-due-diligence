# 公式引擎基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 每个任务使用新的实现子代理，完成后依次进行独立规格审查和代码质量审查；两轮审查通过后才执行该任务的提交步骤。

**Goal:** 交付阶段 2 的共享分析契约、固定精度十进制边界、13 项 version `1` 公式注册表、受限 AST 求值器和确定性的公式依赖图。

**Architecture:** 公共 DTO 只携带规范十进制字符串、可判别单位、显式期间、value/source 引用和冲突状态；所有财务算术进入引擎后使用项目私有的 40 位 HALF_EVEN Decimal clone，离开引擎前重新规范化。公式由稳定 `formulaId`、独立 `version`、静态注册表和不可执行任意代码的 AST 描述；`evaluateMetric` 负责单指标递归求值，`evaluateFormulaGraph` 负责依赖闭包、稳定拓扑排序和循环检测，所有成功与阻塞结果统一 deep-freeze。

**Tech Stack:** TypeScript 6、decimal.js 10、Vitest 4、现有 `deepFreeze`、npm scripts（`test` / `typecheck` / `check`）

---

## 实施约束

- 所有 `npm`/Vitest/typecheck 命令从 `app/` 目录执行；所有 `git add`/`git commit` 命令从 worktree 仓库根目录执行。
- 每个任务严格执行 RED → GREEN → 聚焦回归 → 独立提交，不合并任务提交。
- `formulaId` 与 `version` 分离；13 个稳定 ID 不带版本后缀，初始版本均为 `"1"`，trace 使用 `formulaId@version`。
- DTO 缺字段、字段类型错误、未知公共 `formulaId` 或注册表 AST 损坏抛 `DomainContractError`。
- 公共 ID 存在但版本不支持时返回 `blocked/invalid-input + unsupported_formula`。
- DTO 结构合法但十进制、值域、单位、币种或期间非法时返回 `EngineResult.blocked`，不抛异常。
- 不读取当前时间、随机数、浏览器全局、Dexie 或网络；不新增 UI、路由、数据库表或报告代码。
- 生产代码不得使用 JavaScript `number` 执行财务算术；月份数、实际天数、图索引和数组下标除外。
- 所有排序使用注册表顺序或字典序作为稳定 tie-break，不依赖调用方数组顺序或对象插入顺序。

## 文件职责图

| 文件 | 职责 |
| --- | --- |
| `app/src/domain/analysis/decimal.ts` | 固定 Decimal clone、规范十进制字符串和五类数值域 |
| `app/src/domain/analysis/value.ts` | MoneyValue、AnalysisUnit、MetricValue 判别联合及结构解析 |
| `app/src/domain/analysis/period.ts` | FlowPeriod、AsOfPeriod、真实日期和期间策略基础校验 |
| `app/src/domain/analysis/scenario.ts` | 三情景唯一性和概率精确合计 |
| `app/src/domain/analysis/calculation-trace.ts` | 可 JSON 序列化的 formulaId@version、输入、步骤和输出轨迹 |
| `app/src/domain/analysis/engine-result.ts` | 诊断、DomainContractError、成功/阻塞结果工厂和 deep-freeze |
| `app/src/domain/deep-freeze.test.ts` | 既有递归冻结函数的对象/数组回归契约 |
| `app/src/engines/formulas/formula-types.ts` | 受限 AST、公式定义、版本化输入快照和输出 DTO |
| `app/src/engines/formulas/formula-definitions.ts` | 13 项 version 1 规范公式定义 |
| `app/src/engines/formulas/formula-registry.ts` | 注册时 AST/引用校验、稳定查找和版本解析 |
| `app/src/engines/formulas/validate-formula-inputs.ts` | DTO 结构、十进制、值域、单位、币种、冲突和期间策略 |
| `app/src/engines/formulas/evaluate-ast.ts` | 受限 AST 的纯 Decimal 求值和分母诊断 |
| `app/src/engines/formulas/evaluate-metric.ts` | 单公式依赖求值、业务阻塞、warning 和 trace 装配 |
| `app/src/engines/formulas/evaluate-formula-graph.ts` | 稳定依赖图、拓扑计算和循环检测 |
| `app/src/engines/formulas/formula-test-fixtures.ts` | 测试专用期间、单位、输入快照和断言构造器 |
| `app/src/engines/formulas/formula-golden-vectors.test.ts` | 13 项手算黄金向量和异常矩阵 |
| `app/src/engines/formulas/formula-invariants.test.ts` | 极大数、长小数、确定性、输入不变性、序列化和冻结 |

### Task 1: 固定 Decimal clone 与字段数值域

**Files:**
- Create: `app/src/domain/analysis/decimal.ts`
- Test: `app/src/domain/analysis/decimal.test.ts`

- [ ] **Step 1: 写入失败测试**

创建 `app/src/domain/analysis/decimal.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  AnalysisDecimal,
  canonicalDecimal,
  parseDecimalString,
  parseMultipleString,
  parseNonNegativeRateString,
  parseReturnRateString,
  parseSignedRateString,
  parseUnitIntervalString,
} from './decimal';

describe('analysis decimal boundary', () => {
  it.each([
    ['0', '0'],
    ['-12.500', '-12.5'],
    ['0.0000000000000000000000000000000000000001', '0.0000000000000000000000000000000000000001'],
    ['9999999999999999999999999999999999999999', '9999999999999999999999999999999999999999'],
  ] as const)('normalizes %s without crossing through number', (input, expected) => {
    expect(canonicalDecimal(new AnalysisDecimal(input))).toBe(expected);
  });

  it('uses 40 significant digits and bankers rounding', () => {
    const tie = new AnalysisDecimal(
      '1.2345678901234567890123456789012345678955',
    ).plus(0);
    expect(canonicalDecimal(tie)).toBe('1.234567890123456789012345678901234567896');
    expect(AnalysisDecimal.precision).toBe(40);
    expect(AnalysisDecimal.rounding).toBe(AnalysisDecimal.ROUND_HALF_EVEN);
  });

  it.each(['', ' ', '01', '+1', '1.', '.5', '1e3', '0x10', '1,000', 'NaN', 'Infinity', '-0'])(
    'rejects non-canonical public decimal %j',
    (value) => expect(() => parseDecimalString(value)).toThrowError(
      expect.objectContaining({ code: 'invalid_decimal' }),
    ),
  );

  it.each([
    [parseUnitIntervalString, '0', '0'],
    [parseUnitIntervalString, '1', '1'],
    [parseNonNegativeRateString, '2.5', '2.5'],
    [parseSignedRateString, '-0.25', '-0.25'],
    [parseReturnRateString, '-0.5', '-0.5'],
    [parseReturnRateString, '3', '3'],
    [parseMultipleString, '12.5', '12.5'],
  ] as const)('accepts the approved domain %#(%s)', (parse, value, expected) => {
    expect(canonicalDecimal(parse(value))).toBe(expected);
  });

  it.each([
    [parseUnitIntervalString, '-0.0001', 'invalid_unit_interval'],
    [parseUnitIntervalString, '1.0001', 'invalid_unit_interval'],
    [parseNonNegativeRateString, '-0.01', 'invalid_non_negative_rate'],
    [parseReturnRateString, '-1', 'invalid_return_rate'],
    [parseReturnRateString, '-1.5', 'invalid_return_rate'],
    [parseMultipleString, '-0.01', 'invalid_multiple'],
  ] as const)('rejects %s with %s', (parse, value, code) => {
    expect(() => parse(value)).toThrowError(expect.objectContaining({ code }));
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- src/domain/analysis/decimal.test.ts`

Expected: FAIL，Vitest 报告无法解析 `./decimal`。

- [ ] **Step 3: 写入最小实现**

创建 `app/src/domain/analysis/decimal.ts`：

```ts
import Decimal from 'decimal.js';

export type DecimalString = string;
export type FractionString = DecimalString;
export type UnitIntervalString = FractionString;
export type ProbabilityString = UnitIntervalString;
export type OwnershipString = UnitIntervalString;
export type TaxRateString = UnitIntervalString;
export type MitigationString = UnitIntervalString;
export type NonNegativeRateString = FractionString;
export type SignedRateString = FractionString;
export type ReturnRateString = FractionString;
export type MultipleString = DecimalString;

export type DecimalBoundaryErrorCode =
  | 'invalid_decimal'
  | 'invalid_unit_interval'
  | 'invalid_non_negative_rate'
  | 'invalid_return_rate'
  | 'invalid_multiple';

export class DecimalBoundaryError extends Error {
  readonly code: DecimalBoundaryErrorCode;
  readonly input: unknown;

  constructor(code: DecimalBoundaryErrorCode, input: unknown) {
    super(code);
    this.name = 'DecimalBoundaryError';
    this.code = code;
    this.input = input;
  }
}

export const AnalysisDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
});

const canonicalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;

export function canonicalDecimal(value: Decimal): DecimalString {
  if (!value.isFinite()) throw new DecimalBoundaryError('invalid_decimal', value.toString());
  const fixed = value.toFixed();
  return fixed === '-0' ? '0' : fixed;
}

export function parseDecimalString(input: unknown): Decimal {
  if (typeof input !== 'string' || !canonicalPattern.test(input)) {
    throw new DecimalBoundaryError('invalid_decimal', input);
  }
  const value = new AnalysisDecimal(input);
  if (!value.isFinite() || canonicalDecimal(value) !== input) {
    throw new DecimalBoundaryError('invalid_decimal', input);
  }
  return value;
}

export function parseUnitIntervalString(input: unknown): Decimal {
  const value = parseDecimalString(input);
  if (value.isNegative() || value.greaterThan(1)) {
    throw new DecimalBoundaryError('invalid_unit_interval', input);
  }
  return value;
}

export function parseNonNegativeRateString(input: unknown): Decimal {
  const value = parseDecimalString(input);
  if (value.isNegative()) {
    throw new DecimalBoundaryError('invalid_non_negative_rate', input);
  }
  return value;
}

export const parseSignedRateString = parseDecimalString;
export function parseReturnRateString(input: unknown): Decimal {
  const value = parseDecimalString(input);
  if (value.lessThanOrEqualTo(-1)) {
    throw new DecimalBoundaryError('invalid_return_rate', input);
  }
  return value;
}

export function parseMultipleString(input: unknown): Decimal {
  const value = parseDecimalString(input);
  if (value.isNegative()) throw new DecimalBoundaryError('invalid_multiple', input);
  return value;
}
```

- [ ] **Step 4: 运行聚焦测试并确认 GREEN**

Run: `npm test -- src/domain/analysis/decimal.test.ts`

Expected: PASS，固定精度、规范字符串和数值域测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add app/src/domain/analysis/decimal.ts app/src/domain/analysis/decimal.test.ts
git commit -m "feat: add deterministic analysis decimal domains"
```

### Task 2: MetricValue 判别联合与显式期间

**Files:**
- Create: `app/src/domain/analysis/value.ts`
- Create: `app/src/domain/analysis/period.ts`
- Test: `app/src/domain/analysis/value.test.ts`
- Test: `app/src/domain/analysis/period.test.ts`

- [ ] **Step 1: 写入失败测试**

`value.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { parseMetricValueStructure, parseMoneyValueStructure } from './value';

describe('analysis value structures', () => {
  it('accepts negative money and explicit currency units', () => {
    expect(parseMoneyValueStructure({ amount: '-1250.5', currency: 'CNY' })).toEqual({
      amount: '-1250.5',
      currency: 'CNY',
    });
    expect(parseMetricValueStructure({
      value: '120',
      unit: { kind: 'currency', currency: 'USD' },
    })).toEqual({
      value: '120',
      unit: { kind: 'currency', currency: 'USD' },
    });
  });

  it.each([
    [{ value: '45', unit: { kind: 'count', countKind: 'customer' } }],
    [{ value: '0.25', unit: { kind: 'ratio', rateKind: 'unit-interval' } }],
    [{ value: '-0.1', unit: { kind: 'ratio', rateKind: 'signed-rate' } }],
    [{ value: '3', unit: { kind: 'multiple' } }],
    [{ value: '18', unit: { kind: 'duration', durationUnit: 'months' } }],
    [{ value: '1200', unit: { kind: 'currency-per-count', currency: 'CNY', countKind: 'customer' } }],
    [{ value: '100', unit: { kind: 'currency', currency: 'JPY' } }],
  ] as const)('accepts discriminated MetricValue %#', (value) => {
    expect(parseMetricValueStructure(value)).toEqual(value);
  });

  it.each([
    [{ value: '1', unit: { kind: 'currency' } }],
    [{ value: '1', unit: { kind: 'count' } }],
    [{ value: '1', unit: { kind: 'ratio', rateKind: 'percent' } }],
    [{ value: 1, unit: { kind: 'multiple' } }],
    [{ unit: { kind: 'multiple' } }],
  ])('throws invalid_dto for structurally damaged value %#', (value) => {
    expect(() => parseMetricValueStructure(value)).toThrowError(
      expect.objectContaining({ code: 'invalid_dto' }),
    );
  });

  it('keeps a structurally valid bad decimal for EngineResult validation', () => {
    expect(parseMetricValueStructure({
      value: 'abc',
      unit: { kind: 'multiple' },
    })).toEqual({
      value: 'abc',
      unit: { kind: 'multiple' },
    });
  });
});
```

`period.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { parseAnalysisPeriodStructure, validateAnalysisPeriodValue } from './period';

const fy2025 = {
  kind: 'flow',
  id: 'FY2025',
  startDate: '2025-01-01',
  endDate: '2025-12-31',
  durationMonths: 12,
  granularity: 'year',
} as const;

describe('analysis periods', () => {
  it.each([
    [fy2025],
    [{ kind: 'flow', id: '2025-02', startDate: '2025-02-01', endDate: '2025-02-28', durationMonths: 1, granularity: 'month' }],
    [{ kind: 'as-of', id: 'FY2025-end', date: '2025-12-31' }],
  ] as const)('accepts period %#', (period) => {
    expect(validateAnalysisPeriodValue(parseAnalysisPeriodStructure(period))).toEqual({
      status: 'valid',
      period,
    });
  });

  it.each([
    [{ ...fy2025, startDate: '2025-13-01' }],
    [{ ...fy2025, durationMonths: 11 }],
    [{ kind: 'flow', id: 'bad-month', startDate: '2025-02-02', endDate: '2025-02-28', durationMonths: 1, granularity: 'month' }],
    [{ kind: 'as-of', id: 'bad-date', date: '2025-02-29' }],
  ] as const)('returns invalid period value for %#', (period) => {
    expect(validateAnalysisPeriodValue(parseAnalysisPeriodStructure(period))).toEqual({
      status: 'invalid',
    });
  });

  it('throws invalid_dto when the discriminant or required fields are missing', () => {
    expect(() => parseAnalysisPeriodStructure({ id: 'FY2025' })).toThrowError(
      expect.objectContaining({ code: 'invalid_dto' }),
    );
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- src/domain/analysis/value.test.ts src/domain/analysis/period.test.ts`

Expected: FAIL，两个模块均不存在。

- [ ] **Step 3: 写入最小实现**

`value.ts` 定义以下完整契约。结构解析只检查字段存在和字段类型；`"abc"` 仍是字符串，因此留给公式层返回 `invalid_decimal`：

```ts
import type { DecimalString } from './decimal';

export type CurrencyCode = string;

export type CountKind = 'customer' | 'user' | 'unit' | 'share' | 'order';
export type AnalysisUnit =
  | { readonly kind: 'currency'; readonly currency: CurrencyCode }
  | { readonly kind: 'ratio'; readonly rateKind: 'unit-interval' | 'non-negative-rate' | 'signed-rate' | 'return-rate' }
  | { readonly kind: 'multiple' }
  | { readonly kind: 'duration'; readonly durationUnit: 'months' | 'days' | 'years' }
  | { readonly kind: 'count'; readonly countKind: CountKind }
  | { readonly kind: 'currency-per-count'; readonly currency: CurrencyCode; readonly countKind: CountKind; readonly perPeriod?: 'month' | 'year' };

export interface MoneyValue {
  readonly amount: DecimalString;
  readonly currency: CurrencyCode;
}

export interface MetricValue {
  readonly value: DecimalString;
  readonly unit: AnalysisUnit;
}

export class DomainContractError extends Error {
  readonly code: 'invalid_dto' | 'unknown_formula' | 'invalid_formula_definition';
  constructor(code: DomainContractError['code'], message: string) {
    super(message);
    this.name = 'DomainContractError';
    this.code = code;
  }
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DomainContractError('invalid_dto', label + ' must be an object');
  }
  return value as Readonly<Record<string, unknown>>;
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new DomainContractError('invalid_dto', label + ' must be a string');
  }
  return value;
}

function currency(value: unknown): CurrencyCode {
  const code = stringField(value, 'currency');
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new DomainContractError('invalid_dto', 'currency must be an uppercase ISO 4217 code');
  }
  return code;
}

export function parseMoneyValueStructure(value: unknown): MoneyValue {
  const item = record(value, 'MoneyValue');
  return { amount: stringField(item.amount, 'amount'), currency: currency(item.currency) };
}

export function parseMetricValueStructure(value: unknown): MetricValue {
  const item = record(value, 'MetricValue');
  const rawUnit = record(item.unit, 'MetricValue.unit');
  const kind = stringField(rawUnit.kind, 'MetricValue.unit.kind');
  const metricValue = stringField(item.value, 'MetricValue.value');

  if (kind === 'currency') return { value: metricValue, unit: { kind, currency: currency(rawUnit.currency) } };
  if (kind === 'multiple') return { value: metricValue, unit: { kind } };
  if (kind === 'ratio' && ['unit-interval', 'non-negative-rate', 'signed-rate', 'return-rate'].includes(String(rawUnit.rateKind))) {
    return { value: metricValue, unit: { kind, rateKind: rawUnit.rateKind as 'unit-interval' | 'non-negative-rate' | 'signed-rate' | 'return-rate' } };
  }
  if (kind === 'duration' && ['months', 'days', 'years'].includes(String(rawUnit.durationUnit))) {
    return { value: metricValue, unit: { kind, durationUnit: rawUnit.durationUnit as 'months' | 'days' | 'years' } };
  }
  if (kind === 'count' && ['customer', 'user', 'unit', 'share', 'order'].includes(String(rawUnit.countKind))) {
    return { value: metricValue, unit: { kind, countKind: rawUnit.countKind as CountKind } };
  }
  if (kind === 'currency-per-count' && ['customer', 'user', 'unit', 'share', 'order'].includes(String(rawUnit.countKind))) {
    const perPeriod = rawUnit.perPeriod;
    if (perPeriod !== undefined && perPeriod !== 'month' && perPeriod !== 'year') {
      throw new DomainContractError('invalid_dto', 'invalid perPeriod');
    }
    return {
      value: metricValue,
      unit: {
        kind,
        currency: currency(rawUnit.currency),
        countKind: rawUnit.countKind as CountKind,
        ...(perPeriod === undefined ? {} : { perPeriod }),
      },
    };
  }
  throw new DomainContractError('invalid_dto', 'MetricValue.unit is damaged');
}
```

`period.ts` 定义 `FlowPeriod`、`AsOfPeriod`、`AnalysisPeriod`、结构解析和数值校验。真实日期用 UTC round-trip；月度必须月初至月末；年度必须从月初开始、到第 12 个月月末结束；`durationMonths` 必须等于首尾月份差加一：

```ts
import { DomainContractError } from './value';

export interface FlowPeriod {
  readonly kind: 'flow';
  readonly id: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly durationMonths: number;
  readonly granularity: 'month' | 'year';
}
export interface AsOfPeriod {
  readonly kind: 'as-of';
  readonly id: string;
  readonly date: string;
}
export type AnalysisPeriod = FlowPeriod | AsOfPeriod;
export type PeriodValueValidation =
  | { readonly status: 'valid'; readonly period: AnalysisPeriod }
  | { readonly status: 'invalid' };

export function parseAnalysisPeriodStructure(value: unknown): AnalysisPeriod {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DomainContractError('invalid_dto', 'period must be an object');
  }
  const item = value as Readonly<Record<string, unknown>>;
  if (typeof item.kind !== 'string' || typeof item.id !== 'string') {
    throw new DomainContractError('invalid_dto', 'period discriminant and id are required');
  }
  if (item.kind === 'as-of' && typeof item.date === 'string') {
    return { kind: 'as-of', id: item.id, date: item.date };
  }
  if (
    item.kind === 'flow' &&
    typeof item.startDate === 'string' &&
    typeof item.endDate === 'string' &&
    typeof item.durationMonths === 'number' &&
    (item.granularity === 'month' || item.granularity === 'year')
  ) {
    return {
      kind: 'flow', id: item.id, startDate: item.startDate, endDate: item.endDate,
      durationMonths: item.durationMonths, granularity: item.granularity,
    };
  }
  throw new DomainContractError('invalid_dto', 'period fields are damaged');
}

const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
function date(value: string): Date | undefined {
  if (!isoPattern.test(value)) return undefined;
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10) === value ? parsed : undefined;
}
function monthDistance(start: Date, end: Date): number {
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() - start.getUTCMonth() + 1;
}
function monthEnd(day: Date): number {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
}

export function validateAnalysisPeriodValue(period: AnalysisPeriod): PeriodValueValidation {
  if (period.id.length === 0) return { status: 'invalid' };
  if (period.kind === 'as-of') {
    return date(period.date) ? { status: 'valid', period } : { status: 'invalid' };
  }
  const start = date(period.startDate);
  const end = date(period.endDate);
  if (
    !start || !end || start > end ||
    !Number.isInteger(period.durationMonths) || period.durationMonths <= 0 ||
    start.getUTCDate() !== 1 || end.getUTCDate() !== monthEnd(end) ||
    monthDistance(start, end) !== period.durationMonths ||
    (period.granularity === 'month' && period.durationMonths !== 1) ||
    (period.granularity === 'year' && period.durationMonths !== 12)
  ) {
    return { status: 'invalid' };
  }
  return { status: 'valid', period };
}
```

- [ ] **Step 4: 运行聚焦测试并确认 GREEN**

Run: `npm test -- src/domain/analysis/value.test.ts src/domain/analysis/period.test.ts`

Expected: PASS，判别单位、结构/数值错误分层、真实日期和期间跨度测试通过。

- [ ] **Step 5: 提交**

```bash
git add app/src/domain/analysis/value.ts app/src/domain/analysis/value.test.ts app/src/domain/analysis/period.ts app/src/domain/analysis/period.test.ts
git commit -m "feat: add discriminated values and explicit periods"
```

### Task 3: Scenario、EngineResult、trace 和 deep-freeze

**Files:**
- Create: `app/src/domain/analysis/scenario.ts`
- Create: `app/src/domain/analysis/scenario.test.ts`
- Create: `app/src/domain/analysis/calculation-trace.ts`
- Create: `app/src/domain/analysis/engine-result.ts`
- Create: `app/src/domain/analysis/engine-result.test.ts`
- Create: `app/src/domain/deep-freeze.test.ts`
- Reuse unchanged: `app/src/domain/deep-freeze.ts`

- [ ] **Step 1: 写入失败测试**

`scenario.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { validateScenarioSet } from './scenario';

describe('scenario contract', () => {
  it('returns downside/base/upside in stable order when Decimal probabilities sum to one', () => {
    expect(validateScenarioSet([
      { id: 'upside', probability: '0.2', assumptions: { growth: '0.2' } },
      { id: 'downside', probability: '0.3', assumptions: { growth: '-0.1' } },
      { id: 'base', probability: '0.5', assumptions: { growth: '0.1' } },
    ])).toMatchObject({ status: 'valid', scenarios: [
      { id: 'downside' }, { id: 'base' }, { id: 'upside' },
    ] });
  });

  it.each([
    [[{ id: 'downside', probability: '0.5', assumptions: {} }], 'invalid_scenario_set'],
    [[
      { id: 'downside', probability: '0.5', assumptions: {} },
      { id: 'base', probability: '0.6', assumptions: {} },
      { id: 'upside', probability: '-0.1', assumptions: {} },
    ], 'value_out_of_range'],
    [[
      { id: 'downside', probability: '0.3', assumptions: {} },
      { id: 'base', probability: '0.6', assumptions: {} },
      { id: 'upside', probability: '0.2', assumptions: {} },
    ], 'probability_sum_mismatch'],
  ] as const)('returns %s for a structurally valid bad set', (scenarios, code) => {
    expect(validateScenarioSet(scenarios)).toMatchObject({ status: 'invalid', issue: { code } });
  });

  it.each([
    null,
    [{ id: 'downside', probability: 0.3, assumptions: {} }],
    [null, null, null],
  ])('throws invalid_dto for damaged scenario DTO %#', (input) => {
    expect(() => validateScenarioSet(input)).toThrowError(
      expect.objectContaining({ code: 'invalid_dto' }),
    );
  });
});
```

`engine-result.test.ts` 与 `deep-freeze.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { blockedResult, okResult } from './engine-result';

const trace = {
  engine: 'formula' as const,
  formulaRef: 'gross_margin@1',
  inputs: [{
    valueRef: 'revenue:FY2025',
    metricId: 'revenue',
    value: '100',
    unit: { kind: 'currency' as const, currency: 'CNY' as const },
    periodId: 'FY2025',
    sourceRefs: ['evidence-1'],
  }],
  steps: [{
    id: 'gross_margin@1:divide:1',
    operator: 'divide',
    operands: ['60', '100'],
    result: '0.6',
    rule: 'positive',
    outcome: 'passed' as const,
  }],
  output: { value: '0.6', unit: { kind: 'ratio' as const, rateKind: 'signed-rate' as const } },
};

describe('EngineResult', () => {
  it.each([
    okResult({ metricId: 'gross_margin' }, [], trace),
    blockedResult('invalid-input', [{
      code: 'unit_mismatch',
      path: 'inputs.revenue',
      message: 'Expected currency.',
      details: { expected: 'currency', actual: 'count' },
    }], trace),
  ])('deep-freezes and JSON serializes result %#', (result) => {
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.trace.inputs)).toBe(true);
    expect(Object.isFrozen(result.trace.steps[0])).toBe(true);
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(JSON.stringify(result)).not.toContain('undefined');
  });
});
```

`app/src/domain/deep-freeze.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { deepFreeze } from './deep-freeze';

describe('deepFreeze', () => {
  it('recursively freezes arrays and plain objects without changing identity', () => {
    const input = { rows: [{ value: '1' }], metadata: { version: '1' } };
    const result = deepFreeze(input);
    expect(result).toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.rows)).toBe(true);
    expect(Object.isFrozen(result.rows[0])).toBe(true);
    expect(Object.isFrozen(result.metadata)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- src/domain/analysis/scenario.test.ts src/domain/analysis/engine-result.test.ts src/domain/deep-freeze.test.ts`

Expected: FAIL，scenario 和 engine-result 模块不存在；既有 deepFreeze 回归测试通过。

- [ ] **Step 3: 写入最小实现**

`scenario.ts` 使用 `parseDecimalString` 精确解析后显式校验 `[0,1]`，从而把格式错误映射为 `invalid_decimal`、值域错误映射为 `value_out_of_range`：

```ts
import { AnalysisDecimal, canonicalDecimal, parseDecimalString, type ProbabilityString } from './decimal';
import { DomainContractError } from './value';

export const SCENARIO_IDS = ['downside', 'base', 'upside'] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];
export interface ScenarioDefinition<T> {
  readonly id: ScenarioId;
  readonly probability: ProbabilityString;
  readonly assumptions: T;
}
export type ScenarioValidation<T> =
  | { readonly status: 'valid'; readonly scenarios: readonly ScenarioDefinition<T>[] }
  | { readonly status: 'invalid'; readonly issue: { readonly code: 'invalid_scenario_set' | 'invalid_decimal' | 'value_out_of_range' | 'probability_sum_mismatch' } };

export function validateScenarioSet<T = unknown>(input: unknown): ScenarioValidation<T> {
  if (!Array.isArray(input)) {
    throw new DomainContractError('invalid_dto', 'scenarios must be an array');
  }
  for (const item of input) {
    if (
      typeof item !== 'object' || item === null || Array.isArray(item) ||
      typeof (item as Record<string, unknown>).id !== 'string' ||
      typeof (item as Record<string, unknown>).probability !== 'string' ||
      !Object.prototype.hasOwnProperty.call(item, 'assumptions')
    ) {
      throw new DomainContractError('invalid_dto', 'scenario fields are damaged');
    }
  }
  if (input.length !== 3) {
    return { status: 'invalid', issue: { code: 'invalid_scenario_set' } };
  }
  const scenarios = input as readonly ScenarioDefinition<T>[];
  const byId = new Map<ScenarioId, ScenarioDefinition<T>>();
  let sum = new AnalysisDecimal(0);
  for (const scenario of scenarios) {
    if (!SCENARIO_IDS.includes(scenario.id) || byId.has(scenario.id)) {
      return { status: 'invalid', issue: { code: 'invalid_scenario_set' } };
    }
    try {
      const probability = parseDecimalString(scenario.probability);
      if (probability.isNegative() || probability.greaterThan(1)) {
        return { status: 'invalid', issue: { code: 'value_out_of_range' } };
      }
      sum = sum.plus(probability);
    } catch {
      return { status: 'invalid', issue: { code: 'invalid_decimal' } };
    }
    byId.set(scenario.id, { ...scenario });
  }
  if (canonicalDecimal(sum) !== '1') {
    return { status: 'invalid', issue: { code: 'probability_sum_mismatch' } };
  }
  return { status: 'valid', scenarios: SCENARIO_IDS.map((id) => byId.get(id) as ScenarioDefinition<T>) };
}
```

`calculation-trace.ts`：

```ts
import type { AnalysisUnit, MetricValue } from './value';

export interface TraceInput {
  readonly valueRef: string;
  readonly metricId: string;
  readonly value: string;
  readonly unit: AnalysisUnit;
  readonly periodId: string;
  readonly sourceRefs: readonly string[];
}
export interface TraceStep {
  readonly id: string;
  readonly operator: string;
  readonly operands: readonly string[];
  readonly result?: string;
  readonly rule?: string;
  readonly outcome?: 'passed' | 'blocked';
}
export interface CalculationTrace {
  readonly engine: 'formula';
  readonly formulaRef: string;
  readonly inputs: readonly TraceInput[];
  readonly steps: readonly TraceStep[];
  readonly output?: MetricValue;
}
```

`engine-result.ts`：

```ts
import { deepFreeze } from '../deep-freeze';
import type { CalculationTrace } from './calculation-trace';

export type EngineIssueCode =
  | 'missing_input' | 'invalid_decimal' | 'value_out_of_range' | 'currency_mismatch' | 'unit_mismatch'
  | 'period_mismatch' | 'division_by_zero' | 'non_positive_denominator'
  | 'probability_sum_mismatch' | 'circular_dependency' | 'unsupported_formula'
  | 'root_not_found' | 'insufficient_comparables' | 'invalid_terminal_value'
  | 'unresolved_conflict';

export interface EngineIssue {
  readonly code: EngineIssueCode;
  readonly path: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}
export type EngineResult<T> =
  | { readonly status: 'ok'; readonly value: T; readonly warnings: readonly EngineIssue[]; readonly trace: CalculationTrace }
  | { readonly status: 'blocked'; readonly reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful'; readonly issues: readonly EngineIssue[]; readonly trace: CalculationTrace };

export function okResult<T>(value: T, warnings: readonly EngineIssue[], trace: CalculationTrace): EngineResult<T> {
  return deepFreeze({ status: 'ok', value, warnings: [...warnings], trace });
}
export function blockedResult<T = never>(
  reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful',
  issues: readonly EngineIssue[],
  trace: CalculationTrace,
): EngineResult<T> {
  return deepFreeze({ status: 'blocked', reason, issues: [...issues], trace });
}
```

- [ ] **Step 4: 运行聚焦测试并确认 GREEN**

Run: `npm test -- src/domain/analysis/scenario.test.ts src/domain/analysis/engine-result.test.ts src/domain/deep-freeze.test.ts`

Expected: PASS，三情景、稳定诊断、trace、JSON 和深层冻结全部通过。

- [ ] **Step 5: 提交**

```bash
git add app/src/domain/analysis/scenario.ts app/src/domain/analysis/scenario.test.ts app/src/domain/analysis/calculation-trace.ts app/src/domain/analysis/engine-result.ts app/src/domain/analysis/engine-result.test.ts app/src/domain/deep-freeze.test.ts
git commit -m "feat: add frozen analysis results and scenarios"
```

### Task 4: 受限 AST、版本化注册表和 13 项规范定义

**Files:**
- Create: `app/src/engines/formulas/formula-types.ts`
- Create: `app/src/engines/formulas/formula-definitions.ts`
- Create: `app/src/engines/formulas/formula-registry.ts`
- Test: `app/src/engines/formulas/formula-registry.test.ts`

- [ ] **Step 1: 写入失败测试**

```ts
import { describe, expect, it } from 'vitest';
import {
  FORMULA_IDS,
  getFormulaDefinition,
  listFormulaDefinitions,
  resolveFormulaDefinition,
  validateFormulaDefinitions,
} from './formula-registry';

describe('formula registry', () => {
  it('contains exactly 13 stable IDs at version 1', () => {
    expect(FORMULA_IDS).toEqual([
      'gross_margin', 'ebitda_margin', 'free_cash_flow', 'burn_multiple',
      'cac_payback_months', 'cash_runway_months', 'revenue_cagr',
      'customer_concentration', 'repeat_purchase_rate', 'nrr', 'ltv_cac',
      'inventory_turnover_days', 'net_new_arr',
    ]);
    expect(listFormulaDefinitions().map((item) => [item.formulaId, item.version])).toEqual(
      FORMULA_IDS.map((formulaId) => [formulaId, '1']),
    );
  });

  it('stores restricted data AST and validates formula references', () => {
    const definitions = listFormulaDefinitions();
    expect(JSON.stringify(definitions)).not.toContain('function');
    expect(getFormulaDefinition('burn_multiple', '1').ast).toMatchObject({
      kind: 'divide',
      denominator: { kind: 'formula-ref', formulaId: 'net_new_arr', version: '1' },
    });
    expect(Object.isFrozen(definitions[0])).toBe(true);
  });

  it('throws unknown_formula for an unknown public ID', () => {
    expect(() => resolveFormulaDefinition('made_up_metric', '1')).toThrowError(
      expect.objectContaining({ code: 'unknown_formula' }),
    );
  });

  it('returns unsupported for a known ID at an unavailable version', () => {
    expect(resolveFormulaDefinition('gross_margin', '2')).toEqual({
      status: 'unsupported',
      formulaId: 'gross_margin',
      version: '2',
    });
  });

  it('rejects incompatible AST unit algebra and declared output dimensions', () => {
    const grossMargin = getFormulaDefinition('gross_margin', '1');
    expect(() => validateFormulaDefinitions([{
      ...grossMargin,
      outputUnit: { kind: 'currency', currency: 'CNY' },
    }])).toThrowError(expect.objectContaining({ code: 'invalid_formula_definition' }));
    expect(() => validateFormulaDefinitions([{
      ...grossMargin,
      operands: [
        grossMargin.operands[0],
        { ...grossMargin.operands[1], expectedUnit: { kind: 'count', countKind: 'customer' } },
      ],
      ast: {
        kind: 'add',
        values: [
          { kind: 'operand', operandId: 'revenue' },
          { kind: 'operand', operandId: 'cost_of_goods_sold' },
        ],
      },
    }])).toThrowError(expect.objectContaining({ code: 'invalid_formula_definition' }));
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- src/engines/formulas/formula-registry.test.ts`

Expected: FAIL，注册表模块不存在。

- [ ] **Step 3: 写入类型和完整定义**

`formula-types.ts`：

```ts
import type { DecimalString } from '../../domain/analysis/decimal';
import type { EngineResult } from '../../domain/analysis/engine-result';
import type { AnalysisPeriod, AsOfPeriod } from '../../domain/analysis/period';
import type { AnalysisUnit, MetricValue } from '../../domain/analysis/value';

export const FORMULA_IDS = [
  'gross_margin', 'ebitda_margin', 'free_cash_flow', 'burn_multiple',
  'cac_payback_months', 'cash_runway_months', 'revenue_cagr',
  'customer_concentration', 'repeat_purchase_rate', 'nrr', 'ltv_cac',
  'inventory_turnover_days', 'net_new_arr',
] as const;
export type FormulaId = (typeof FORMULA_IDS)[number];
export type FormulaVersion = '1';
export type FormulaDirection = 'higher_is_better' | 'lower_is_better' | 'neutral';
export type PeriodRule = 'same-flow-period' | 'same-as-of' | 'ordered-as-of-endpoints' | 'mixed-stock-flow';
export interface EffectivePeriodSpan {
  readonly kind: 'span';
  readonly startDate: string;
  readonly endDate: string;
  readonly durationMonths: number;
}
export type CalculationPeriod = AsOfPeriod | EffectivePeriodSpan;
export type DenominatorRule = 'positive';

export type FormulaAst =
  | { readonly kind: 'literal'; readonly value: DecimalString }
  | { readonly kind: 'operand'; readonly operandId: string }
  | { readonly kind: 'formula-ref'; readonly formulaId: FormulaId; readonly version: FormulaVersion }
  | { readonly kind: 'add'; readonly values: readonly FormulaAst[] }
  | { readonly kind: 'subtract'; readonly left: FormulaAst; readonly right: FormulaAst }
  | { readonly kind: 'multiply'; readonly values: readonly FormulaAst[] }
  | { readonly kind: 'divide'; readonly numerator: FormulaAst; readonly denominator: FormulaAst; readonly rule: DenominatorRule }
  | { readonly kind: 'power'; readonly base: FormulaAst; readonly exponent: FormulaAst };

export interface FormulaOperandSpec {
  readonly operandId: string;
  readonly metricId: string;
  readonly expectedUnit: AnalysisUnit;
  readonly periodRole: 'flow' | 'as-of-begin' | 'as-of-end' | 'as-of' | 'representative-month';
  readonly numericDomain: 'decimal' | 'unit-interval' | 'non-negative-rate' | 'signed-rate' | 'multiple';
  readonly nonNegative?: boolean;
  readonly notGreaterThanOperand?: string;
}
export type FormulaConstraint =
  | { readonly kind: 'sum-lte-sum'; readonly left: readonly string[]; readonly right: readonly string[] };
export interface FormulaDefinition {
  readonly formulaId: FormulaId;
  readonly version: FormulaVersion;
  readonly operands: readonly FormulaOperandSpec[];
  readonly outputUnit: AnalysisUnit;
  readonly outputNumericDomain?: FormulaOperandSpec['numericDomain'];
  readonly periodRule: PeriodRule;
  readonly direction: FormulaDirection;
  readonly ast: FormulaAst;
  readonly constraints?: readonly FormulaConstraint[];
}
export type ConflictStatus = 'none' | 'resolved' | 'conservative-selected' | 'blocking';
export interface FormulaObservation {
  readonly valueRef: string;
  readonly metricId: string;
  readonly value: MetricValue;
  readonly period: AnalysisPeriod;
  readonly sourceRefs: readonly string[];
  readonly conflict: {
    readonly status: ConflictStatus;
    readonly selectionReason?: string;
  };
  readonly label?: string;
}
export interface MetricEvaluationInput {
  readonly formulaId: string;
  readonly version: string;
  readonly observations: readonly FormulaObservation[];
}
export interface MetricCalculation {
  readonly formulaId: FormulaId;
  readonly version: FormulaVersion;
  readonly value: MetricValue;
  readonly period: CalculationPeriod;
  readonly periodRefs: readonly string[];
  readonly direction: FormulaDirection;
}
export interface FormulaGraphInput {
  readonly requests: readonly { readonly formulaId: string; readonly version: string }[];
  readonly observations: readonly FormulaObservation[];
}
export interface FormulaGraphResult {
  readonly calculations: readonly MetricCalculation[];
}
export type EvaluateMetric = (input: MetricEvaluationInput) => EngineResult<MetricCalculation>;
```

`formula-definitions.ts` 使用以下辅助构造器，并逐项写出 13 个定义。所有 definitions 经 `deepFreeze`，不得包含函数字段：

```ts
import { deepFreeze } from '../../domain/deep-freeze';
import type { AnalysisUnit } from '../../domain/analysis/value';
import type { FormulaAst, FormulaDefinition, FormulaOperandSpec } from './formula-types';

const CNY: AnalysisUnit = { kind: 'currency', currency: 'CNY' };
const CUSTOMER_MONEY: AnalysisUnit = { kind: 'currency-per-count', currency: 'CNY', countKind: 'customer' };
const MONTHLY_CUSTOMER_MONEY: AnalysisUnit = { kind: 'currency-per-count', currency: 'CNY', countKind: 'customer', perPeriod: 'month' };
const CUSTOMER_COUNT: AnalysisUnit = { kind: 'count', countKind: 'customer' };
const operand = (operandId: string): FormulaAst => ({ kind: 'operand', operandId });
const literal = (value: string): FormulaAst => ({ kind: 'literal', value });
const divide = (numerator: FormulaAst, denominator: FormulaAst): FormulaAst =>
  ({ kind: 'divide', numerator, denominator, rule: 'positive' });
const money = (
  operandId: string,
  periodRole: FormulaOperandSpec['periodRole'],
  options: Pick<FormulaOperandSpec, 'nonNegative' | 'notGreaterThanOperand'> = {},
): FormulaOperandSpec => ({
  operandId, metricId: operandId, expectedUnit: CNY, periodRole,
  numericDomain: 'decimal', ...options,
});

export const formulaDefinitions: readonly FormulaDefinition[] = deepFreeze([
  {
    formulaId: 'gross_margin', version: '1',
    operands: [money('revenue', 'flow'), money('cost_of_goods_sold', 'flow')],
    outputUnit: { kind: 'ratio', rateKind: 'signed-rate' },
    periodRule: 'same-flow-period', direction: 'higher_is_better',
    ast: divide({ kind: 'subtract', left: operand('revenue'), right: operand('cost_of_goods_sold') }, operand('revenue')),
  },
  {
    formulaId: 'ebitda_margin', version: '1',
    operands: [money('ebitda', 'flow'), money('revenue', 'flow')],
    outputUnit: { kind: 'ratio', rateKind: 'signed-rate' },
    periodRule: 'same-flow-period', direction: 'higher_is_better',
    ast: divide(operand('ebitda'), operand('revenue')),
  },
  {
    formulaId: 'free_cash_flow', version: '1',
    operands: [money('operating_cash_flow', 'flow'), money('capital_expenditure', 'flow', { nonNegative: true })],
    outputUnit: CNY, periodRule: 'same-flow-period', direction: 'higher_is_better',
    ast: { kind: 'subtract', left: operand('operating_cash_flow'), right: operand('capital_expenditure') },
  },
  {
    formulaId: 'burn_multiple', version: '1',
    operands: [money('net_cash_burn', 'flow')],
    outputUnit: { kind: 'multiple' }, outputNumericDomain: 'decimal',
    periodRule: 'same-flow-period', direction: 'lower_is_better',
    ast: { kind: 'divide', numerator: operand('net_cash_burn'), denominator: { kind: 'formula-ref', formulaId: 'net_new_arr', version: '1' }, rule: 'positive' },
  },
  {
    formulaId: 'cac_payback_months', version: '1',
    operands: [
      { operandId: 'customer_acquisition_cost', metricId: 'customer_acquisition_cost', expectedUnit: CUSTOMER_MONEY, periodRole: 'flow', numericDomain: 'decimal', nonNegative: true },
      { operandId: 'monthly_gross_profit_per_new_customer', metricId: 'monthly_gross_profit_per_new_customer', expectedUnit: MONTHLY_CUSTOMER_MONEY, periodRole: 'representative-month', numericDomain: 'decimal' },
    ],
    outputUnit: { kind: 'duration', durationUnit: 'months' },
    periodRule: 'same-flow-period', direction: 'lower_is_better',
    ast: divide(operand('customer_acquisition_cost'), operand('monthly_gross_profit_per_new_customer')),
  },
  {
    formulaId: 'cash_runway_months', version: '1',
    operands: [
      money('cash_balance', 'as-of', { nonNegative: true }),
      money('monthly_net_cash_burn', 'representative-month'),
    ],
    outputUnit: { kind: 'duration', durationUnit: 'months' },
    periodRule: 'mixed-stock-flow', direction: 'higher_is_better',
    ast: divide(operand('cash_balance'), operand('monthly_net_cash_burn')),
  },
  {
    formulaId: 'revenue_cagr', version: '1',
    operands: [money('beginning_revenue', 'as-of-begin'), money('ending_revenue', 'as-of-end', { nonNegative: true })],
    outputUnit: { kind: 'ratio', rateKind: 'signed-rate' },
    periodRule: 'ordered-as-of-endpoints', direction: 'higher_is_better',
    ast: {
      kind: 'subtract',
      left: {
        kind: 'power',
        base: divide(operand('ending_revenue'), operand('beginning_revenue')),
        exponent: divide(literal('1'), operand('__duration_years')),
      },
      right: literal('1'),
    },
  },
  {
    formulaId: 'customer_concentration', version: '1',
    operands: [
      money('concentrated_customer_revenue', 'flow', { nonNegative: true, notGreaterThanOperand: 'total_revenue' }),
      money('total_revenue', 'flow'),
    ],
    outputUnit: { kind: 'ratio', rateKind: 'unit-interval' },
    periodRule: 'same-flow-period', direction: 'lower_is_better',
    ast: divide(operand('concentrated_customer_revenue'), operand('total_revenue')),
  },
  {
    formulaId: 'repeat_purchase_rate', version: '1',
    operands: [
      { operandId: 'repeat_customers', metricId: 'repeat_customers', expectedUnit: CUSTOMER_COUNT, periodRole: 'flow', numericDomain: 'decimal', nonNegative: true, notGreaterThanOperand: 'eligible_customers' },
      { operandId: 'eligible_customers', metricId: 'eligible_customers', expectedUnit: CUSTOMER_COUNT, periodRole: 'flow', numericDomain: 'decimal' },
    ],
    outputUnit: { kind: 'ratio', rateKind: 'unit-interval' },
    periodRule: 'same-flow-period', direction: 'higher_is_better',
    ast: divide(operand('repeat_customers'), operand('eligible_customers')),
  },
  {
    formulaId: 'nrr', version: '1',
    constraints: [{
      kind: 'sum-lte-sum',
      left: ['contraction_revenue', 'churned_revenue'],
      right: ['opening_recurring_revenue', 'expansion_revenue'],
    }],
    operands: [
      money('opening_recurring_revenue', 'as-of-begin'),
      money('expansion_revenue', 'flow', { nonNegative: true }),
      money('contraction_revenue', 'flow', { nonNegative: true }),
      money('churned_revenue', 'flow', { nonNegative: true }),
    ],
    outputUnit: { kind: 'ratio', rateKind: 'non-negative-rate' },
    periodRule: 'mixed-stock-flow', direction: 'higher_is_better',
    ast: divide({
      kind: 'subtract',
      left: {
        kind: 'subtract',
        left: { kind: 'add', values: [operand('opening_recurring_revenue'), operand('expansion_revenue')] },
        right: operand('contraction_revenue'),
      },
      right: operand('churned_revenue'),
    }, operand('opening_recurring_revenue')),
  },
  {
    formulaId: 'ltv_cac', version: '1',
    operands: [
      { operandId: 'customer_lifetime_value', metricId: 'customer_lifetime_value', expectedUnit: CUSTOMER_MONEY, periodRole: 'as-of', numericDomain: 'decimal', nonNegative: true },
      { operandId: 'customer_acquisition_cost', metricId: 'customer_acquisition_cost', expectedUnit: CUSTOMER_MONEY, periodRole: 'as-of', numericDomain: 'decimal' },
    ],
    outputUnit: { kind: 'multiple' }, periodRule: 'same-as-of', direction: 'higher_is_better',
    ast: divide(operand('customer_lifetime_value'), operand('customer_acquisition_cost')),
  },
  {
    formulaId: 'inventory_turnover_days', version: '1',
    operands: [
      money('beginning_inventory', 'as-of-begin', { nonNegative: true }),
      money('ending_inventory', 'as-of-end', { nonNegative: true }),
      money('cost_of_goods_sold', 'flow'),
    ],
    outputUnit: { kind: 'duration', durationUnit: 'days' },
    periodRule: 'mixed-stock-flow', direction: 'lower_is_better',
    ast: {
      kind: 'multiply',
      values: [
        divide({
          kind: 'divide',
          numerator: { kind: 'add', values: [operand('beginning_inventory'), operand('ending_inventory')] },
          denominator: literal('2'),
          rule: 'positive',
        }, operand('cost_of_goods_sold')),
        operand('__period_days'),
      ],
    },
  },
  {
    formulaId: 'net_new_arr', version: '1',
    operands: [money('beginning_arr', 'as-of-begin', { nonNegative: true }), money('ending_arr', 'as-of-end', { nonNegative: true })],
    outputUnit: CNY, periodRule: 'ordered-as-of-endpoints', direction: 'higher_is_better',
    ast: { kind: 'subtract', left: operand('ending_arr'), right: operand('beginning_arr') },
  },
]);
```

单位中的 `CNY` 是注册表占位币种类别，注册验证和运行验证必须比较 unit kind/count/rate/time 结构，并把 currency 视为“必须相同但值由输入决定”；输出 currency 从输入继承，不把 CNY 写死到结果。

`formula-registry.ts` 必须：

1. 以 `FORMULA_IDS` 为唯一稳定顺序；
2. 注册时遍历 AST，只允许八种节点；
3. 校验 operand 引用存在，`__duration_years` 与 `__period_days` 只允许出现在对应期间策略；
4. 校验 formula-ref 指向已注册的 formulaId/version；
5. 校验 `burn_multiple@1 → net_new_arr@1` 是唯一 v1 公式依赖；
6. 对 AST 做单位维度推导：currency、各 countKind、month/day 使用整数指数；literal 和 ratio/multiple 为无量纲；add/subtract 两侧维度必须相同，multiply 指数相加，divide 指数相减，power 的底数和指数必须无量纲；`__period_days` 是 day，CAC 的 currency/customer 除以 currency/customer/month 得 month；推导结果必须与 outputUnit 维度一致；
7. 导出 `validateFormulaDefinitions` 供损坏注册表负测，任何节点、引用或单位代数错误都抛 `DomainContractError('invalid_formula_definition', ...)`；
8. `resolveFormulaDefinition` 对未知 ID 抛 `unknown_formula`，对已知 ID + 未注册 version 返回 `unsupported` 判别结果。

- [ ] **Step 4: 运行聚焦测试并确认 GREEN**

Run: `npm test -- src/engines/formulas/formula-registry.test.ts`

Expected: PASS，13 个 ID、独立 version、AST 白名单、formula-ref 和错误边界全部通过。

- [ ] **Step 5: 提交**

```bash
git add app/src/engines/formulas/formula-types.ts app/src/engines/formulas/formula-definitions.ts app/src/engines/formulas/formula-registry.ts app/src/engines/formulas/formula-registry.test.ts
git commit -m "feat: register versioned restricted formula definitions"
```

### Task 5: 版本化输入快照与结构/数值/单位/币种/期间验证

**Files:**
- Create: `app/src/engines/formulas/formula-test-fixtures.ts`
- Create: `app/src/engines/formulas/validate-formula-inputs.ts`
- Test: `app/src/engines/formulas/validate-formula-inputs.test.ts`

- [ ] **Step 1: 写入失败测试**

`formula-test-fixtures.ts` 创建明确的 flow/as-of 输入：

```ts
import type { AnalysisUnit } from '../../domain/analysis/value';
import type { FormulaObservation } from './formula-types';

export const FY2025 = Object.freeze({
  kind: 'flow' as const, id: 'FY2025', startDate: '2025-01-01',
  endDate: '2025-12-31', durationMonths: 12, granularity: 'year' as const,
});
export const JAN2025 = Object.freeze({
  kind: 'flow' as const, id: '2025-01', startDate: '2025-01-01',
  endDate: '2025-01-31', durationMonths: 1, granularity: 'month' as const,
});
export const FY2025_BEGIN = Object.freeze({ kind: 'as-of' as const, id: 'FY2025-begin', date: '2024-12-31' });
export const FY2025_END = Object.freeze({ kind: 'as-of' as const, id: 'FY2025-end', date: '2025-12-31' });

export const currencyUnit = (currency: import('../../domain/analysis/value').CurrencyCode = 'CNY') =>
  ({ kind: 'currency', currency } as const satisfies AnalysisUnit);
export const customerMoneyUnit = (perPeriod?: 'month' | 'year') =>
  ({ kind: 'currency-per-count', currency: 'CNY', countKind: 'customer', ...(perPeriod ? { perPeriod } : {}) } as const satisfies AnalysisUnit);
export const customerCountUnit = () =>
  ({ kind: 'count', countKind: 'customer' } as const satisfies AnalysisUnit);

export function observation(
  metricId: string,
  value: string,
  unit: AnalysisUnit = currencyUnit(),
  period = FY2025,
  overrides: Partial<FormulaObservation> = {},
): FormulaObservation {
  return {
    valueRef: metricId + ':' + period.id,
    metricId,
    value: { value, unit },
    period,
    sourceRefs: ['evidence:' + metricId],
    conflict: { status: 'none' },
    ...overrides,
  };
}
```

`validate-formula-inputs.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { getFormulaDefinition } from './formula-registry';
import {
  currencyUnit,
  customerMoneyUnit,
  FY2025,
  FY2025_BEGIN,
  FY2025_END,
  observation,
} from './formula-test-fixtures';
import { validateFormulaInputs } from './validate-formula-inputs';

describe('validateFormulaInputs', () => {
  const definition = getFormulaDefinition('gross_margin', '1');

  it('returns inputs in definition order and keeps value/source references', () => {
    const result = validateFormulaInputs(definition, [
      observation('cost_of_goods_sold', '40'),
      observation('revenue', '100'),
    ]);
    expect(result).toMatchObject({ status: 'valid' });
    if (result.status === 'valid') {
      expect(result.inputs.map((item) => item.spec.operandId)).toEqual(['revenue', 'cost_of_goods_sold']);
      expect(result.inputs[0].observation.sourceRefs).toEqual(['evidence:revenue']);
    }
  });

  it.each([
    [[observation('revenue', '100')], 'missing_input', 'insufficient-data'],
    [[observation('revenue', 'abc'), observation('cost_of_goods_sold', '40')], 'invalid_decimal', 'invalid-input'],
    [[observation('revenue', '100'), observation('cost_of_goods_sold', '40', { kind: 'count', countKind: 'unit' })], 'unit_mismatch', 'invalid-input'],
    [[observation('revenue', '100'), observation('cost_of_goods_sold', '40', currencyUnit('USD'))], 'currency_mismatch', 'invalid-input'],
    [[observation('revenue', '100'), { ...observation('cost_of_goods_sold', '40'), period: { ...FY2025, id: 'other' } }], 'period_mismatch', 'invalid-input'],
  ] as const)('returns %s without throwing', (observations, code, reason) => {
    expect(validateFormulaInputs(definition, observations)).toMatchObject({
      status: 'blocked', reason, issue: { code },
    });
  });


  it.each([
    [[observation('revenue', 'abc', { kind: 'count', countKind: 'unit' })], 'missing_input'],
    [[
      observation('revenue', 'abc', { kind: 'count', countKind: 'unit' }),
      { ...observation('cost_of_goods_sold', '40', currencyUnit('USD')), period: { ...FY2025, id: 'other' } },
    ], 'invalid_decimal'],
    [[
      observation('revenue', '100'),
      { ...observation('cost_of_goods_sold', '40', { kind: 'count', countKind: 'unit' }), period: { ...FY2025, id: 'other' } },
    ], 'unit_mismatch'],
    [[
      observation('revenue', '100'),
      { ...observation('cost_of_goods_sold', '40', currencyUnit('USD')), period: { ...FY2025, id: 'other' } },
    ], 'currency_mismatch'],
  ] as const)('applies the fixed validation priority before denominator checks', (observations, code) => {
    expect(validateFormulaInputs(definition, observations)).toMatchObject({
      status: 'blocked',
      issue: { code },
    });
  });
  it.each([
    ['cac_payback_months', [
      observation('customer_acquisition_cost', '1000', customerMoneyUnit(), FY2025),
      observation('monthly_gross_profit_per_new_customer', '100', customerMoneyUnit('month'), FY2025),
    ]],
    ['revenue_cagr', [
      observation('beginning_revenue', '100', currencyUnit(), FY2025_END),
      observation('ending_revenue', '120', currencyUnit(), FY2025_BEGIN),
    ]],
    ['inventory_turnover_days', [
      observation('beginning_inventory', '100', currencyUnit(), FY2025_BEGIN),
      observation('ending_inventory', '120', currencyUnit(), { kind: 'as-of', id: 'wrong-end', date: '2024-12-31' }),
      observation('cost_of_goods_sold', '500', currencyUnit(), FY2025),
    ]],
  ] as const)('rejects invalid representative/endpoint period for %s', (formulaId, observations) => {
    expect(validateFormulaInputs(getFormulaDefinition(formulaId, '1'), observations)).toMatchObject({
      status: 'blocked', reason: 'invalid-input', issue: { code: 'period_mismatch' },
    });
  });

  it('returns unresolved_conflict warning for conservative-selected', () => {
    expect(validateFormulaInputs(definition, [
      observation('revenue', '100', currencyUnit(), FY2025, {
        conflict: { status: 'conservative-selected', selectionReason: 'lower audited value' },
      }),
      observation('cost_of_goods_sold', '40'),
    ])).toMatchObject({
      status: 'valid',
      warnings: [{ code: 'unresolved_conflict', details: { selectionReason: 'lower audited value' } }],
    });
  });

  it('blocks a blocking conflict', () => {
    expect(validateFormulaInputs(definition, [
      observation('revenue', '100', currencyUnit(), FY2025, { conflict: { status: 'blocking' } }),
      observation('cost_of_goods_sold', '40'),
    ])).toMatchObject({
      status: 'blocked', reason: 'invalid-input', issue: { code: 'unresolved_conflict' },
    });
  });

  it('throws invalid_dto when a required DTO field has the wrong type', () => {
    expect(() => validateFormulaInputs(definition, [{
      ...observation('revenue', '100'),
      valueRef: 42,
    } as never])).toThrowError(expect.objectContaining({ code: 'invalid_dto' }));
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- src/engines/formulas/validate-formula-inputs.test.ts`

Expected: FAIL，验证模块不存在。

- [ ] **Step 3: 写入最小实现**

`validate-formula-inputs.ts` 返回：

```ts
export type FormulaInputValidation =
  | {
      readonly status: 'valid';
      readonly inputs: readonly ValidatedFormulaInput[];
      readonly warnings: readonly EngineIssue[];
      readonly derivedOperands: Readonly<Record<string, string>>;
      readonly currency?: import('../../domain/analysis/value').CurrencyCode;
      readonly effectivePeriod: import('./formula-types').CalculationPeriod;
      readonly periodRefs: readonly string[];
    }
  | {
      readonly status: 'blocked';
      readonly reason: 'insufficient-data' | 'invalid-input' | 'not-meaningful';
      readonly issue: EngineIssue;
    };
```

为跨公式统一优先级，验证模块同时导出分阶段扫描接口：

```ts
export type FormulaValidationStage = 'missing' | 'decimal-range' | 'unit-currency-period';
export function validateFormulaInputStage(
  definition: FormulaDefinition,
  observations: readonly FormulaObservation[],
  stage: FormulaValidationStage,
): FormulaInputValidation | { readonly status: 'continue' };
```

`validateFormulaInputs` 仍按三个 stage 顺序组合该接口；evaluation session 可先对整个依赖闭包逐 stage 扫描，再执行任何 AST。
实现顺序固定；校验 pass 不得交错：missing_input → invalid_decimal/value_out_of_range → unit_mismatch/currency_mismatch/period_mismatch → division_by_zero/non_positive_denominator：

1. 先检查 observation、valueRef、metricId、sourceRefs、conflict、period、MetricValue 的结构；字段缺失或非预期类型抛 `DomainContractError('invalid_dto', ...)`。
2. 按 definition.operands 顺序完成缺失扫描；缺失返回 missing_input 且优先于所有其他 issue；同一 metricId 重复输入抛 invalid_dto。
3. 对全部 string 数值执行十进制格式扫描；格式错误返回 invalid_decimal。随后执行字段和交叉字段值域扫描；越界返回 value_out_of_range。
4. 只有缺失、十进制和值域扫描全部通过后，才比较 unit、currency 和 period。
5. countKind 不同必须返回 `unit_mismatch`，不得因为都属于 count 而接受。
6. `conservative-selected` 必须带非空 selectionReason，成功验证时产生 `unresolved_conflict` warning；`blocking` 返回 `invalid-input + unresolved_conflict`。
7. 期间策略：
   - `same-flow-period`：全部为完全相同的 FlowPeriod；
   - `same-as-of`：全部为完全相同的 AsOfPeriod；
   - `ordered-as-of-endpoints`：begin/end 为 AsOfPeriod，begin.date < end.date；
   - `mixed-stock-flow`：as-of 与 flow 角色匹配，所有 flow 完全相同，begin 在 flow 开始前，end 等于 flow 结束日；
   - monthly representative 输入必须是 durationMonths=1 的月度 FlowPeriod。
8. valid 结果必须带 `effectivePeriod`：same-as-of 使用 AsOfPeriod；same-flow/mixed 把 flow 的日期边界规范化为 `EffectivePeriodSpan`；ordered endpoints 派生从 begin 次日至 end 的 `EffectivePeriodSpan`。span 可覆盖任意正的连续月份，不复用只允许 1/12 个月的 FlowPeriod；同时收集所有 currency 单位，唯一币种写入 `currency`，多币种在此之前已返回 currency_mismatch。
9. `revenue_cagr` 从端点实际月份差生成 `__duration_years = months / 12`，期限不正返回 `period_mismatch`。
10. `inventory_turnover_days` 从 flow 首尾含端点计算公历天数，生成 `__period_days`。
11. nonNegative、notGreaterThanOperand 和 constraints 在十进制扫描后、单位扫描前执行；失败返回 blocked/invalid-input + value_out_of_range。NRR 强制 contraction_revenue + churned_revenue <= opening_recurring_revenue + expansion_revenue。分母零/负值留给 AST 映射。
12. periodRefs、warnings 和 inputs 使用定义顺序；sourceRefs 复制后字典序排序；不修改调用方数据。

- [ ] **Step 4: 运行聚焦测试并确认 GREEN**

Run: `npm test -- src/engines/formulas/validate-formula-inputs.test.ts`

Expected: PASS，结构/数值分层、单位、countKind、币种、冲突、期间和引用保留全部通过。

- [ ] **Step 5: 提交**

```bash
git add app/src/engines/formulas/formula-test-fixtures.ts app/src/engines/formulas/validate-formula-inputs.ts app/src/engines/formulas/validate-formula-inputs.test.ts
git commit -m "feat: validate versioned formula input snapshots"
```

### Task 6: 受限 AST 求值和稳定分母诊断

**Files:**
- Create: `app/src/engines/formulas/evaluate-ast.ts`
- Test: `app/src/engines/formulas/evaluate-ast.test.ts`

- [ ] **Step 1: 写入失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { AnalysisDecimal } from '../../domain/analysis/decimal';
import { evaluateAst } from './evaluate-ast';

const operands = new Map([
  ['a', new AnalysisDecimal('10')],
  ['b', new AnalysisDecimal('4')],
]);

describe('evaluateAst', () => {
  it('evaluates the approved data nodes and records post-order steps', () => {
    const result = evaluateAst({
      kind: 'multiply',
      values: [
        { kind: 'subtract', left: { kind: 'operand', operandId: 'a' }, right: { kind: 'operand', operandId: 'b' } },
        { kind: 'literal', value: '2' },
      ],
    }, operands, new Map());
    expect(result).toMatchObject({ status: 'ok', value: '12' });
    if (result.status === 'ok') {
      expect(result.steps.map((step) => step.id)).toEqual(['subtract:1', 'multiply:2']);
    }
  });

  it('reads a computed formula-ref from the dependency map', () => {
    expect(evaluateAst(
      { kind: 'formula-ref', formulaId: 'net_new_arr', version: '1' },
      new Map(),
      new Map([['net_new_arr@1', new AnalysisDecimal('50')]]),
    )).toMatchObject({ status: 'ok', value: '50' });
  });

  it.each([
    ['0', 'division_by_zero'],
    ['-1', 'non_positive_denominator'],
  ] as const)('blocks denominator %s with %s', (denominator, code) => {
    expect(evaluateAst({
      kind: 'divide',
      numerator: { kind: 'literal', value: '1' },
      denominator: { kind: 'literal', value: denominator },
      rule: 'positive',
    }, new Map(), new Map())).toMatchObject({
      status: 'blocked', issue: { code },
    });
  });

  it('supports fractional powers without converting through number', () => {
    expect(evaluateAst({
      kind: 'power',
      base: { kind: 'literal', value: '4' },
      exponent: { kind: 'literal', value: '0.5' },
    }, new Map(), new Map())).toMatchObject({ status: 'ok', value: '2' });
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- src/engines/formulas/evaluate-ast.test.ts`

Expected: FAIL，AST 求值模块不存在。

- [ ] **Step 3: 写入最小实现**

`evaluate-ast.ts` 的公开返回类型：

```ts
export type AstEvaluation =
  | { readonly status: 'ok'; readonly value: string; readonly steps: readonly TraceStep[] }
  | { readonly status: 'blocked'; readonly issue: EngineIssue; readonly steps: readonly TraceStep[] };
```

实现必须：

- 仅处理 `literal`、`operand`、`formula-ref`、`add`、`subtract`、`multiply`、`divide`、`power`。
- literal 调用 `parseDecimalString`；注册表已保证 literal 规范，失败代表注册表损坏并抛 `DomainContractError('invalid_formula_definition', ...)`。
- operand 从 `ReadonlyMap<string, Decimal>` 读取；formula-ref 用 `formulaId + '@' + version` 从依赖 Map 读取。
- 缺失 operand/formula-ref 表示注册表或执行器内部错误，抛 `invalid_formula_definition`，不伪装为业务缺数。
- `divide` 先检查零并返回 `division_by_zero`，再检查负数并返回 `non_positive_denominator`。
- 所有算术使用 AnalysisDecimal；输出使用 `canonicalDecimal`。
- 用局部计数器生成后序 `operator:n`，不读取全局状态。
- blocked step 写 `rule` 和 `outcome: 'blocked'`，不得写 result。

核心 divide 分支：

```ts
if (node.kind === 'divide') {
  const denominator = childValues[1];
  if (denominator.isZero()) {
    const issue = {
      code: 'division_by_zero' as const,
      path: 'divide:' + String(sequence + 1),
      message: 'Formula denominator is zero.',
      details: { rule: node.rule },
    };
    steps.push({
      id: 'divide:' + String(++sequence),
      operator: 'divide',
      operands: childValues.map(canonicalDecimal),
      rule: node.rule,
      outcome: 'blocked',
    });
    return issue;
  }
  if (denominator.isNegative()) {
    const issue = {
      code: 'non_positive_denominator' as const,
      path: 'divide:' + String(sequence + 1),
      message: 'Formula denominator must be positive.',
      details: { rule: node.rule },
    };
    steps.push({
      id: 'divide:' + String(++sequence),
      operator: 'divide',
      operands: childValues.map(canonicalDecimal),
      rule: node.rule,
      outcome: 'blocked',
    });
    return issue;
  }
}
```

- [ ] **Step 4: 运行聚焦测试并确认 GREEN**

Run: `npm test -- src/engines/formulas/evaluate-ast.test.ts`

Expected: PASS，AST 白名单、formula-ref、后序 trace、零/负分母和幂运算通过。

- [ ] **Step 5: 提交**

```bash
git add app/src/engines/formulas/evaluate-ast.ts app/src/engines/formulas/evaluate-ast.test.ts
git commit -m "feat: evaluate restricted formula ast"
```

### Task 7: evaluateMetric 与 13 项业务语义

**Files:**
- Create: `app/src/engines/formulas/evaluate-metric.ts`
- Modify: `app/src/engines/formulas/formula-test-fixtures.ts`
- Test: `app/src/engines/formulas/evaluate-metric.test.ts`
- Test: `app/src/engines/formulas/formula-golden-vectors.test.ts`

- [ ] **Step 1: 写入失败测试**

先创建下方 `evaluate-metric.test.ts`；同一个 RED 步骤还必须完整写入本计划 Task 9 Step 1 中给出的 `expectOkValue` fixture 和 `formula-golden-vectors.test.ts` 代码块。Task 9 的代码块是本步骤的完整测试附录，不得等生产实现完成后再写。

```ts
import { describe, expect, it } from 'vitest';
import {
  currencyUnit,
  customerCountUnit,
  customerMoneyUnit,
  FY2025,
  FY2025_BEGIN,
  FY2025_END,
  JAN2025,
  observation,
} from './formula-test-fixtures';
import { evaluateMetric } from './evaluate-metric';

describe('evaluateMetric', () => {
  it.each([
    ['gross_margin', [
      observation('revenue', '100'), observation('cost_of_goods_sold', '40'),
    ], '0.6', { kind: 'ratio', rateKind: 'signed-rate' }],
    ['gross_margin', [
      observation('revenue', '100'), observation('cost_of_goods_sold', '-20'),
    ], '1.2', { kind: 'ratio', rateKind: 'signed-rate' }],
    ['ebitda_margin', [
      observation('ebitda', '-10'), observation('revenue', '100'),
    ], '-0.1', { kind: 'ratio', rateKind: 'signed-rate' }],
    ['free_cash_flow', [
      observation('operating_cash_flow', '50'), observation('capital_expenditure', '12'),
    ], '38', { kind: 'currency', currency: 'CNY' }],
    ['cac_payback_months', [
      observation('customer_acquisition_cost', '1200', customerMoneyUnit(), JAN2025),
      observation('monthly_gross_profit_per_new_customer', '200', customerMoneyUnit('month'), JAN2025),
    ], '6', { kind: 'duration', durationUnit: 'months' }],
    ['customer_concentration', [
      observation('concentrated_customer_revenue', '25'), observation('total_revenue', '100'),
    ], '0.25', { kind: 'ratio', rateKind: 'unit-interval' }],
    ['repeat_purchase_rate', [
      observation('repeat_customers', '30', customerCountUnit()),
      observation('eligible_customers', '100', customerCountUnit()),
    ], '0.3', { kind: 'ratio', rateKind: 'unit-interval' }],
  ] as const)('evaluates %s@1', (formulaId, observations, value, unit) => {
    expect(evaluateMetric({ formulaId, version: '1', observations })).toMatchObject({
      status: 'ok',
      value: { formulaId, version: '1', value: { value, unit } },
      trace: { formulaRef: formulaId + '@1' },
    });
  });

  it('resolves burn_multiple through net_new_arr@1', () => {
    expect(evaluateMetric({
      formulaId: 'burn_multiple',
      version: '1',
      observations: [
        observation('net_cash_burn', '80'),
        observation('beginning_arr', '100', undefined, FY2025_BEGIN),
        observation('ending_arr', '180', undefined, FY2025_END),
      ],
    })).toMatchObject({
      status: 'ok',
      value: { value: { value: '1', unit: { kind: 'multiple' } } },
    });
  });

  it('allows a negative Burn Multiple for a cash-generative company', () => {
    expect(evaluateMetric({
      formulaId: 'burn_multiple', version: '1',
      observations: [
        observation('net_cash_burn', '-20'),
        observation('beginning_arr', '100', undefined, FY2025_BEGIN),
        observation('ending_arr', '150', undefined, FY2025_END),
      ],
    })).toMatchObject({ status: 'ok', value: { value: { value: '-0.4' } } });
  });

  it.each([
    ['currency_mismatch', [
      observation('net_cash_burn', '20', currencyUnit('CNY')),
      observation('beginning_arr', '100', currencyUnit('USD'), FY2025_BEGIN),
      observation('ending_arr', '150', currencyUnit('USD'), FY2025_END),
    ]],
    ['period_mismatch', [
      observation('net_cash_burn', '20', currencyUnit('CNY'), FY2025),
      observation('beginning_arr', '100', currencyUnit('CNY'), { kind: 'as-of', id: 'FY2024-begin', date: '2023-12-31' }),
      observation('ending_arr', '150', currencyUnit('CNY'), { kind: 'as-of', id: 'FY2024-end', date: '2024-12-31' }),
    ]],
  ] as const)('validates formula-ref metadata with %s', (code, observations) => {
    expect(evaluateMetric({ formulaId: 'burn_multiple', version: '1', observations })).toMatchObject({
      status: 'blocked', reason: 'invalid-input', issues: [{ code }],
    });
  });

  it('returns unsupported_formula for a known ID at version 2', () => {
    expect(evaluateMetric({
      formulaId: 'gross_margin', version: '2', observations: [],
    })).toMatchObject({
      status: 'blocked', reason: 'invalid-input', issues: [{ code: 'unsupported_formula' }],
    });
  });

  it('throws unknown_formula for an unknown public ID', () => {
    expect(() => evaluateMetric({
      formulaId: 'made_up', version: '1', observations: [],
    })).toThrowError(expect.objectContaining({ code: 'unknown_formula' }));
  });

  it.each([
    null,
    { formulaId: 1, version: '1', observations: [] },
    { formulaId: 'gross_margin', version: 1, observations: [] },
    { formulaId: 'gross_margin', version: '1', observations: null },
  ])('throws invalid_dto for damaged metric request %#', (input) => {
    expect(() => evaluateMetric(input as never)).toThrowError(
      expect.objectContaining({ code: 'invalid_dto' }),
    );
  });

  it.each([
    ['gross_margin', [observation('revenue', '0'), observation('cost_of_goods_sold', '0')], 'division_by_zero'],
    ['burn_multiple', [
      observation('net_cash_burn', '80'),
      observation('beginning_arr', '100', undefined, FY2025_BEGIN),
      observation('ending_arr', '100', undefined, FY2025_END),
    ], 'division_by_zero'],
    ['burn_multiple', [
      observation('net_cash_burn', '80'),
      observation('beginning_arr', '100', undefined, FY2025_BEGIN),
      observation('ending_arr', '90', undefined, FY2025_END),
    ], 'non_positive_denominator'],
    ['cac_payback_months', [
      observation('customer_acquisition_cost', '1200', customerMoneyUnit(), JAN2025),
      observation('monthly_gross_profit_per_new_customer', '0', customerMoneyUnit('month'), JAN2025),
    ], 'division_by_zero'],
  ] as const)('blocks non-meaningful %s with %s', (formulaId, observations, code) => {
    expect(evaluateMetric({ formulaId, version: '1', observations })).toMatchObject({
      status: 'blocked', reason: 'not-meaningful', issues: [{ code }],
    });
  });
  it('keeps root missing_input ahead of dependency decimal errors', () => {
    expect(evaluateMetric({
      formulaId: 'burn_multiple',
      version: '1',
      observations: [
        observation('beginning_arr', 'abc', undefined, FY2025_BEGIN),
        observation('ending_arr', '150', undefined, FY2025_END),
      ],
    })).toMatchObject({
      status: 'blocked', reason: 'insufficient-data', issues: [{ code: 'missing_input' }],
    });
  });

});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- src/engines/formulas/evaluate-metric.test.ts src/engines/formulas/formula-golden-vectors.test.ts`

Expected: FAIL，`evaluateMetric` 不存在；13 项黄金向量已在生产实现前进入 RED。

- [ ] **Step 3: 写入最小实现**

`evaluate-metric.ts` 导出供单公式和图共同使用的 evaluation session；它是受控引擎内部接口，不进入 UI 或持久层：

```ts
export type FormulaSuccess = Extract<EngineResult<MetricCalculation>, { readonly status: 'ok' }>;
export interface FormulaEvaluationSession {
  evaluate(formulaId: string, version: string): EngineResult<MetricCalculation>;
  completedResults(): readonly FormulaSuccess[];
}
export function createFormulaEvaluationSession(observations: unknown): FormulaEvaluationSession;
export function evaluateMetric(input: MetricEvaluationInput): EngineResult<MetricCalculation>;
```

实现顺序：

1. `evaluateMetric` 先把 input 当作 unknown 解析：必须是 object，formulaId/version 必须是 string，observations 必须是 array；否则抛 `DomainContractError('invalid_dto')`。`createFormulaEvaluationSession` 也独立验证 observations 是 array，再深快照 value/unit/period/sourceRefs，创建 result cache、validated cache、完成顺序和 visiting stack。
2. evaluate 先 resolve 根定义并仅遍历 AST 引用收集完整 dependency closure，不执行 Decimal 算术；unknown/unsupported 和循环在此阶段稳定处理。
3. 对 closure 按 root-first、其余依赖按注册表顺序执行全局分阶段预检：先对所有节点跑 `missing`，再跑 `decimal-range`，最后跑 `unit-currency-period`。任一阶段命中即返回该阶段首个 issue；因此根缺 `net_cash_burn` 时不会被 ARR 的 invalid_decimal 抢先。
4. 预检全绿后才递归求值。每个 `formulaId@version` 先查 result cache；首次完成时写入 cache 和 dependency-first completion order，后续根或依赖复用同一结果，不重复计算。
5. 对每个 dependency calculation 比较 metadata：currency/currency-per-count 必须与当前 validated.currency 相同；dependency.period 与 validated.effectivePeriod 按 kind、日期边界和 durationMonths 比较。失败返回 currency_mismatch 或 period_mismatch。
6. 验证通过后把 dependency.value.value 转成 Decimal formula-ref Map，与 inputs/derivedOperands 一起交给 `evaluateAst`；AST 分母错误返回 `not-meaningful`。
7. output numeric domain 优先使用 definition.outputNumericDomain，否则由 outputUnit 推导；unit-interval 超界、non-negative-rate/multiple 为负返回 value_out_of_range；Burn Multiple 的 decimal domain 允许负值。
8. currency 输出继承唯一输入币种；缺失时抛 invalid_formula_definition。结果 trace 合并 dependency trace inputs/steps 与当前输入，按 valueRef 去重并稳定排序；warnings 合并依赖与当前 warning。
9. MetricCalculation 写入 validated.effectivePeriod 和 periodRefs；`completedResults()` 返回完整成功 EngineResult 的 completion-order 冻结副本，使图层可合并每个节点的 warnings、trace inputs/steps，同时确保依赖先于消费者且每节点仅一项。

输出装配代码：

```ts
const traceInputs = stableUniqueByValueRef([
  ...dependencyResults.flatMap((result) => result.trace.inputs),
  ...validated.inputs.map(toTraceInput),
]);
const warnings = stableUniqueIssues([
  ...dependencyResults.flatMap((result) => result.warnings),
  ...validated.warnings,
]);
const inheritedCurrency = validated.currency;
if (
  (definition.outputUnit.kind === 'currency' || definition.outputUnit.kind === 'currency-per-count') &&
  inheritedCurrency === undefined
) {
  throw new DomainContractError('invalid_formula_definition', 'currency output has no input currency');
}
const resultUnit = definition.outputUnit.kind === 'currency'
  ? { kind: 'currency' as const, currency: inheritedCurrency as string }
  : definition.outputUnit.kind === 'currency-per-count'
    ? { ...definition.outputUnit, currency: inheritedCurrency as string }
    : definition.outputUnit;
const metricValue = { value: astResult.value, unit: resultUnit };
const calculation = {
  formulaId: definition.formulaId,
  version: definition.version,
  value: metricValue,
  period: validated.effectivePeriod,
  periodRefs: validated.periodRefs,
  direction: definition.direction,
};
return okResult(calculation, warnings, {
  engine: 'formula',
  formulaRef: definition.formulaId + '@' + definition.version,
  inputs: traceInputs,
  steps: [
    ...dependencySteps,
    ...astResult.steps.map((step) => ({
      ...step,
      id: definition.formulaId + '@' + definition.version + ':' + step.id,
    })),
  ],
  output: metricValue,
});
```

- [ ] **Step 4: 运行聚焦测试并确认 GREEN**

Run: `npm test -- src/engines/formulas/evaluate-metric.test.ts src/engines/formulas/formula-golden-vectors.test.ts src/engines/formulas/evaluate-ast.test.ts src/engines/formulas/validate-formula-inputs.test.ts`

Expected: PASS，公共错误边界、版本、formula-ref、币种继承、warning 和分母语义通过。

- [ ] **Step 5: 提交**

```bash
git add app/src/engines/formulas/formula-test-fixtures.ts app/src/engines/formulas/formula-golden-vectors.test.ts app/src/engines/formulas/evaluate-metric.ts app/src/engines/formulas/evaluate-metric.test.ts
git commit -m "feat: evaluate versioned financial metrics"
```

### Task 8: 依赖图、稳定拓扑计算和循环检测

**Files:**
- Create: `app/src/engines/formulas/evaluate-formula-graph.ts`
- Test: `app/src/engines/formulas/evaluate-formula-graph.test.ts`
- Test: `app/src/engines/formulas/formula-invariants.test.ts`

- [ ] **Step 1: 写入失败测试**

先写本节的图测试；同一个 RED 步骤还必须完整写入 Task 9 Step 2 给出的 `formula-invariants.test.ts` 代码块。该不变量文件在图实现前创建。

```ts
import { describe, expect, it, vi } from 'vitest';
import { FY2025_BEGIN, FY2025_END, observation } from './formula-test-fixtures';
import { evaluateFormulaGraph } from './evaluate-formula-graph';

describe('evaluateFormulaGraph', () => {
  const observations = [
    observation('net_cash_burn', '80'),
    observation('beginning_arr', '100', undefined, FY2025_BEGIN),
    observation('ending_arr', '180', undefined, FY2025_END),
    observation('revenue', '100'),
    observation('cost_of_goods_sold', '40'),
  ];

  it.each([
    null,
    { requests: null, observations: [] },
    { requests: [], observations: null },
    { requests: [{ formulaId: 1, version: '1' }], observations: [] },
  ])('throws invalid_dto for damaged graph request %#', (input) => {
    expect(() => evaluateFormulaGraph(input as never)).toThrowError(
      expect.objectContaining({ code: 'invalid_dto' }),
    );
  });

  it('deduplicates roots and returns dependency-first registry order', () => {
    const result = evaluateFormulaGraph({
      requests: [
        { formulaId: 'burn_multiple', version: '1' },
        { formulaId: 'gross_margin', version: '1' },
        { formulaId: 'net_new_arr', version: '1' },
        { formulaId: 'burn_multiple', version: '1' },
      ],
      observations,
    });
    expect(result).toMatchObject({ status: 'ok' });
    if (result.status === 'ok') {
      expect(result.value.calculations.map((item) => item.formulaId)).toEqual([
        'gross_margin', 'net_new_arr', 'burn_multiple',
      ]);
    }
  });

  it('preserves dependency warnings and provenance in the graph result', () => {
    const result = evaluateFormulaGraph({
      requests: [{ formulaId: 'burn_multiple', version: '1' }],
      observations: [
        observation('net_cash_burn', '80'),
        observation('beginning_arr', '100', undefined, FY2025_BEGIN, {
          sourceRefs: ['evidence:arr-start'],
          conflict: { status: 'conservative-selected', selectionReason: 'lower audited ARR' },
        }),
        observation('ending_arr', '180', undefined, FY2025_END),
      ],
    });
    expect(result).toMatchObject({
      status: 'ok',
      warnings: [{ code: 'unresolved_conflict' }],
      trace: { inputs: expect.arrayContaining([
        expect.objectContaining({ valueRef: 'beginning_arr:FY2025-begin', sourceRefs: ['evidence:arr-start'] }),
      ]) },
    });
  });

  it('is byte-identical for reordered requests and observations', () => {
    const left = evaluateFormulaGraph({
      requests: [{ formulaId: 'gross_margin', version: '1' }, { formulaId: 'burn_multiple', version: '1' }],
      observations,
    });
    const right = evaluateFormulaGraph({
      requests: [{ formulaId: 'burn_multiple', version: '1' }, { formulaId: 'gross_margin', version: '1' }],
      observations: [...observations].reverse(),
    });
    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
  });

  it('returns a normalized circular_dependency path', async () => {
    vi.resetModules();
    vi.doMock('./formula-registry', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./formula-registry')>();
      return {
        ...actual,
        getFormulaDependencies: (formulaId: string) =>
          formulaId === 'gross_margin'
            ? [{ formulaId: 'ebitda_margin', version: '1' }]
            : formulaId === 'ebitda_margin'
              ? [{ formulaId: 'gross_margin', version: '1' }]
              : actual.getFormulaDependencies(formulaId, '1'),
      };
    });
    const { evaluateFormulaGraph: mocked } = await import('./evaluate-formula-graph');
    expect(mocked({
      requests: [{ formulaId: 'gross_margin', version: '1' }],
      observations: [],
    })).toMatchObject({
      status: 'blocked',
      reason: 'invalid-input',
      issues: [{
        code: 'circular_dependency',
        details: { cycle: 'ebitda_margin@1>gross_margin@1>ebitda_margin@1' },
      }],
    });
    vi.doUnmock('./formula-registry');
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- src/engines/formulas/evaluate-formula-graph.test.ts src/engines/formulas/formula-invariants.test.ts`

Expected: FAIL，图求值模块不存在；图顺序和字节确定性测试已先进入 RED。

- [ ] **Step 3: 写入最小实现**

`evaluate-formula-graph.ts`：

- 先把 input 当作 unknown 解析：必须是 object，requests 与 observations 必须是数组，每项 request 的 formulaId/version 必须是 string；任何损坏都抛 `DomainContractError('invalid_dto')`。observations 的数组及元素结构再由 session/公式验证器统一解析，禁止原生 TypeError。
- 根请求去重后按 `FORMULA_IDS` 索引、再按 version 排序，并对全部 requests 共用一个 `createFormulaEvaluationSession(observations)`。
- 依次调用 `session.evaluate`；unknown/unsupported/blocked 原样返回。session 的 visiting stack 负责循环检测，循环路径旋转到字典序最小 `formulaId@version` 开头并闭合首节点。
- 所有根完成后读取 `session.completedResults()`；calculations 来自每项 result.value，warnings、trace.inputs 和 trace.steps 分别按稳定 key 去重合并。不得再次调用公开 `evaluateMetric`，cache 保证显式请求 net_new_arr 与 burn_multiple 同时出现时 net_new_arr 仍只计算和输出一次。
- completion order 已是稳定拓扑顺序；多个同时可计算节点按注册表顺序，因此等价根顺序产生相同 JSON。
- 图 trace 使用 `formulaRef: 'formula_graph@1'`，step 只记录稳定 calculation 顺序，不复制调用方 observation 顺序。
- 成功和阻塞均通过 result factory deep-freeze。

稳定图 trace：

```ts
const nodeResults = session.completedResults();
const calculations = nodeResults.map((result) => result.value);
const warnings = stableUniqueIssues(nodeResults.flatMap((result) => result.warnings));
const inputs = stableUniqueByValueRef(nodeResults.flatMap((result) => result.trace.inputs));
const nodeSteps = stableUniqueById(nodeResults.flatMap((result) => result.trace.steps));
return okResult({ calculations }, warnings, {
  engine: 'formula',
  formulaRef: 'formula_graph@1',
  inputs,
  steps: [
    ...nodeSteps,
    ...calculations.map((item, index) => ({
      id: 'formula_graph@1:evaluate:' + String(index + 1),
      operator: 'evaluate',
      operands: [item.formulaId + '@' + item.version],
      result: item.value.value,
    })),
  ],
  output: calculations.at(-1)?.value,
});
```

- [ ] **Step 4: 运行聚焦测试并确认 GREEN**

Run: `npm test -- src/engines/formulas/evaluate-formula-graph.test.ts src/engines/formulas/formula-invariants.test.ts src/engines/formulas/evaluate-metric.test.ts`

Expected: PASS，版本化依赖、去重、稳定顺序、字节一致性和规范循环路径通过。

- [ ] **Step 5: 提交**

```bash
git add app/src/engines/formulas/evaluate-formula-graph.ts app/src/engines/formulas/evaluate-formula-graph.test.ts app/src/engines/formulas/formula-invariants.test.ts
git commit -m "feat: evaluate deterministic formula dependency graphs"
```

## Tasks 7–8 Test Appendices（不是独立任务）

**Files:**
- Verify/Modify: `app/src/engines/formulas/formula-test-fixtures.ts`
- Verify/Modify: `app/src/engines/formulas/formula-golden-vectors.test.ts`
- Verify/Modify: `app/src/engines/formulas/formula-invariants.test.ts`
- Modify only if tests prove a gap: formula engine production files

### Appendix A: Task 7 在生产实现前写入的 13 项黄金向量

在 fixture 中增加 `expectOkValue`：

```ts
import type { EngineResult } from '../../domain/analysis/engine-result';
import type { MetricCalculation } from './formula-types';

export function expectOkValue(result: EngineResult<MetricCalculation>): string {
  if (result.status !== 'ok') {
    throw new Error('Expected ok result, received ' + JSON.stringify(result));
  }
  return result.value.value.value;
}
```

`formula-golden-vectors.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { evaluateMetric } from './evaluate-metric';
import {
  customerCountUnit,
  customerMoneyUnit,
  expectOkValue,
  FY2025,
  FY2025_BEGIN,
  FY2025_END,
  JAN2025,
  observation,
} from './formula-test-fixtures';

const vectors = [
  ['gross_margin', [observation('revenue', '100'), observation('cost_of_goods_sold', '120')], '-0.2'],
  ['ebitda_margin', [observation('ebitda', '-12'), observation('revenue', '120')], '-0.1'],
  ['free_cash_flow', [observation('operating_cash_flow', '48.75'), observation('capital_expenditure', '13.25')], '35.5'],
  ['burn_multiple', [
    observation('net_cash_burn', '75'),
    observation('beginning_arr', '200', undefined, FY2025_BEGIN),
    observation('ending_arr', '250', undefined, FY2025_END),
  ], '1.5'],
  ['cac_payback_months', [
    observation('customer_acquisition_cost', '900', customerMoneyUnit(), JAN2025),
    observation('monthly_gross_profit_per_new_customer', '150', customerMoneyUnit('month'), JAN2025),
  ], '6'],
  ['cash_runway_months', [
    observation('cash_balance', '1000', undefined, FY2025_END),
    observation('monthly_net_cash_burn', '80', undefined, {
      kind: 'flow', id: 'representative-month', startDate: '2025-12-01',
      endDate: '2025-12-31', durationMonths: 1, granularity: 'month',
    }),
  ], '12.5'],
  ['revenue_cagr', [
    observation('beginning_revenue', '1000', undefined, { kind: 'as-of', id: 'start', date: '2022-12-31' }),
    observation('ending_revenue', '1728', undefined, { kind: 'as-of', id: 'end', date: '2025-12-31' }),
  ], '0.2'],
  ['customer_concentration', [
    observation('concentrated_customer_revenue', '22'),
    observation('total_revenue', '200'),
  ], '0.11'],
  ['repeat_purchase_rate', [
    observation('repeat_customers', '27', customerCountUnit()),
    observation('eligible_customers', '90', customerCountUnit()),
  ], '0.3'],
  ['nrr', [
    observation('opening_recurring_revenue', '200', undefined, FY2025_BEGIN),
    observation('expansion_revenue', '30'),
    observation('contraction_revenue', '10'),
    observation('churned_revenue', '20'),
  ], '1'],
  ['ltv_cac', [
    observation('customer_lifetime_value', '2500', customerMoneyUnit(), FY2025_END),
    observation('customer_acquisition_cost', '1000', customerMoneyUnit(), FY2025_END),
  ], '2.5'],
  ['inventory_turnover_days', [
    observation('beginning_inventory', '200', undefined, FY2025_BEGIN),
    observation('ending_inventory', '280', undefined, FY2025_END),
    observation('cost_of_goods_sold', '1200', undefined, FY2025),
  ], '73'],
  ['net_new_arr', [
    observation('beginning_arr', '320', undefined, FY2025_BEGIN),
    observation('ending_arr', '450', undefined, FY2025_END),
  ], '130'],
] as const;

describe('formula golden vectors', () => {
  it.each(vectors)('matches hand-calculated %s@1', (formulaId, observations, expected) => {
    expect(expectOkValue(evaluateMetric({ formulaId, version: '1', observations }))).toBe(expected);
  });

  it.each([
    ['gross_margin', [observation('revenue', '0'), observation('cost_of_goods_sold', '0')], 'division_by_zero', 'not-meaningful'],
    ['ebitda_margin', [observation('ebitda', '1'), observation('revenue', '-1')], 'non_positive_denominator', 'not-meaningful'],
    ['customer_concentration', [observation('concentrated_customer_revenue', '101'), observation('total_revenue', '100')], 'value_out_of_range', 'invalid-input'],
    ['repeat_purchase_rate', [
      observation('repeat_customers', '101', customerCountUnit()),
      observation('eligible_customers', '100', customerCountUnit()),
    ], 'value_out_of_range', 'invalid-input'],
    ['nrr', [
      observation('opening_recurring_revenue', '100', undefined, FY2025_BEGIN),
      observation('expansion_revenue', '-1'),
      observation('contraction_revenue', '0'),
      observation('churned_revenue', '0'),
    ], 'value_out_of_range', 'invalid-input'],
    ['nrr', [
      observation('opening_recurring_revenue', '100', undefined, FY2025_BEGIN),
      observation('expansion_revenue', '0'),
      observation('contraction_revenue', '80'),
      observation('churned_revenue', '30'),
    ], 'value_out_of_range', 'invalid-input'],
    ['ltv_cac', [
      observation('customer_lifetime_value', '1000', customerMoneyUnit(), FY2025_END),
      observation('customer_acquisition_cost', '0', customerMoneyUnit(), FY2025_END),
    ], 'division_by_zero', 'not-meaningful'],
  ] as const)('blocks %s invalid vector with %s', (formulaId, observations, code, reason) => {
    expect(evaluateMetric({ formulaId, version: '1', observations })).toMatchObject({
      status: 'blocked',
      reason,
      issues: [{ code }],
    });
  });
});
```

### Appendix B: Task 8 在图实现前写入的不变量测试

`formula-invariants.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../../domain/deep-freeze';
import { evaluateFormulaGraph } from './evaluate-formula-graph';
import { evaluateMetric } from './evaluate-metric';
import { expectOkValue, FY2025_BEGIN, FY2025_END, observation } from './formula-test-fixtures';

describe('formula invariants', () => {
  it('handles huge canonical integers without Infinity or exponent output', () => {
    const huge = '9999999999999999999999999999999999999999';
    const result = evaluateMetric({
      formulaId: 'gross_margin', version: '1',
      observations: [observation('revenue', huge), observation('cost_of_goods_sold', '0')],
    });
    expect(expectOkValue(result)).toBe('1');
    expect(JSON.stringify(result)).not.toMatch(/Infinity|NaN|e\+/);
  });

  it('retains 40-digit Decimal semantics for long fractions', () => {
    expect(expectOkValue(evaluateMetric({
      formulaId: 'ebitda_margin', version: '1',
      observations: [observation('ebitda', '1'), observation('revenue', '3')],
    }))).toBe('0.3333333333333333333333333333333333333333');
  });

  it('does not mutate deeply frozen caller input', () => {
    const observations = deepFreeze([
      observation('revenue', '100', undefined, undefined, { sourceRefs: ['z', 'a'] }),
      observation('cost_of_goods_sold', '40'),
    ]);
    expect(Object.isFrozen(observations[0].sourceRefs)).toBe(true);
    expect(Object.isFrozen(observations[0].value)).toBe(true);
    expect(Object.isFrozen(observations[0].value.unit)).toBe(true);
    expect(Object.isFrozen(observations[0].period)).toBe(true);
    const snapshot = JSON.stringify(observations);
    evaluateMetric({ formulaId: 'gross_margin', version: '1', observations });
    expect(JSON.stringify(observations)).toBe(snapshot);
  });

  it('produces byte-identical JSON for equivalent graph input order', () => {
    const observations = [
      observation('revenue', '100'), observation('cost_of_goods_sold', '40'),
      observation('net_cash_burn', '80'),
      observation('beginning_arr', '100', undefined, FY2025_BEGIN),
      observation('ending_arr', '180', undefined, FY2025_END),
    ];
    const first = evaluateFormulaGraph({
      requests: [{ formulaId: 'gross_margin', version: '1' }, { formulaId: 'burn_multiple', version: '1' }],
      observations,
    });
    const second = evaluateFormulaGraph({
      requests: [{ formulaId: 'burn_multiple', version: '1' }, { formulaId: 'gross_margin', version: '1' }],
      observations: [...observations].reverse(),
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it.each(['gross_margin', 'burn_multiple'] as const)(
    'returns JSON-serializable deeply frozen success for %s',
    (formulaId) => {
      const observations = formulaId === 'gross_margin'
        ? [observation('revenue', '100'), observation('cost_of_goods_sold', '40')]
        : [
            observation('net_cash_burn', '80'),
            observation('beginning_arr', '100', undefined, FY2025_BEGIN),
            observation('ending_arr', '180', undefined, FY2025_END),
          ];
      const result = evaluateMetric({ formulaId, version: '1', observations });
      expect(() => JSON.stringify(result)).not.toThrow();
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.trace)).toBe(true);
      expect(Object.isFrozen(result.trace.steps)).toBe(true);
      if (result.status === 'ok') expect(Object.isFrozen(result.value)).toBe(true);
    },
  );

  it('freezes and serializes blocked results without placeholder numbers', () => {
    const result = evaluateMetric({
      formulaId: 'gross_margin', version: '1',
      observations: [observation('revenue', '0'), observation('cost_of_goods_sold', '0')],
    });
    expect(result).toMatchObject({ status: 'blocked', issues: [{ code: 'division_by_zero' }] });
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.trace.steps)).toBe(true);
  });
});
```

Run: `npm test -- src/engines/formulas/formula-golden-vectors.test.ts src/engines/formulas/formula-invariants.test.ts`

Expected: PASS，因为这些测试已分别在 Task 7/8 的生产实现前经历 RED；若回归失败，只允许修正实现，不得降低手算期望值或删除向量。

### Appendix C: 所属任务的 GREEN 修正约束

允许修改 `formula-definitions.ts`、`validate-formula-inputs.ts`、`evaluate-ast.ts`、`evaluate-metric.ts` 或 `evaluate-formula-graph.ts`，修正时保持：

- 毛利率输出 signed-rate，允许成本高于收入形成负毛利率；公式仍使用 `(revenue - cost_of_goods_sold) / revenue`；
- CAGR 的 duration_years 来自端点月份差，不是公开 number 输入；
- 库存周转天数使用首尾库存平均值和流量期间实际公历天数；
- NRR 输出为 non-negative-rate，允许大于 1，并强制 contraction + churn <= opening + expansion；
- unit-interval 输出不得小于 0 或大于 1，字段或交叉字段越界使用 value_out_of_range；
- Burn Multiple 的 net_new_arr = 0 只能映射 division_by_zero，net_new_arr < 0 只能映射 non_positive_denominator；一般零/负分母规则为 `division_by_zero`，负分母为 `non_positive_denominator`；
- 业务范围失败为 `blocked/not-meaningful`；
- 不使用固定展示位 `toFixed(n)` 截断；
- 不对调用方数组原地排序。

### Appendix D: Tasks 7–8 提交前共同回归

Run: `npm test -- src/engines/formulas`

Expected: PASS，13 项黄金向量、异常矩阵、极值、长小数、确定性、输入不变性、序列化和冻结全部通过。

Run: `npm run typecheck`

Expected: PASS，无 TypeScript 错误。

这些附录不形成独立提交：黄金向量随 Task 7 提交，不变量随 Task 8 提交；任何修正也必须在对应任务的规格/质量审查通过前纳入该任务提交。

### Task 9: 最终验证闸门

**Files:**
- Verify only: `app/src/domain/analysis/**`
- Verify only: `app/src/domain/deep-freeze.test.ts`
- Verify only: `app/src/engines/formulas/**`

- [ ] **Step 1: 运行共享契约聚焦测试**

Run: `npm test -- src/domain/analysis src/domain/deep-freeze.test.ts`

Expected: PASS，Decimal、数值域、MetricValue、期间、Scenario、EngineResult、trace 和 deep-freeze 全部通过。

- [ ] **Step 2: 运行公式引擎聚焦测试**

Run: `npm test -- src/engines/formulas`

Expected: PASS，注册表、输入快照验证、AST、13 项公式、依赖图、黄金向量和不变量测试全部通过。

- [ ] **Step 3: 运行类型检查**

Run: `npm run typecheck`

Expected: PASS，`tsc -b` 退出码为 0。

- [ ] **Step 4: 运行完整质量闸门**

Run: `npm run check`

Expected: PASS，依次通过 typecheck、全量 Vitest 和 oxlint，退出码为 0。

- [ ] **Step 5: 检查范围并提交合法的验证修正**

Run: `git status --short`

Expected: 只出现本计划范围内尚未提交的文件；若输出为空，不创建空提交。若验证阶段产生合法修正：

```bash
git add app/src/domain/analysis app/src/domain/deep-freeze.test.ts app/src/engines/formulas
git commit -m "chore: complete formula engine verification"
```

Expected: 提交后 `git status --short` 为空；不得提交设计规格、UI、数据库、其他阶段引擎或计划文件之外的文档。

## 完成标准

- 40 位 HALF_EVEN 私有 Decimal clone 是公式算术的唯一入口，公共边界只使用规范十进制字符串。
- UnitInterval、NonNegativeRate、SignedRate、ReturnRate 和 Multiple 的取值域明确分离并经过测试。
- MetricValue 是 currency/ratio/multiple/duration/count/currency-per-count 判别联合，币种、countKind、rateKind 和期间不可隐式猜测。
- 每个输入快照保留 valueRef、sourceRefs、冲突状态和选择理由；conservative-selected 产生 warning，blocking 阻塞计算。
- 13 个稳定 formulaId 与 version `1` 分离，trace 使用 `formulaId@version`。
- 注册表只含受限 AST；unknown ID/损坏 DTO 抛 DomainContractError，unsupported version 返回 blocked issue。
- 13 项规范公式、固定错误优先级、单位/币种/期间策略、value_out_of_range、零/负分母和循环依赖均有精确测试。
- 单公式和图结果可 JSON 序列化、深层冻结、不修改输入，并对等价输入产生字节一致 JSON。
- 聚焦测试、typecheck 和 `npm run check` 全部通过。
