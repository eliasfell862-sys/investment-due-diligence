/**
 * Value Bridge / Return Attribution Engine
 *
 * Decomposes total equity return into its drivers:
 * 1. EBITDA Growth — value from operational improvement
 * 2. Multiple Expansion — value from re-rating
 * 3. Debt Paydown — value from deleveraging
 * 4. FCF Generation — cash accumulated during hold
 * 5. Leverage Effect — magnification from debt financing
 *
 * This is the fundamental PE question: "How did we make money?"
 */

// ── Types ──

export interface ValueBridgeInput {
  // Entry
  readonly entryEbitda: number;
  readonly entryEv: number;
  readonly entryNetDebt: number;

  // Exit
  readonly exitEbitda: number;
  readonly exitEv: number;
  readonly exitNetDebt: number;

  // During hold
  readonly cumulativeFCF: number; // total free cash flow generated
  readonly additionalEquity: number; // follow-on investments / equity injections
  readonly dividends: number; // dividends/distributions taken out

  // Holding period
  readonly holdingYears: number;
}

export interface BridgeComponent {
  readonly label: string;
  readonly labelEn: string;
  readonly value: number;
  readonly percentOfTotal: number; // % of total value creation
  readonly description: string;
}

export interface ValueBridgeResult {
  // Entry & Exit equity values
  readonly entryEquityValue: number;
  readonly exitEquityValue: number;
  readonly totalReturn: number;
  readonly totalReturnPercent: number;
  readonly moic: number;
  readonly irr: number;

  // Bridge components (ordered by contribution)
  readonly components: readonly BridgeComponent[];

  // Checks
  readonly sumOfComponents: number;
  readonly unexplained: number;
  readonly explainedPercent: number;
}

// ── Calculation ──

