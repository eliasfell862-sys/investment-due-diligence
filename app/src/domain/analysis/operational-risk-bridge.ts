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

export function generateOperationalRiskItems(projectId: string): AutoRiskItems {
  const result: AutoRiskItems = {
    customerConcentration: null,
    revenueGrowth: null,
    supplierConcentration: null,
    valuationDownRound: null,
    marketSize: null,
    technologyMaturity: null,
    legalCompliance: null,
    governanceKeyPerson: null,
    dataAuthenticity: null,
    exitLiquidity: null,
  };

  try {
    // 1. Customer concentration from sales data
    const sales = JSON.parse(store(projectId,'sales','[]'));
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
    const procurement = JSON.parse(store(projectId,'procurement','[]'));
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
    const finHistory = JSON.parse(store(projectId,'financing-history','[]'));
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
    // 5. Market risk from industry data
    const indData = JSON.parse(store(projectId,'industry','{}'));
    const tam = parseFloat(indData.tam)||0;
    const mktGrowth = parseFloat(indData.growthRate)||0;
    if (tam > 0 || mktGrowth > 0) {
      const prob = mktGrowth < 10 ? '0.5' : mktGrowth < 20 ? '0.3' : '0.15';
      result.marketSize = {
        riskId: 'auto-market-size',
        category: 'market' as RiskCategory,
        title: `市场风险：TAM=${tam?tam.toLocaleString()+'万':'未知'}，增速=${mktGrowth||'?'}%`,
        probability: prob, impact: '0.6',
        mitigationEffectiveness: '0.1',
        signals: ['market_adoption'],
        evidenceRefs: ['module:industry'],
      };
    }

    // 6. Tech risk from products data
    const prodData = JSON.parse(store(projectId,'products','[]'));
    const ipData = store(projectId,'ip','');
    const rdData = store(projectId,'rd','');
    if (prodData.length > 0 || ipData || rdData) {
      const liveCount = prodData.filter((p:any) => p.stage === '已发布' || p.stage === '规模化' || p.stage === '成熟期').length;
      const hasIP = ipData.length > 0;
      const prob = (!hasIP && liveCount === 0) ? '0.6' : hasIP ? '0.2' : '0.4';
      result.technologyMaturity = {
        riskId: 'auto-tech-maturity',
        category: 'technology' as RiskCategory,
        title: `技术风险：${prodData.length}个产品，${liveCount}个已上线，IP保护${hasIP?'是':'否'}`,
        probability: prob, impact: '0.7',
        mitigationEffectiveness: '0.15',
        signals: ['technical_feasibility'],
        evidenceRefs: ['module:products'],
      };
    }

    // 7. Legal/compliance risk from industry regulation
    const regData = indData.regulation || '';
    if (regData) {
      result.legalCompliance = {
        riskId: 'auto-legal-compliance',
        category: 'legal_compliance' as RiskCategory,
        title: `法律合规风险：${regData.slice(0,60)}`,
        probability: '0.4', impact: '0.7',
        mitigationEffectiveness: '0.2',
        signals: ['regulatory_approval'],
        evidenceRefs: ['module:industry'],
      };
    }

    // 8. Governance/key person risk from team data
    const teamData = JSON.parse(store(projectId,'team-members','[]'));
    const keyPeople = teamData.filter((t:any) => t.isKey === true || t.role?.includes('CEO') || t.role?.includes('CTO') || t.role?.includes('创始人'));
    if (teamData.length > 0) {
      const hasVesting = teamData.some((t:any) => t.ownership && parseFloat(t.ownership) > 0);
      const prob = keyPeople.length < 2 ? '0.5' : hasVesting ? '0.25' : '0.4';
      result.governanceKeyPerson = {
        riskId: 'auto-governance-keyperson',
        category: 'governance' as RiskCategory,
        title: `治理/关键人风险：团队${teamData.length}人，关键人${keyPeople.length}人，股权绑定${hasVesting?'是':'否'}`,
        probability: prob, impact: '0.6',
        mitigationEffectiveness: '0.15',
        signals: ['key_person'],
        evidenceRefs: ['module:team-assessment'],
      };
    }

    // 9. Data authenticity risk based on evidence completeness
    const evidenceCount = JSON.parse(store(projectId,'risk-items','[]')).length;
    if (evidenceCount < 3) {
      result.dataAuthenticity = {
        riskId: 'auto-data-authenticity',
        category: 'data_authenticity' as RiskCategory,
        title: `数据真实性风险：当前仅${evidenceCount}条风险评估记录，数据覆盖不足`,
        probability: '0.35', impact: '0.6',
        mitigationEffectiveness: '0.1',
        signals: ['data_integrity'],
        evidenceRefs: ['module:risk-assessment'],
      };
    }

    // 10. Exit/liquidity risk
    const exitData = JSON.parse(store(projectId,'exit','{}'));
    if (exitData.exitValue || exitData.ownershipPct) {
      const moic = exitData.moic ? parseFloat(exitData.moic) : 0;
      const prob = moic < 1.5 ? '0.6' : moic < 3 ? '0.3' : '0.15';
      result.exitLiquidity = {
        riskId: 'auto-exit-liquidity',
        category: 'exit' as RiskCategory,
        title: `退出风险：预期MOIC=${exitData.moic||'?'}，持股${exitData.ownershipPct||'?'}%`,
        probability: prob, impact: '0.5',
        mitigationEffectiveness: '0.2',
        signals: ['exit_delay'],
        evidenceRefs: ['module:exit'],
      };
    }

  } catch { /* localStorage may be empty or corrupted */ }

  return result;
}

