/**
 * Bridge: operational modules → risk engine & financial analysis.
 * Reads localStorage, computes metrics, and auto-generates risk items.
 */
import type { RiskItemInput, RiskCategory } from '../../engines/risk/risk-types';
import {
  computeCustomerConcentration,
  computeRevenueGrowth,
  computeSupplierConcentration,
  computeValuationTrajectory,
  computeContractCoverage,
} from './operational-metrics';

export interface AutoRiskItems {
  customerConcentration: RiskItemInput | null;
  revenueGrowth: RiskItemInput | null;
  supplierConcentration: RiskItemInput | null;
  valuationDownRound: RiskItemInput | null;
}

export function generateOperationalRiskItems(): AutoRiskItems {
  const result: AutoRiskItems = {
    customerConcentration: null,
    revenueGrowth: null,
    supplierConcentration: null,
    valuationDownRound: null,
  };

  try {
    // 1. Customer concentration from sales data
    const sales = JSON.parse(localStorage.getItem('dd-sales') || '[]');
    const concentration = computeCustomerConcentration(sales);
    if (concentration) {
      const prob = concentration.risk === 'high' ? '0.7' : concentration.risk === 'medium' ? '0.4' : '0.2';
      const impact = concentration.risk === 'high' ? '0.8' : concentration.risk === 'medium' ? '0.5' : '0.3';
      result.customerConcentration = {
        riskId: 'auto-customer-concentration',
        category: 'customer' as RiskCategory,
        title: `客户集中度风险：Top1占比${concentration.top1Pct}%，Top3占比${concentration.top3Pct}%，HHI=${concentration.herfindahlIndex}`,
        probability: prob,
        impact,
        mitigationEffectiveness: '0.2',
        signals: ['customer_concentration', 'revenue_quality'],
        evidenceRefs: ['module:sales-analysis'],
      };
    }

    // 2. Revenue growth from sales data
    const growth = computeRevenueGrowth(sales);
    if (growth) {
      const prob = growth.risk === 'high' ? '0.6' : growth.risk === 'medium' ? '0.3' : '0.1';
      result.revenueGrowth = {
        riskId: 'auto-revenue-growth',
        category: 'financial' as RiskCategory,
        title: `收入增长风险：CAGR=${growth.cagr}%，2024增长=${growth.yoy2024}%，2025增长=${growth.yoy2025}%，趋势=${growth.trend}`,
        probability: prob,
        impact: '0.6',
        mitigationEffectiveness: '0.1',
        signals: ['revenue_quality', 'cash_runway'],
        evidenceRefs: ['module:sales-analysis'],
      };
    }

    // 3. Supplier concentration from procurement
    const procurement = JSON.parse(localStorage.getItem('dd-procurement') || '[]');
    const supplierConc = computeSupplierConcentration(procurement);
    if (supplierConc) {
      const prob = supplierConc.risk === 'high' ? '0.5' : supplierConc.risk === 'medium' ? '0.3' : '0.15';
      result.supplierConcentration = {
        riskId: 'auto-supplier-concentration',
        category: 'financial' as RiskCategory,
        title: `供应商集中度风险：Top1占比${supplierConc.topSupplierPct}%，最大类别${supplierConc.largestCategory}(${supplierConc.largestCategoryPct}%)`,
        probability: prob,
        impact: '0.5',
        mitigationEffectiveness: '0.1',
        signals: ['cash_runway'],
        evidenceRefs: ['module:procurement'],
      };
    }

    // 4. Valuation trajectory from financing history
    const finHistory = JSON.parse(localStorage.getItem('dd-financing-history') || '[]');
    const valTrac = computeValuationTrajectory(finHistory);
    if (valTrac && valTrac.trend === 'down') {
      result.valuationDownRound = {
        riskId: 'auto-valuation-down-round',
        category: 'financing' as RiskCategory,
        title: `估值下行风险：${valTrac.roundCount}轮融资，最新投前${valTrac.latestPreMoney}万，CAGR=${valTrac.valuationGrowth}%`,
        probability: '0.5',
        impact: '0.7',
        mitigationEffectiveness: '0.2',
        signals: ['financing_dependency'],
        evidenceRefs: ['module:financing-history'],
      };
    }
  } catch { /* localStorage may be empty or corrupted */ }

  return result;
}

export function getOperationalSummary(): string[] {
  const items: string[] = [];
  try {
    const sales = JSON.parse(localStorage.getItem('dd-sales') || '[]');
    const procurement = JSON.parse(localStorage.getItem('dd-procurement') || '[]');
    const finHistory = JSON.parse(localStorage.getItem('dd-financing-history') || '[]');
    const contracts = JSON.parse(localStorage.getItem('dd-contracts') || '[]');

    const conc = computeCustomerConcentration(sales);
    if (conc) items.push(`客户集中度：Top1=${conc.top1Pct}%，风险=${conc.risk}`);

    const growth = computeRevenueGrowth(sales);
    if (growth) items.push(`收入CAGR：${growth.cagr}%，趋势=${growth.trend}`);

    const supp = computeSupplierConcentration(procurement);
    if (supp) items.push(`供应商集中度：Top1=${supp.topSupplierPct}%`);

    const val = computeValuationTrajectory(finHistory);
    if (val) items.push(`融资：${val.roundCount}轮，最新投后${val.latestPostMoney}万`);

    const cov = computeContractCoverage(contracts, parseFloat(sales.reduce((s: number, c: any) => s + (parseFloat(c.revenue2025) || 0), 0)) || 0);
    if (cov) items.push(`合同覆盖：${cov.totalContractValue}万 / ${cov.contractCount}份`);

  } catch {}
  return items;
}