export function calculateValueBridge(input: ValueBridgeInput): ValueBridgeResult {
  const {
    entryEbitda, entryEv, entryNetDebt,
    exitEbitda, exitEv, exitNetDebt,
    cumulativeFCF, additionalEquity, dividends,
    holdingYears,
  } = input;

  // Entry & exit multiples
  const entryMultiple = entryEbitda > 0 ? entryEv / entryEbitda : 0;
  const exitMultiple = exitEbitda > 0 ? exitEv / exitEbitda : 0;

  // Equity values
  const entryEquityValue = entryEv - entryNetDebt;
  const exitEquityValue = exitEv - exitNetDebt;

  // Total return to equity
  const totalGrossReturn = exitEquityValue + dividends - additionalEquity;
  const totalReturn = totalGrossReturn - entryEquityValue;
  const totalReturnPercent = entryEquityValue > 0 ? (totalReturn / entryEquityValue) * 100 : 0;
  const moic = entryEquityValue > 0 ? totalGrossReturn / entryEquityValue : 0;
  const irr = entryEquityValue > 0 ? (Math.pow(totalGrossReturn / entryEquityValue, 1 / Math.max(1, holdingYears)) - 1) * 100 : 0;

  // --- Decomposition ---
  const components: BridgeComponent[] = [];

  // 1. EBITDA Growth: (Exit EBITDA - Entry EBITDA) × Entry Multiple = value from growing earnings
  const ebitdaGrowthValue = (exitEbitda - entryEbitda) * entryMultiple;
  if (Math.abs(ebitdaGrowthValue) > 0.01) {
    const pct = Math.round((ebitdaGrowthValue / Math.max(1, exitEv - entryEv + cumulativeFCF)) * 100);
    components.push({
      label: 'EBITDA 增长',
      labelEn: 'EBITDA Growth',
      value: ebitdaGrowthValue,
      percentOfTotal: pct,
      description: `EBITDA 从 ${fmtNum(entryEbitda)} 增长至 ${fmtNum(exitEbitda)}，放大 ${fmtMultiple(entryMultiple)}x 估值倍数`,
    });
  }

  // 2. Multiple Expansion: Exit EBITDA × (Exit Multiple - Entry Multiple)
  const multipleExpansionValue = exitEbitda * (exitMultiple - entryMultiple);
  if (Math.abs(multipleExpansionValue) > 0.01) {
    const pct = Math.round((multipleExpansionValue / Math.max(1, exitEv - entryEv + cumulativeFCF)) * 100);
    components.push({
      label: '估值倍数变化',
      labelEn: 'Multiple Expansion',
      value: multipleExpansionValue,
      percentOfTotal: pct,
      description: `估值从 ${fmtMultiple(entryMultiple)}x → ${fmtMultiple(exitMultiple)}x${multipleExpansionValue > 0 ? '，倍数扩张贡献正收益' : '，倍数收缩拖累收益'}`,
    });
  }

  // 3. Debt Paydown: Entry Net Debt - Exit Net Debt
  const debtPaydownValue = entryNetDebt - exitNetDebt;
  if (Math.abs(debtPaydownValue) > 0.01) {
    const pct = Math.round((debtPaydownValue / Math.max(1, totalReturn + entryEquityValue)) * 100);
    components.push({
      label: '债务偿还',
      labelEn: 'Debt Paydown',
      value: debtPaydownValue,
      percentOfTotal: pct,
      description: `净债务从 ${fmtNum(entryNetDebt)} 降至 ${fmtNum(exitNetDebt)}，偿还的每一元直接增加股权价值`,
    });
  }

  // 4. FCF Generation: cumulativeFCF - interest paid (approximated by debt paydown gap)
  if (Math.abs(cumulativeFCF) > 0.01) {
    components.push({
      label: '自由现金流积累',
      labelEn: 'FCF Generation',
      value: cumulativeFCF,
      percentOfTotal: Math.round((cumulativeFCF / Math.max(1, totalReturn + entryEquityValue)) * 100),
      description: `持有期内累计产生 ${fmtNum(cumulativeFCF)} 自由现金流，用于偿债或分配`,
    });
  }

  // 5. Net: dividends - additional equity
  const netDistributions = dividends - additionalEquity;
  if (Math.abs(netDistributions) > 0.01) {
    components.push({
      label: netDistributions > 0 ? '分红/分配' : '追加投资',
      labelEn: netDistributions > 0 ? 'Dividends' : 'Additional Equity',
      value: netDistributions,
      percentOfTotal: Math.round(Math.abs(netDistributions) / Math.max(1, totalReturn + entryEquityValue) * 100),
      description: netDistributions > 0 ? `持有期分红 ${fmtNum(dividends)}` : `追加投入 ${fmtNum(additionalEquity)}`,
    });
  }

  // Sort by absolute contribution
  components.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  // Sum check
  const sumOfComponents = components.reduce((s, c) => s + c.value, 0);
  // The sum should approximate the EV change
  const evChange = exitEv - entryEv + cumulativeFCF;
  const unexplained = evChange - sumOfComponents;
  const explainedPercent = evChange !== 0 ? Math.round((1 - Math.abs(unexplained) / Math.abs(evChange)) * 100) : 100;

  // Add unexplained if significant
  const allComponents = [...components];
  if (Math.abs(unexplained) > Math.abs(evChange) * 0.02) {
    allComponents.push({
      label: '未解释部分',
      labelEn: 'Unexplained',
      value: unexplained,
      percentOfTotal: Math.round(Math.abs(unexplained) / Math.max(1, exitEv) * 100),
      description: '交叉效应及其他未归因因素（EBITDA增长×倍数扩张的交互项等）',
    });
  }

  return {
    entryEquityValue,
    exitEquityValue,
    totalReturn,
    totalReturnPercent,
    moic: Math.round(moic * 100) / 100,
    irr: Math.round(irr * 100) / 100,
    components: allComponents,
    sumOfComponents,
    unexplained: Math.abs(unexplained) > Math.abs(evChange) * 0.02 ? unexplained : 0,
    explainedPercent,
  };
}

// ── Helper: Analyze the bridge for narrative ──

export function generateBridgeNarrative(result: ValueBridgeResult): string {
  const parts: string[] = [];
  parts.push(`总投资回报 ${result.totalReturnPercent >= 0 ? '+' : ''}${result.totalReturnPercent.toFixed(1)}%（MOIC ${result.moic}x，IRR ${result.irr}%）。`);

  const primary = result.components.filter(c => c.labelEn !== 'Unexplained').slice(0, 2);
  for (const c of primary) {
    parts.push(`${c.label}贡献最大，${c.description}。`);
  }

  const largestComponent = result.components[0];
  if (largestComponent && largestComponent.labelEn === 'EBITDA Growth') {
    parts.push('回报主要由经营改善驱动，而非财务工程——这是高质量交易的特征。');
  } else if (largestComponent && largestComponent.labelEn === 'Multiple Expansion') {
    parts.push('回报高度依赖估值倍数扩张，需关注市场环境变化对退出窗口的影响。');
  } else if (largestComponent && largestComponent.labelEn === 'Debt Paydown') {
    parts.push('债务偿还是回报的主要驱动力，杠杆策略有效，但需确保 EBITDA 足够覆盖利息。');
  }

  if (result.explainedPercent < 90) {
    parts.push(`注意：仅 ${result.explainedPercent}% 的 EV 变动被归因，存在显著交叉效应。`);
  }

  return parts.join(' ');
}

// ── Helpers ──

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(0)}万`;
  return n.toFixed(0);
}

function fmtMultiple(n: number): string {
  return `${n.toFixed(1)}`;
}