export function getOperationalSummary(projectId: string): string[] {
  const items: string[] = [];
  try {
    const sales = JSON.parse(store(projectId,'sales','[]'));
    const procurement = JSON.parse(store(projectId,'procurement','[]'));
    const finHistory = JSON.parse(store(projectId,'financing-history','[]'));
    const contracts = JSON.parse(store(projectId,'contracts','[]'));

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

    // 5. Market risk from industry data
    const indData = JSON.parse(store(projectId,'industry','{}'));
    const tam = parseFloat(indData.tam)||0;
    const mktGrowth = parseFloat(indData.growthRate)||0;
    if (tam > 0 || mktGrowth > 0) {
      const prob = mktGrowth < 10 ? '0.5' : mktGrowth < 20 ? '0.3' : '0.15';
      result.marketSize = {
        riskId: 'auto-market-size',
        category: 'market' as RiskCategory,
        title: `市场风险：TAM=${tam?tam.toLocaleString()+'万':'未知'}，增速=${mktGrowth||'?'}%`,
        probability: prob, impact: '0.6',
        mitigationEffectiveness: '0.1',
        signals: ['market_adoption'],
        evidenceRefs: ['module:industry'],
      };
    }

    // 6. Tech risk from products data
    const prodData = JSON.parse(store(projectId,'products','[]'));
    const ipData = store(projectId,'ip','');
    const rdData = store(projectId,'rd','');
    if (prodData.length > 0 || ipData || rdData) {
      const liveCount = prodData.filter((p:any) => p.stage === '已发布' || p.stage === '规模化' || p.stage === '成熟期').length;
      const hasIP = ipData.length > 0;
      const prob = (!hasIP && liveCount === 0) ? '0.6' : hasIP ? '0.2' : '0.4';
      result.technologyMaturity = {
        riskId: 'auto-tech-maturity',
        category: 'technology' as RiskCategory,
        title: `技术风险：${prodData.length}个产品，${liveCount}个已上线，IP保护${hasIP?'是':'否'}`,
        probability: prob, impact: '0.7',
        mitigationEffectiveness: '0.15',
        signals: ['technical_feasibility'],
        evidenceRefs: ['module:products'],
      };
    }

    // 7. Legal/compliance risk from industry regulation
    const regData = indData.regulation || '';
    if (regData) {
      result.legalCompliance = {
        riskId: 'auto-legal-compliance',
        category: 'legal_compliance' as RiskCategory,
        title: `法律合规风险：${regData.slice(0,60)}`,
        probability: '0.4', impact: '0.7',
        mitigationEffectiveness: '0.2',
        signals: ['regulatory_approval'],
        evidenceRefs: ['module:industry'],
      };
    }

    // 8. Governance/key person risk from team data
    const teamData = JSON.parse(store(projectId,'team-members','[]'));
    const keyPeople = teamData.filter((t:any) => t.isKey === true || t.role?.includes('CEO') || t.role?.includes('CTO') || t.role?.includes('创始人'));
    if (teamData.length > 0) {
      const hasVesting = teamData.some((t:any) => t.ownership && parseFloat(t.ownership) > 0);
      const prob = keyPeople.length < 2 ? '0.5' : hasVesting ? '0.25' : '0.4';
      result.governanceKeyPerson = {
        riskId: 'auto-governance-keyperson',
        category: 'governance' as RiskCategory,
        title: `治理/关键人风险：团队${teamData.length}人，关键人${keyPeople.length}人，股权绑定${hasVesting?'是':'否'}`,
        probability: prob, impact: '0.6',
        mitigationEffectiveness: '0.15',
        signals: ['key_person'],
        evidenceRefs: ['module:team-assessment'],
      };
    }

    // 9. Data authenticity risk based on evidence completeness
    const evidenceCount = JSON.parse(store(projectId,'risk-items','[]')).length;
    if (evidenceCount < 3) {
      result.dataAuthenticity = {
        riskId: 'auto-data-authenticity',
        category: 'data_authenticity' as RiskCategory,
        title: `数据真实性风险：当前仅${evidenceCount}条风险评估记录，数据覆盖不足`,
        probability: '0.35', impact: '0.6',
        mitigationEffectiveness: '0.1',
        signals: ['data_integrity'],
        evidenceRefs: ['module:risk-assessment'],
      };
    }

    // 10. Exit/liquidity risk
    const exitData = JSON.parse(store(projectId,'exit','{}'));
    if (exitData.exitValue || exitData.ownershipPct) {
      const moic = exitData.moic ? parseFloat(exitData.moic) : 0;
      const prob = moic < 1.5 ? '0.6' : moic < 3 ? '0.3' : '0.15';
      result.exitLiquidity = {
        riskId: 'auto-exit-liquidity',
        category: 'exit' as RiskCategory,
        title: `退出风险：预期MOIC=${exitData.moic||'?'}，持股${exitData.ownershipPct||'?'}%`,
        probability: prob, impact: '0.5',
        mitigationEffectiveness: '0.2',
        signals: ['exit_delay'],
        evidenceRefs: ['module:exit'],
      };
    }

  } catch {}
  return items;
}
