/**
 * LBO (Leveraged Buyout) Model Engine
 *
 * Calculates leveraged buyout returns for PE investors:
 * - Sources & Uses
 * - Debt repayment schedule with waterfall priority
 * - Free cash flow to equity
 * - Exit proceeds and returns (IRR, MOIC)
 * - Sensitivity analysis
 */

// ── Types ──

export interface LBOInput {
  // Entry
  readonly entryEnterpriseValue: number;
  readonly entryNetDebt: number;
  readonly entryFees: number; // % of EV (e.g., 0.02 for 2%)

  // Debt tranches (ordered by seniority, each amortizing)
  readonly debtTranches: readonly LBODebtTranche[];

  // Projections (annual, for holding period)
  readonly projections: readonly LBOProjectionYear[];

  // Exit
  readonly holdingYears: number;
  readonly exitMultiple: number; // EV/EBITDA at exit

  // Other
  readonly taxRate: number; // e.g., 0.25
  readonly minimumCash: number;
}

export interface LBODebtTranche {
  readonly label: string;
  readonly amount: number;
  readonly rate: number; // annual interest rate (e.g., 0.08 for 8%)
  readonly amortPercent: number; // % of original principal repaid per year (0 = bullet)
  readonly seniority: number; // 1 = most senior
}

export interface LBOProjectionYear {
  readonly year: number;
  readonly revenue: number;
  readonly ebitda: number;
  readonly dda: number; // depreciation & amortization
  readonly capex: number;
  readonly nwcIncrease: number; // change in net working capital
}

export interface LBODebtScheduleRow {
  readonly year: number;
  readonly tranches: readonly LBOTrancheState[];
  readonly totalDebtBegin: number;
  readonly totalInterest: number;
  readonly totalRepayment: number;
  readonly totalDebtEnd: number;
}

export interface LBOTrancheState {
  readonly label: string;
  readonly beginBalance: number;
  readonly interest: number;
  readonly repayment: number;
  readonly endBalance: number;
}

export interface LBOCashFlowRow {
  readonly year: number;
  readonly ebitda: number;
  readonly dda: number;
  readonly ebit: number;
  readonly tax: number;
  readonly nopat: number; // EBIT * (1 - tax)
  readonly operatingCashFlow: number; // NOPAT + D&A
  readonly capex: number;
  readonly nwcIncrease: number;
  readonly freeCashFlow: number; // OCF - Capex - NWC
  readonly interestPaid: number;
  readonly debtRepayment: number;
  readonly netCashFlow: number; // FCF - Interest - Debt Repayment
  readonly cashBalance: number;
}

export interface LBOExitResult {
  readonly exitEbitda: number;
  readonly exitEnterpriseValue: number;
  readonly exitEquityValue: number; // after repaying remaining debt
  readonly moic: number;
  readonly irr: number;
}

export interface LBOSensitivityPoint {
  readonly entryMultiple: number;
  readonly exitMultiple: number;
  readonly irr: number;
  readonly moic: number;
}

export interface LBOResult {
  readonly sourcesAndUses: {
    readonly sources: { readonly label: string; readonly amount: number; readonly percent: number }[];
    readonly uses: { readonly label: string; readonly amount: number; readonly percent: number }[];
    readonly totalSources: number;
    readonly totalUses: number;
  };
  readonly debtSchedule: readonly LBODebtScheduleRow[];
  readonly cashFlows: readonly LBOCashFlowRow[];
  readonly exit: LBOExitResult;
  readonly sensitivity: readonly LBOSensitivityPoint[];
  readonly keyMetrics: {
    readonly entryEvToEbitda: number;
    readonly debtToEbitda: number;
    readonly equityCheck: number;
    readonly averageDebtPaydownPerYear: number;
    readonly averageInterestCoverage: number;
  };
}

// ── Calculation ──

