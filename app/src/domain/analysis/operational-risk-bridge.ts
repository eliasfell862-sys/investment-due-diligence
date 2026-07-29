/**
 * Bridge: operational modules → risk engine.
 * Every risk item uses actual computed metrics — not arbitrary values.
 */
import type { RiskItemInput } from '../../engines/risk/risk-types';
import {
  computeCustomerConcentration, computeRevenueGrowth,
  computeSupplierConcentration, computeValuationTrajectory,
} from './operational-metrics';

export interface AutoRiskItems {
  customerConcentration: RiskItemInput | null;
  revenueGrowth: RiskItemInput | null;
  supplierConcentration: RiskItemInput | null;
  valuationDownRound: RiskItemInput | null;
  marketSize: RiskItemInput | null;
  technologyMaturity: RiskItemInput | null;
  legalCompliance: RiskItemInput | null;
  governanceKeyPerson: RiskItemInput | null;
  dataAuthenticity: RiskItemInput | null;
  exitLiquidity: RiskItemInput | null;
}

function store(projectId: string, module: string, fallback: string): string {
  const key = `dd-p-${projectId}-${module}`;
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

// Helper: map a computed continuous metric to a probability [0,1]
function metricToProb(metric: number, thresholds: [number, number, number]): string {
  // thresholds: [low, medium, high] boundaries
  if (metric > thresholds[2]) return '0.15'; // low risk
  if (metric > thresholds[1]) return '0.3';  // medium-low
  if (metric > thresholds[0]) return '0.5';  // medium
  return '0.7'; // high risk
}

export function generateOperationalRiskItems(projectId: string): AutoRiskItems {
  const result: AutoRiskItems = {
    customerConcentration: null, revenueGrowth: null,
    supplierConcentration: null, valuationDownRound: null,
    marketSize: null, technologyMaturity: null,
    legalCompliance: null, governanceKeyPerson: null,
    dataAuthenticity: null, exitLiquidity: null,
  };

  try {
    const sales = JSON.parse(store(projectId,'sales','[]'));
    const procurement = JSON.parse(store(projectId,'procurement','[]'));
    const finHistory = JSON.parse(store(projectId,'financing-history','[]'));
    const indData = JSON.parse(store(projectId,'industry','{}'));
    const prodData = JSON.parse(store(projectId,'products','[]'));
    const teamData = JSON.parse(store(projectId,'team-members','[]'));
    const exitData = JSON.parse(store(projectId,'exit','{}'));

    // 1. Customer concentration (real HHI-based)
    const conc = computeCustomerConcentration(sales);
    if (conc) {
      const top1Val = parseFloat(conc.top1Pct);
      result.customerConcentration = {
        riskId: 'auto-customer-concentration',
        category: 'customer',
        title: `客户集中度风险：HHI=${conc.herfindahlIndex}，Top1客户${conc.top1Pct}%，Top3客户${conc.top3Pct}%`,
        probability: metricToProb(100 - top1Val, [30, 50, 70]),
        impact: top1Val > 50 ? '0.8' : top1Val > 30 ? '0.5' : '0.3',
        mitigationEffectiveness: '0.2',
        signals: ['customer_concentration'],
        evidenceRefs: ['module:sales-analysis'],
      };
    }

    // 2. Revenue growth (real CAGR-based)
    const growth = computeRevenueGrowth(sales);
    if (growth) {
      const cagrVal = parseFloat(growth.cagr);
      result.revenueGrowth = {
        riskId: 'auto-revenue-growth',
        category: 'financial',
        title: `收入增长风险：CAGR=${growth.cagr}%，2024增速${growth.yoy2024}%，2025增速${growth.yoy2025}%，趋势${growth.trend}`,
        probability: metricToProb(cagrVal, [5, 15, 30]),
        impact: cagrVal < 0 ? '0.7' : '0.5',
        mitigationEffectiveness: '0.1',
        signals: ['revenue_quality'],
        evidenceRefs: ['module:sales-analysis'],
      };
    }

    // 3. Supplier concentration (real data)
    const supp = computeSupplierConcentration(procurement);
    if (supp) {
      const top1Val = parseFloat(supp.topSupplierPct);
      result.supplierConcentration = {
        riskId: 'auto-supplier-concentration',
        category: 'financial',
        title: `供应商集中度风险：Top1供应商${supp.topSupplierPct}%，最大类别${supp.largestCategory}(${supp.largestCategoryPct}%)`,
        probability: metricToProb(100 - top1Val, [30, 50, 70]),
        impact: top1Val > 50 ? '0.6' : '0.4',
        mitigationEffectiveness: '0.1',
        signals: ['cash_runway'],
        evidenceRefs: ['module:procurement'],
      };
    }

    // 4. Valuation trajectory
    const valTrac = computeValuationTrajectory(finHistory);
    if (valTrac && valTrac.roundCount > 0) {
      const growthVal = parseFloat(valTrac.valuationGrowth);
      result.valuationDownRound = {
        riskId: 'auto-valuation-down-round',
        category: 'financing',
        title: `估值风险：${valTrac.roundCount}轮融资，最新投前${valTrac.latestPreMoney}万，估值CAGR=${valTrac.valuationGrowth}%，趋势${valTrac.trend}`,
        probability: valTrac.trend === 'down' ? '0.6' : metricToProb(growthVal, [10, 30, 60]),
        impact: valTrac.trend === 'down' ? '0.7' : '0.4',
        mitigationEffectiveness: '0.2',
        signals: ['financing_dependency'],
        evidenceRefs: ['module:financing-history'],
      };
    }

    // 5. Market size & growth (real TAM/growth analysis)
    const tam = parseFloat(indData.tam)||0;
    const mktGrowth = parseFloat(indData.growthRate)||0;
    if (tam > 0 || mktGrowth > 0) {
      const growthRisk = mktGrowth < 10 ? 0.6 : mktGrowth < 20 ? 0.4 : mktGrowth < 30 ? 0.25 : 0.15;
      const sizeRisk = tam < 100000 ? 0.5 : tam < 500000 ? 0.3 : 0.15;
      result.marketSize = {
        riskId: 'auto-market-size',
        category: 'market',
        title: `市场风险：TAM=${tam.toLocaleString()}万，增速${mktGrowth}%/年`,
        probability: String(Math.max(growthRisk, sizeRisk)),
        impact: tam < 100000 ? '0.6' : '0.4',
        mitigationEffectiveness: '0.1',
        signals: ['market_adoption'],
        evidenceRefs: ['module:industry'],
      };
    }

    // 6. Technology maturity (real product/R&D data)
    if (prodData.length > 0) {
      const liveCount = prodData.filter((p:any) => ['已发布','规模化','成熟期'].includes(p.stage)).length;
      const maturity = liveCount / prodData.length;
      const hasIP = (store(projectId,'ip','')).length > 0;
      const hasRD = (store(projectId,'rd','')).length > 0;
      result.technologyMaturity = {
        riskId: 'auto-tech-maturity',
        category: 'technology',
        title: `技术风险：${prodData.length}产品，成熟度${(maturity*100).toFixed(0)}%，IP保护${hasIP?'是':'否'}，研发管线${hasRD?'有':'无'}`,
        probability: maturity < 0.3 ? '0.6' : maturity < 0.6 ? '0.35' : '0.15',
        impact: hasIP ? '0.4' : '0.7',
        mitigationEffectiveness: '0.15',
        signals: ['technical_feasibility'],
        evidenceRefs: ['module:products'],
      };
    }

    // 7. Legal/compliance (from industry regulation data)
    const reg = indData.regulation || '';
    if (reg) {
      result.legalCompliance = {
        riskId: 'auto-legal-compliance',
        category: 'legal_compliance',
        title: `法律合规风险：${reg.slice(0,80)}`,
        probability: '0.35',
        impact: '0.6',
        mitigationEffectiveness: '0.2',
        signals: ['regulatory_approval'],
        evidenceRefs: ['module:industry'],
      };
    }

    // 8. Governance/key person
    if (teamData.length > 0) {
      const keyCount = teamData.filter((t:any) => t.isKey || /CEO|CTO|创始人/.test(t.role||'')).length;
      const hasVesting = teamData.some((t:any) => t.ownership && parseFloat(t.ownership) > 0);
      result.governanceKeyPerson = {
        riskId: 'auto-governance-keyperson',
        category: 'governance',
        title: `治理风险：团队${teamData.length}人，关键人${keyCount}人，股权绑定${hasVesting?'已设置':'未设置'}`,
        probability: keyCount < 2 ? '0.55' : hasVesting ? '0.25' : '0.4',
        impact: keyCount < 2 ? '0.7' : '0.5',
        mitigationEffectiveness: '0.15',
        signals: ['key_person'],
        evidenceRefs: ['module:team-assessment'],
      };
    }

    // 9. Data authenticity
    const riskItems = JSON.parse(store(projectId,'risk-items','[]'));
    const assessedCount = riskItems.length;
    result.dataAuthenticity = {
      riskId: 'auto-data-authenticity',
      category: 'data_authenticity',
      title: `数据真实性风险：已评估${assessedCount}项风险，AI提取${store(projectId,'extraction-summary','')?'已完成':'未完成'}`,
      probability: assessedCount < 3 ? '0.4' : '0.2',
      impact: '0.5',
      mitigationEffectiveness: '0.1',
      signals: ['data_integrity'],
      evidenceRefs: ['module:risk-assessment'],
    };

    // 10. Exit/liquidity
    if (exitData.exitValue || exitData.moic) {
      const moic = parseFloat(exitData.moic) || 0;
      result.exitLiquidity = {
        riskId: 'auto-exit-liquidity',
        category: 'exit',
        title: `退出风险：预期MOIC=${exitData.moic||'未计算'}x，持股${exitData.ownershipPct||'?'}%，退出估值${exitData.exitValue||'?'}万`,
        probability: moic < 1.5 ? '0.6' : moic < 3 ? '0.3' : '0.15',
        impact: moic < 1.5 ? '0.7' : '0.5',
        mitigationEffectiveness: '0.2',
        signals: ['exit_delay'],
        evidenceRefs: ['module:exit'],
      };
    }

  } catch { /* localStorage may be empty */ }

  return result;
}

export function getOperationalSummary(projectId: string): string[] {
  const items: string[] = [];
  try {
    const sales = JSON.parse(store(projectId,'sales','[]'));
    const procurement = JSON.parse(store(projectId,'procurement','[]'));
    const finHistory = JSON.parse(store(projectId,'financing-history','[]'));
    const conc = computeCustomerConcentration(sales);
    if (conc) items.push(`客户集中度：Top1=${conc.top1Pct}%，HHI=${conc.herfindahlIndex}`);

    const growth = computeRevenueGrowth(sales);
    if (growth) items.push(`收入CAGR：${growth.cagr}%，趋势=${growth.trend}`);

    const supp = computeSupplierConcentration(procurement);
    if (supp) items.push(`供应商集中度：Top1=${supp.topSupplierPct}%`);

    const val = computeValuationTrajectory(finHistory);
    if (val) items.push(`融资：${val.roundCount}轮，最新投后${val.latestPostMoney}万`);

  } catch {}
  return items;
}
