import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { calculateValueBridge, generateBridgeNarrative, type ValueBridgeInput } from '../../engines/valuation/calculate-value-bridge';
import { WaterfallChart, type WaterfallStep } from './charts/WaterfallChart';

function parseNum(s: unknown): number { return parseFloat(String(s ?? '0')) || 0; }

export function ValueBridgePage() {
  const { projectId = 'default' } = useParams<{ projectId: string }>();
  const [showHelp, setShowHelp] = useState(false);

  // Pull data from existing modules
  const input: ValueBridgeInput | null = useMemo(() => {
    try {
      // Financial data
      const fin = JSON.parse(localStorage.getItem(`dd-p-${projectId}-financial`) || '{}');
      const ebitda = parseNum(fin.ebitda || fin.ebitda2025);

      // Valuation data
      const val = JSON.parse(localStorage.getItem(`dd-p-${projectId}-valuation`) || '{}');
      const entryEv = parseNum(val.entryValuation) || parseNum(val.fcfBase) * 10;

      // Exit data
      const exit = JSON.parse(localStorage.getItem(`dd-p-${projectId}-exit`) || '{}');
      const exitEv = parseNum(exit.exitValuation) || parseNum(exit.exitEquityValue);
      const exitMultiple = parseNum(exit.exitEvEbitda || exit.exitMultiple);

      // LBO data (if available)
      const lboData = JSON.parse(localStorage.getItem(`dd-p-${projectId}-lbo`) || '{}');
      const lboTranches = JSON.parse(localStorage.getItem(`dd-p-${projectId}-lbo-tranches`) || '[]');
      const lboProjections = JSON.parse(localStorage.getItem(`dd-p-${projectId}-lbo-projections`) || '[]');

      // Equity data
      const equity = JSON.parse(localStorage.getItem(`dd-p-${projectId}-equity`) || '{}');
      const investmentAmount = parseNum(equity.investmentAmount);

      if (ebitda <= 0) return null;

      const entryNetDebt = lboTranches.reduce((s: number, t: any) => s + (t.amount || 0), 0) - parseNum(lboData.minimumCash || '500');
      const totalFCF = (lboProjections as any[]).reduce((s: number, p: any) =>
        s + ((p.ebitda || 0) - (p.dda || 0)) * 0.75 + (p.dda || 0) - (p.capex || 0) - (p.nwcIncrease || 0), 0);

      return {
        entryEbitda: ebitda,
        entryEv: entryEv || ebitda * 10,
        entryNetDebt: entryNetDebt || investmentAmount * 2 || ebitda * 3,
        exitEbitda: lboProjections.length > 0 ? lboProjections[lboProjections.length - 1].ebitda : ebitda * 1.3,
        exitEv: exitEv || ebitda * 1.3 * (exitMultiple || 10),
        exitNetDebt: entryNetDebt > 0 ? entryNetDebt * 0.4 : 0,
        cumulativeFCF: totalFCF || ebitda * 0.5,
        additionalEquity: 0,
        dividends: 0,
        holdingYears: parseNum(val.holdingYears) || parseNum(exit.holdingYears) || parseNum(lboData.holdingYears) || 5,
      };
    } catch { return null; }
  }, [projectId]);

  const [manualInput, setManualInput] = useState<ValueBridgeInput | null>(null);
  const bridgeInput = manualInput || input;

  const result = useMemo(() => {
    if (!bridgeInput || bridgeInput.entryEbitda <= 0) return null;
    try { return calculateValueBridge(bridgeInput); } catch { return null; }
  }, [bridgeInput]);

  const narrative = result ? generateBridgeNarrative(result) : '';

  if (!input) {
    return (
      <div className="module-page">
        <h1>📊 回报归因 Value Bridge</h1>
        <p style={{color:'#8ba8a8'}}>需要先填写估值模型、财务分析和退出路径的数据，或手动输入参数。</p>
        <button className="button" onClick={() => setManualInput({
          entryEbitda: 1000, entryEv: 10000, entryNetDebt: 5000,
          exitEbitda: 1600, exitEv: 16000, exitNetDebt: 2000,
          cumulativeFCF: 500, additionalEquity: 0, dividends: 0, holdingYears: 5,
        })}>使用示例数据</button>
      </div>
    );
  }

  const fmt = (n: number) => Math.abs(n) >= 1e4 ? `${(n / 1e4).toFixed(1)}万` : n.toFixed(0);
  const barWidth = (v: number, max: number) => max > 0 ? Math.min(100, Math.max(3, Math.abs(v) / max * 100)) : 10;

  const maxAbsValue = result
    ? Math.max(...result.components.map(c => Math.abs(c.value)), 1)
    : 1;

  return (
    <div className="module-page">
      <h1>📊 回报归因 Value Bridge</h1>
      <p style={{color:'#8ba8a8',fontSize:'0.85rem',marginBottom:16}}>
        将总回报拆解为 EBITDA 增长、估值倍数变化、债务偿还、FCF 积累——回答"这笔钱怎么赚的"。
        <button className="button" style={{marginLeft:12,fontSize:'0.75rem'}}
          onClick={() => setShowHelp(!showHelp)}>{showHelp ? '收起说明' : '展开说明'}</button>
      </p>

      {showHelp && (
        <div style={{background:'#1a2a2a',padding:'12px 16px',borderRadius:8,marginBottom:16,fontSize:'0.8rem',lineHeight:1.6,color:'#aac'}}>
          <strong>PE 投资回报的五大来源：</strong><br/>
          1. <strong>EBITDA 增长</strong> — 公司本身的经营改善（最健康）<br/>
          2. <strong>估值倍数扩张</strong> — 市场重新定价（不可控，需警惕依赖）<br/>
          3. <strong>债务偿还</strong> — 杠杆的机械效应（PE 的核心武器）<br/>
          4. <strong>FCF 积累</strong> — 持有期内产生的现金<br/>
          5. <strong>分红/追加投资</strong> — 期间的资本分配<br/>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Entry / Exit Summary */}
          <h2>投资概览</h2>
          <div className="results-grid">
            <div className="metric-card"><strong>{fmt(result.entryEquityValue)}</strong><span>进入股权价值</span></div>
            <div className="metric-card"><strong>{fmt(result.exitEquityValue)}</strong><span>退出股权价值</span></div>
            <div className="metric-card"><strong style={{color:result.totalReturn>=0?'#70b8b0':'#f87171'}}>{fmt(result.totalReturn)}</strong><span>总回报</span></div>
            <div className="metric-card"><strong>{result.moic}x</strong><span>MOIC</span></div>
            <div className="metric-card"><strong>{result.irr}%</strong><span>IRR</span></div>
            <div className="metric-card"><strong>{result.explainedPercent}%</strong><span>解释度</span></div>
          </div>

          {/* Bridge Waterfall */}
          <h2>回报拆解</h2>
          <div style={{marginBottom:24}}>
            {result.components.map((c, i) => {
              const isPositive = c.value >= 0;
              const width = barWidth(c.value, maxAbsValue);
              return (
                <div key={i} style={{marginBottom:10}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:3,fontSize:'0.85rem'}}>
                    <span>{c.label} <span style={{fontSize:'0.7rem',color:'#8ba8a8'}}>({c.labelEn})</span></span>
                    <span style={{color:isPositive?'#70b8b0':'#f87171',fontWeight:'bold'}}>
                      {isPositive ? '+' : ''}{fmt(c.value)}
                      <span style={{fontSize:'0.7rem',marginLeft:6,color:'#8ba8a8'}}>{c.percentOfTotal}%</span>
                    </span>
                  </div>
                  <div style={{background:'#2a2a2a',borderRadius:4,height:20,position:'relative'}}>
                    <div style={{
                      position:'absolute',left:isPositive ? undefined : `${50 - width/2}%`,right:isPositive ? `${100 - width/2}%` : undefined,
                      width:`${width/2}%`,height:'100%',borderRadius:4,
                      background: isPositive ? 'linear-gradient(90deg,#1a5c5c,#70b8b0)' : 'linear-gradient(90deg,#f87171,#5c1a1a)',
                      transition:'width 0.3s',
                    }}/>
                    {/* Center line for zero */}
                    <div style={{position:'absolute',left:'50%',width:1,height:'100%',background:'#555'}}/>
                  </div>
                  <div style={{fontSize:'0.72rem',color:'#6a8a8a',marginTop:2}}>{c.description}</div>
                </div>
              );
            })}
          </div>

          {/* SVG Waterfall */}
          {result.components.filter(c => c.labelEn !== 'Unexplained').length > 0 && (
            <div style={{margin:'24px 0'}}>
              <WaterfallChart
                title="Value Bridge 瀑布图"
                steps={(() => {
                  const steps: WaterfallStep[] = [
                    { label: '进入EV', value: result.entryEquityValue + (bridgeInput?.entryNetDebt ?? 0), isTotal: false },
                  ];
                  const mainComps = result.components.filter(c => c.labelEn !== 'Unexplained');
                  for (const c of mainComps) {
                    steps.push({ label: c.label, value: c.value, isTotal: false });
                  }
                  steps.push({ label: '退出EV', value: result.exitEquityValue + (bridgeInput?.exitNetDebt ?? 0), isTotal: true });
                  return steps;
                })()}
                valueFormatter={(v) => v >= 10000 ? `${(v/10000).toFixed(1)}万` : v.toFixed(0)}
              />
            </div>
          )}

          {/* Narrative */}
          <h2>一句话总结</h2>
          <div style={{background:'#1a2a2a',padding:'16px',borderRadius:8,marginBottom:24,border:'1px solid #2a4a4a'}}>
            <p style={{lineHeight:1.8,color:'#ddd'}}>{narrative}</p>
          </div>

          {/* Quality Assessment */}
          <h2>回报质量评估</h2>
          <div className="results-grid">
            {(() => {
              const ebitdaComp = result.components.find(c => c.labelEn === 'EBITDA Growth');
              const multComp = result.components.find(c => c.labelEn === 'Multiple Expansion');
              const debtComp = result.components.find(c => c.labelEn === 'Debt Paydown');
              const ebitdaPct = Math.abs(ebitdaComp?.percentOfTotal ?? 0);
              const multPct = Math.abs(multComp?.percentOfTotal ?? 0);
              const debtPct = Math.abs(debtComp?.percentOfTotal ?? 0);

              return (
                <>
                  <div className="metric-card">
                    <strong style={{color: ebitdaPct > 40 ? '#70b8b0' : '#f0b870'}}>{ebitdaPct}%</strong>
                    <span>经营驱动占比{'\n'}{ebitdaPct > 40 ? '✅ 经营质量高' : ebitdaPct > 20 ? '⚠️ 依赖其他因素' : '❌ 经营贡献不足'}</span>
                  </div>
                  <div className="metric-card">
                    <strong style={{color: multPct < 20 ? '#70b8b0' : '#f0b870'}}>{multPct}%</strong>
                    <span>倍数依赖度{'\n'}{multPct < 20 ? '✅ 倍数影响可控' : multPct < 40 ? '⚠️ 需注意市场风险' : '❌ 过度依赖倍数扩张'}</span>
                  </div>
                  <div className="metric-card">
                    <strong style={{color: debtPct > 10 ? '#70b8b0' : '#8ba8a8'}}>{debtPct}%</strong>
                    <span>杠杆贡献{'\n'}{debtPct > 10 ? '✅ 杠杆策略有效' : '杠杆效应有限'}</span>
                  </div>
                  <div className="metric-card">
                    <strong style={{color: result.explainedPercent > 90 ? '#70b8b0' : '#f0b870'}}>{result.explainedPercent}%</strong>
                    <span>模型解释度{'\n'}{result.explainedPercent > 90 ? '✅ 归因完整' : '⚠️ 存在交叉效应'}</span>
                  </div>
                </>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}