export function calculateLBO(input: LBOInput): LBOResult {
  const { entryEnterpriseValue, entryNetDebt, entryFees, debtTranches, projections, holdingYears, exitMultiple, taxRate, minimumCash } = input;

  // Sort tranches by seniority (1 = most senior, paid first)
  const sortedTranches = [...debtTranches].sort((a, b) => a.seniority - b.seniority);

  // --- Sources & Uses ---
  const totalDebt = sortedTranches.reduce((s, t) => s + t.amount, 0);
  const feesAmount = entryEnterpriseValue * entryFees;
  const totalUses = entryEnterpriseValue + feesAmount + entryNetDebt;
  const equityCheck = totalUses - totalDebt;

  const sources = sortedTranches.map(t => ({
    label: t.label,
    amount: t.amount,
    percent: totalUses > 0 ? t.amount / totalUses : 0,
  }));
  sources.push({
    label: '股权投资',
    amount: equityCheck,
    percent: totalUses > 0 ? equityCheck / totalUses : 0,
  });

  const uses = [
    { label: '企业价值', amount: entryEnterpriseValue, percent: totalUses > 0 ? entryEnterpriseValue / totalUses : 0 },
    { label: '交易费用', amount: feesAmount, percent: totalUses > 0 ? feesAmount / totalUses : 0 },
    ...(entryNetDebt !== 0 ? [{ label: '承接净债务', amount: entryNetDebt, percent: totalUses > 0 ? entryNetDebt / totalUses : 0 }] : []),
  ];

  // --- Debt Schedule & Cash Flows ---
  const debtSchedule: LBODebtScheduleRow[] = [];
  const cashFlows: LBOCashFlowRow[] = [];
  // Initialize tranche balances
  let trancheBalances = sortedTranches.map(t => ({ ...t, balance: t.amount }));
  let cashBalance = minimumCash; // start with minimum cash on hand
  let cumulativeSurplus = 0; // track excess cash

  for (let i = 0; i < projections.length; i++) {
    const proj = projections[i];
    const yearNum = proj.year;

    // Calculate interest and repayment per tranche
    const trancheRows: LBOTrancheState[] = [];
    let totalInterest = 0;
    let totalRepayment = 0;

    for (const tb of trancheBalances) {
      const interest = tb.balance * tb.rate;
      const scheduledRepay = Math.min(tb.balance, tb.amount * tb.amortPercent);
      totalInterest += interest;
      totalRepayment += scheduledRepay;
    }

    // Cash flow cascade
    const ebit = proj.ebitda - proj.dda;
    const tax = Math.max(0, ebit - totalInterest) * taxRate; // interest tax shield
    const nopat = ebit - tax;
    const operatingCF = nopat + proj.dda;
    const freeCF = operatingCF - proj.capex - proj.nwcIncrease;

    // Waterfall: pay interest first, then scheduled amort, then optional sweep
    let remainingCF = freeCF + cashBalance - minimumCash;

    // Pay interest
    const interestPaid = Math.min(remainingCF, totalInterest);
    remainingCF -= interestPaid;

    // Pay scheduled amortization (in seniority order)
    let actualRepayment = 0;
    const newBalances: typeof trancheBalances = [];
    for (const tb of trancheBalances) {
      const scheduled = Math.min(tb.balance, tb.amount * tb.amortPercent);
      const pay = Math.min(scheduled, remainingCF);
      actualRepayment += pay;
      remainingCF -= pay;
      newBalances.push({ ...tb, balance: tb.balance - pay });
    }

    // Optional: excess cash sweep (pay down most senior debt first)
    if (remainingCF > 0) {
      for (const nb of newBalances) {
        if (remainingCF <= 0) break;
        const sweep = Math.min(nb.balance, remainingCF);
        nb.balance -= sweep;
        actualRepayment += sweep;
        remainingCF -= sweep;
      }
    }

    // Build tranche rows
    for (let t = 0; t < sortedTranches.length; t++) {
      const tb = trancheBalances[t];
      const nb = newBalances[t];
      const interest = tb.balance * tb.rate;
      trancheRows.push({
        label: tb.label,
        beginBalance: tb.balance,
        interest,
        repayment: tb.balance - nb.balance,
        endBalance: nb.balance,
      });
    }

    const totalDebtBegin = trancheBalances.reduce((s, t) => s + t.balance, 0);
    const totalDebtEnd = newBalances.reduce((s, t) => s + t.balance, 0);

    debtSchedule.push({
      year: yearNum,
      tranches: trancheRows,
      totalDebtBegin,
      totalInterest,
      totalRepayment: actualRepayment,
      totalDebtEnd,
    });

    const netCF = freeCF - interestPaid - actualRepayment;
    cashBalance = minimumCash + Math.max(0, remainingCF);
    cumulativeSurplus += Math.max(0, remainingCF);

    cashFlows.push({
      year: yearNum,
      ebitda: proj.ebitda,
      dda: proj.dda,
      ebit,
      tax,
      nopat,
      operatingCashFlow: operatingCF,
      capex: proj.capex,
      nwcIncrease: proj.nwcIncrease,
      freeCashFlow: freeCF,
      interestPaid,
      debtRepayment: actualRepayment,
      netCashFlow: netCF,
      cashBalance,
    });

    trancheBalances = newBalances;
  }

  // --- Exit ---
  const lastProj = projections[projections.length - 1] ?? projections[0];
  const exitEbitda = lastProj.ebitda;
  const exitEV = exitEbitda * exitMultiple;
  const remainingDebt = trancheBalances.reduce((s, t) => s + t.balance, 0);
  const exitEquityValue = exitEV - remainingDebt + cashBalance;
  const moic = equityCheck > 0 ? exitEquityValue / equityCheck : 0;
  const irr = equityCheck > 0 ? Math.pow(exitEquityValue / equityCheck, 1 / holdingYears) - 1 : 0;

  const exit: LBOExitResult = {
    exitEbitda,
    exitEnterpriseValue: exitEV,
    exitEquityValue,
    moic: Math.round(moic * 100) / 100,
    irr: Math.round(irr * 10000) / 100, // percentage
  };

  // --- Key Metrics ---
  const entryEvToEbitda = projections[0]?.ebitda > 0 ? entryEnterpriseValue / projections[0].ebitda : 0;
  const debtToEbitda = projections[0]?.ebitda > 0 ? totalDebt / projections[0].ebitda : 0;
  const totalDebtPaid = sortedTranches.reduce((s, t) => s + t.amount, 0) - remainingDebt;
  const averageDebtPaydownPerYear = holdingYears > 0 ? totalDebtPaid / holdingYears : 0;
  const interestCoverages = cashFlows.map(cf => cf.ebitda > 0 ? cf.ebitda / (cf.interestPaid || 1) : 0);
  const averageInterestCoverage = interestCoverages.length > 0
    ? interestCoverages.reduce((s, v) => s + v, 0) / interestCoverages.length
    : 0;

  // --- Sensitivity ---
  const entryEbitda = projections[0]?.ebitda ?? 1;
  const entryMultipleBase = entryEnterpriseValue / entryEbitda;
  const sensitivity: LBOSensitivityPoint[] = [];
  const entryMultRange = [entryMultipleBase - 2, entryMultipleBase - 1, entryMultipleBase, entryMultipleBase + 1, entryMultipleBase + 2];
  const exitMultRange = [exitMultiple - 2, exitMultiple - 1, exitMultiple, exitMultiple + 1, exitMultiple + 2];

  for (const em of entryMultRange) {
    for (const xm of exitMultRange) {
      if (em <= 0 || xm <= 0) continue;
      const altEntryEV = entryEbitda * em;
      const altEquity = altEntryEV + feesAmount + entryNetDebt - totalDebt;
      const altExitEV = exitEbitda * xm;
      const altExitEquity = altExitEV - remainingDebt + cashBalance;
      const altMoic = altEquity > 0 ? altExitEquity / altEquity : 0;
      const altIrr = altEquity > 0 ? (Math.pow(altExitEquity / altEquity, 1 / holdingYears) - 1) * 100 : 0;
      sensitivity.push({
        entryMultiple: Math.round(em * 10) / 10,
        exitMultiple: Math.round(xm * 10) / 10,
        irr: Math.round(altIrr * 100) / 100,
        moic: Math.round(altMoic * 100) / 100,
      });
    }
  }

  return {
    sourcesAndUses: { sources, uses, totalSources: totalUses, totalUses },
    debtSchedule,
    cashFlows,
    exit,
    sensitivity,
    keyMetrics: {
      entryEvToEbitda: Math.round(entryEvToEbitda * 10) / 10,
      debtToEbitda: Math.round(debtToEbitda * 10) / 10,
      equityCheck: Math.round(equityCheck * 100) / 100,
      averageDebtPaydownPerYear: Math.round(averageDebtPaydownPerYear * 100) / 100,
      averageInterestCoverage: Math.round(averageInterestCoverage * 10) / 10,
    },
  };
}
