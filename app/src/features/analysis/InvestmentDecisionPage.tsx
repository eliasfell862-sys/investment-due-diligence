import { useState, useMemo, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { evaluateDecision } from '../../engines/decision/evaluate-decision';
import type { InvestmentStrategy } from '../../engines/decision/decision-types';

const DIMS: [string, string][] = [
  ['teamAndGovernance', '团队与治理'], ['marketAndIndustry', '市场与产业'],
  ['productAndTechnology', '产品与技术'], ['commercializationAndGrowth', '商业化增长'],
  ['financialAndCashFlow', '财务与现金流'], ['valuationAndReturn', '估值与回报'],
];

// Auto-calculate default quality scores from available data
function autoScores(projectId: string): Record<string, string> {
  const scores: Record<string, string> = {};
  try {
    const team = JSON.parse(localStorage.getItem(`dd-p-${projectId}-team-members`) || '[]');
    const industry = JSON.parse(localStorage.getItem(`dd-p-${projectId}-industry`) || '{}');
    const products = JSON.parse(localStorage.getItem(`dd-p-${projectId}-products`) || '[]');
    const fin = JSON.parse(localStorage.getItem(`dd-p-${projectId}-financials`) || '{}');
    const sales = JSON.parse(localStorage.getItem(`dd-p-${projectId}-sales`) || '[]');
    const val = JSON.parse(localStorage.getItem(`dd-p-${projectId}-valuation`) || '{}');
    const exit_ = JSON.parse(localStorage.getItem(`dd-p-${projectId}-exit`) || '{}');

    // Team score: based on team size and completeness
    let teamScore = 50;
    if (team.length >= 3) teamScore += 15;
    if (team.length >= 5) teamScore += 10;
    if (team.some((t: any) => t.background?.length > 20)) teamScore += 15;
    scores.teamAndGovernance = String(Math.min(100, teamScore));

    // Market score: based on TAM and growth
    let marketScore = 50;
    const tam = parseFloat(industry.tam) || 0;
    const growth = parseFloat(industry.growthRate) || 0;
    if (tam > 100000) marketScore += 15;
    if (tam > 1000000) marketScore += 10;
    if (growth > 10) marketScore += 10;
    if (growth > 30) marketScore += 10;
    scores.marketAndIndustry = String(Math.min(100, marketScore));

    // Product score
    let prodScore = 50;
    if (products.length >= 1) prodScore += 15;
    if (products.length >= 3) prodScore += 10;
    if (localStorage.getItem(`dd-p-${projectId}-ip`)) prodScore += 10;
    scores.productAndTechnology = String(Math.min(100, prodScore));

    // Growth score based on revenue CAGR
    let growthScore = 50;
    const r23 = sales.reduce((s: number, c: any) => s + (parseFloat(c.revenue2023) || 0), 0);
    const r25 = sales.reduce((s: number, c: any) => s + (parseFloat(c.revenue2025) || 0), 0);
    if (r23 > 0 && r25 > 0) {
      const cagr = (Math.pow(r25 / r23, 0.5) - 1) * 100;
      if (cagr > 20) growthScore += 20;
      else if (cagr > 10) growthScore += 10;
      else if (cagr < 0) growthScore -= 20;
    }
    scores.commercializationAndGrowth = String(Math.max(0, Math.min(100, growthScore)));

    // Financial score
    let finScore = 50;
    if (fin.revenue) finScore += 10;
    if (fin.grossProfit && fin.revenue && parseFloat(fin.grossProfit) / parseFloat(fin.revenue) > 0.3) finScore += 10;
    if (fin.netIncome && parseFloat(fin.netIncome) > 0) finScore += 15;
    scores.financialAndCashFlow = String(Math.min(100, finScore));

    // Valuation score
    let valScore = 50;
    if (val.fcfBase) valScore += 10;
    if (val.wacc) valScore += 5;
    if (exit_.exitValue) valScore += 10;
    scores.valuationAndReturn = String(Math.min(100, valScore));

  } catch {}
  return scores;
}
const TIER: Record<string, string> = { strong_recommend: '强烈推荐', conditional_invest: '有条件投资', continue_observing: '继续观察', defer: '暂缓', do_not_invest: '不投资' };
const TIER_COLOR: Record<string, string> = { strong_recommend: '#16766f', conditional_invest: '#0a84ff', continue_observing: '#ff9f0a', defer: '#9c3f36', do_not_invest: '#8c2825' };

export function InvestmentDecisionPage() {
  const { projectId = "default" } = useParams<{ projectId: string }>();
  const [strategy, setStrategy] = useState<InvestmentStrategy>(() => (localStorage.getItem(`dd-p-${projectId}-strategy`) as InvestmentStrategy) || 'growth');
  const [scores, setScores] = useState<Record<string, string>>(() => { const s = localStorage.getItem(`dd-p-${projectId}-quality`); if (s && Object.keys(JSON.parse(s)).length > 0) return JSON.parse(s); const auto = autoScores(projectId); localStorage.setItem(`dd-p-${projectId}-quality`, JSON.stringify(auto)); return auto; });

  useEffect(() => { localStorage.setItem(`dd-p-${projectId}-quality`, JSON.stringify(scores)); }, [scores]);
  const [riskPenalty, setRiskPenalty] = useState(() => localStorage.getItem(`dd-p-${projectId}-risk-penalty`) || '5');
  const [fatal, setFatal] = useState(() => localStorage.getItem(`dd-p-${projectId}-fatal-outcome`) || 'none');
  const [assumptions, setAssumptions] = useState(() => localStorage.getItem(`dd-p-${projectId}-assumptions`) || '');
  const [bearCase, setBearCase] = useState(() => localStorage.getItem(`dd-p-${projectId}-bearcase`) || '');

  const update = (k: string, v: string) => { const n = { ...scores, [k]: v }; setScores(n); localStorage.setItem(`dd-p-${projectId}-quality`, JSON.stringify(n)); };

  const result = useMemo(() => evaluateDecision({
    version: '1', strategy,
    qualityScores: scores as any, fatalOutcome: fatal as any,
    notCurableByClause: fatal === 'reject',
    returnMetrics: { targetIrr: '0.25', targetMoic: '3', baseCaseIrr: null, baseCaseMoic: null, permanentLossProbabilityLower: '0.05', permanentLossProbabilityUpper: '0.2' },
    keyAssumptions: assumptions.split('\n').filter(Boolean),
    bearCaseArguments: bearCase.split('\n').filter(Boolean),
    riskPenalty, overallResidualRisk: '0.3',
  }), [scores, strategy, fatal, riskPenalty, assumptions, bearCase]);

  const tier = result.status === 'ok' ? result.value.tier : null;

  return (
    <div className="module-page">
      <h1>投资决策</h1>
      <div className="flex-row" style={{marginBottom:20,gap:16}}>
        <label>投资阶段 <select value={strategy} onChange={e => { const v = e.target.value as InvestmentStrategy; setStrategy(v); localStorage.setItem(`dd-p-${projectId}-strategy`, v); }}>
          <option value="vc_early">早期VC</option><option value="growth">成长期</option><option value="pe_buyout">PE并购</option>
        </select></label>
        <label>致命缺陷 <select value={fatal} onChange={e => { setFatal(e.target.value); localStorage.setItem(`dd-p-${projectId}-fatal-outcome`, e.target.value); }}>
          <option value="none">无</option><option value="conditional_cap">受限</option><option value="pause">暂停</option><option value="reject">否决</option>
        </select></label>
        <label>风险惩罚 <input style={{width:80}} value={riskPenalty} onChange={e => { setRiskPenalty(e.target.value); localStorage.setItem(`dd-p-${projectId}-risk-penalty`, e.target.value); }} /></label>
      </div>

      <form className="module-form" onSubmit={e => e.preventDefault()}>
        {DIMS.map(([k, l]) => (
          <label key={k}>{l} <small>({scores[k]})</small>
            <input type="range" min="0" max="100" value={scores[k]} onChange={e => update(k, e.target.value)} />
          </label>
        ))}
      </form>

      {tier && (
        <div style={{margin:'28px 0'}}>
          <div className="metric-card metric-card-primary" style={{borderLeft:`6px solid ${TIER_COLOR[tier]}`}}>
            <strong style={{fontSize:'2.4rem',color:TIER_COLOR[tier]}}>{TIER[tier] ?? tier}</strong>
            <span>投资判定</span>
          </div>
          {result.status === 'ok' && <>
            <div className="results-grid" style={{marginTop:16}}>
              <div className="metric-card"><strong>{result.value.compositeScore ?? '-'}</strong><span>综合评分</span></div>
              <div className="metric-card"><strong>{result.value.riskAdjustedScore ?? '-'}</strong><span>风险调整后</span></div>
            </div>
            <div className="loss-info" style={{marginTop:16}}><strong>投资逻辑：</strong> {result.value.investRationale}</div>
            {result.value.prerequisites.length > 0 && <div style={{marginTop:12}}><strong>先决条件：</strong><ul>{result.value.prerequisites.map((p,i) => <li key={i}>{p}</li>)}</ul></div>}
            {result.value.verificationActions.length > 0 && <div style={{marginTop:12}}><strong>验证事项：</strong><ul>{result.value.verificationActions.map((v,i) => <li key={i}>{v}</li>)}</ul></div>}
            {result.value.reversalConditions.length > 0 && <div style={{marginTop:12}}><strong>反转条件：</strong><ul>{result.value.reversalConditions.map((r,i) => <li key={i}>{r}</li>)}</ul></div>}
            {result.value.bearCase && <p style={{marginTop:12,color:'#9c3f36'}}><strong>反面逻辑：</strong> {result.value.bearCase}</p>}
          </>}
        </div>
      )}

      <h2 style={{marginTop:32}}>关键假设与反面逻辑</h2>
      <form className="module-form" onSubmit={e => e.preventDefault()}>
        <label>关键假设 (每行一个)<textarea rows={3} value={assumptions} onChange={e => { setAssumptions(e.target.value); localStorage.setItem(`dd-p-${projectId}-assumptions`, e.target.value); }} /></label>
        <label>反面逻辑<textarea rows={3} value={bearCase} onChange={e => { setBearCase(e.target.value); localStorage.setItem(`dd-p-${projectId}-bearcase`, e.target.value); }} /></label>
      </form>
    </div>
  );
}
