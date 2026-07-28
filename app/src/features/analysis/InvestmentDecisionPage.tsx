import { useState, useMemo } from 'react';
import { evaluateDecision } from '../../engines/decision/evaluate-decision';
import type { InvestmentStrategy } from '../../engines/decision/decision-types';

const DIMS: [string, string][] = [
  ['teamAndGovernance', 'Team & Governance'],
  ['marketAndIndustry', 'Market & Industry'],
  ['productAndTechnology', 'Product & Tech'],
  ['commercializationAndGrowth', 'Commercialization'],
  ['financialAndCashFlow', 'Financial & Cash Flow'],
  ['valuationAndReturn', 'Valuation & Return'],
];
const TIER_LABELS: Record<string, string> = {
  strong_recommend: 'Strongly Recommend',
  conditional_invest: 'Conditional Investment',
  continue_observing: 'Continue Observing',
  defer: 'Defer',
  do_not_invest: 'Do Not Invest',
};

export function InvestmentDecisionPage() {
  const [strategy, setStrategy] = useState<InvestmentStrategy>(() => (localStorage.getItem('dd-strategy') as InvestmentStrategy) || 'growth');
  const [scores, setScores] = useState<Record<string, string>>(() => { const s = localStorage.getItem('dd-quality'); return s ? JSON.parse(s) : Object.fromEntries(DIMS.map(([k]) => [k, '70'])); });
  const [riskPenalty, setRiskPenalty] = useState(() => localStorage.getItem('dd-risk-penalty') || '5');
  const [fatalOutcome, setFatalOutcome] = useState<string>(() => localStorage.getItem('dd-fatal-outcome') || 'none');

  const update = (k: string, v: string) => { const n = { ...scores, [k]: v }; setScores(n); localStorage.setItem('dd-quality', JSON.stringify(n)); };

  const result = useMemo(() => evaluateDecision({
    version: '1', strategy,
    qualityScores: scores as any,
    fatalOutcome: fatalOutcome as any,
    notCurableByClause: fatalOutcome === 'reject',
    returnMetrics: { targetIrr: '0.25', targetMoic: '3', baseCaseIrr: null, baseCaseMoic: null, permanentLossProbabilityLower: '0.05', permanentLossProbabilityUpper: '0.2' },
    keyAssumptions: [],
    bearCaseArguments: [],
    riskPenalty,
    overallResidualRisk: '0.3',
  }), [scores, strategy, fatalOutcome, riskPenalty]);

  const tier = result.status === 'ok' ? result.value.tier : null;

  return (
    <div className="module-page">
      <h1>Investment Decision</h1>
      <form className="module-form" onSubmit={e => e.preventDefault()}>
        <label>Strategy
          <select value={strategy} onChange={e => { const v = e.target.value as InvestmentStrategy; setStrategy(v); localStorage.setItem('dd-strategy', v); }}>
            <option value="vc_early">Early VC</option><option value="growth">Growth</option><option value="pe_buyout">PE/Buyout</option>
          </select>
        </label>
        <label>Fatal Outcome
          <select value={fatalOutcome} onChange={e => { setFatalOutcome(e.target.value); localStorage.setItem('dd-fatal-outcome', e.target.value); }}>
            <option value="none">None</option><option value="conditional_cap">Conditional Cap</option><option value="pause">Pause</option><option value="reject">Reject</option>
          </select>
        </label>
        <label>Risk Penalty<input value={riskPenalty} onChange={e => { setRiskPenalty(e.target.value); localStorage.setItem('dd-risk-penalty', e.target.value); }} /></label>
        {DIMS.map(([k, l]) => (
          <label key={k}>{l} <small>({scores[k]})</small>
            <input type="range" min="0" max="100" value={scores[k]} onChange={e => update(k, e.target.value)} />
          </label>
        ))}
      </form>

      {tier && (
        <div className="results-grid">
          <div className="metric-card metric-card-primary">
            <strong style={{fontSize:'2.2rem'}}>{TIER_LABELS[tier] ?? tier}</strong>
            <span>Investment Decision</span>
          </div>
          {result.status === 'ok' && <>
            <div className="metric-card"><strong>{result.value.compositeScore ?? '-'}</strong><span>Composite Score</span></div>
            <div className="metric-card"><strong>{result.value.riskAdjustedScore ?? '-'}</strong><span>Risk-Adjusted</span></div>
          </>}
        </div>
      )}
      {result.status === 'ok' && <p style={{marginTop:20,lineHeight:1.8}}>{result.value.investRationale}</p>}
    </div>
  );
}
