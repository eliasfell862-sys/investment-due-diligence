import { useState, useMemo } from 'react';
import { evaluateDecision } from '../../engines/decision/evaluate-decision';
export function InvestmentDecisionPage() {
  const [scores, setScores] = useState(() => { const s = localStorage.getItem('dd-scores'); return s ? JSON.parse(s) : { teamAndGovernance: '70', marketAndIndustry: '65', productAndTechnology: '65', commercializationAndGrowth: '60', financialAndCashFlow: '60', valuationAndReturn: '55' }; });
  const update = (f: string, v: string) => { const n = { ...scores, [f]: v }; setScores(n); localStorage.setItem('dd-scores', JSON.stringify(n)); };
  const result = useMemo(() => evaluateDecision({ version: '1', strategy: 'growth', qualityScores: scores as any, fatalOutcome: 'none', notCurableByClause: false, returnMetrics: { targetIrr: '0.25', targetMoic: '3', baseCaseIrr: null, baseCaseMoic: null, permanentLossProbabilityLower: '0.05', permanentLossProbabilityUpper: '0.2' }, keyAssumptions: [], bearCaseArguments: [] }), [scores]);
  const tier = result.status === 'ok' ? result.value.tier : null;
  const labels: Record<string, string> = { teamAndGovernance: '团队与治理', marketAndIndustry: '市场与产业', productAndTechnology: '产品与技术', commercializationAndGrowth: '商业化增长', financialAndCashFlow: '财务现金流', valuationAndReturn: '估值回报' };
  const tierLabels: Record<string, string> = { strong_recommend: '强烈推荐', conditional_invest: '有条件投资', continue_observing: '继续观察', defer: '暂缓', do_not_invest: '不投资' };
  return <div className="module-page"><h1>投资建议</h1><form className="module-form">{Object.entries(labels).map(([key, label]) => <label key={key}>{label}<input type="range" min="0" max="100" value={(scores as any)[key]} onChange={e => update(key, e.target.value)} /><span>{(scores as any)[key]}</span></label>)}</form>{tier && <div className="metric-card"><strong>{tierLabels[tier] ?? tier}</strong><span>投资判定</span></div>}{result.status === 'ok' && <p>{result.value.investRationale}</p>}</div>;
}
