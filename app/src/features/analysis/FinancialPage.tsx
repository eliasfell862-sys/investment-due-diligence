import { useState, useMemo } from 'react';
import { AnalysisDecimal, canonicalDecimal } from '../../domain/analysis/decimal';

interface FinancialData {
  revenue: string; grossProfit: string; ebitda: string; netIncome: string;
  operatingCashFlow: string; freeCashFlow: string;
  customerCount: string; arpu: string; cac: string; ltv: string;
  burnRate: string; cashBalance: string;
}

function calc(a: string, b: string): string {
  try { const ad = new AnalysisDecimal(a); const bd = new AnalysisDecimal(b);
    return bd.isZero() ? '-' : canonicalDecimal(ad.div(bd)); } catch { return '-'; }
}
function pct(a: string, b: string): string {
  try { return canonicalDecimal(new AnalysisDecimal(a).div(b).times(100)) + '%'; } catch { return '-'; }
}

export function FinancialPage() {
  const [data, setData] = useState<FinancialData>(() => {
    const saved = localStorage.getItem('dd-financial-v2');
    return saved ? JSON.parse(saved) : { revenue: '', grossProfit: '', ebitda: '', netIncome: '', operatingCashFlow: '', freeCashFlow: '', customerCount: '', arpu: '', cac: '', ltv: '', burnRate: '', cashBalance: '' };
  });
  const save = (k: string, v: string) => { const n = { ...data, [k]: v }; setData(n); localStorage.setItem('dd-financial-v2', JSON.stringify(n)); };

  const ratios = useMemo(() => ({
    grossMargin: pct(data.grossProfit, data.revenue),
    ebitdaMargin: pct(data.ebitda, data.revenue),
    netMargin: pct(data.netIncome, data.revenue),
    fcfConversion: pct(data.freeCashFlow, data.ebitda),
    ltvCac: calc(data.ltv, data.cac),
    runway: data.burnRate ? calc(data.cashBalance, data.burnRate) : '-',
  }), [data]);

  const fields: [string, string][] = [
    ['revenue', '营业收入'], ['grossProfit', '毛利'], ['ebitda', 'EBITDA'], ['netIncome', '净利润'],
    ['operatingCashFlow', '经营现金流'], ['freeCashFlow', '自由现金流'],
    ['customerCount', '客户数'], ['arpu', 'ARPU'], ['cac', 'CAC'], ['ltv', 'LTV'],
    ['burnRate', '月消耗'], ['cashBalance', '现金余额'],
  ];

  return (
    <div className="module-page">
      <h1>财务分析</h1>
      <form className="module-form" onSubmit={(e) => e.preventDefault()}>
        <div className="form-grid">
          {fields.map(([k, l]) => (
            <label key={k}>{l}<input placeholder="0" value={(data as any)[k]} onChange={e => save(k, e.target.value)} /></label>
          ))}
        </div>
      </form>
      <h2>关键比率</h2>
      <div className="results-grid">
        <div className="metric-card"><strong>{ratios.grossMargin}</strong><span>毛利率</span></div>
        <div className="metric-card"><strong>{ratios.ebitdaMargin}</strong><span>EBITDA 率</span></div>
        <div className="metric-card"><strong>{ratios.netMargin}</strong><span>净利率</span></div>
        <div className="metric-card"><strong>{ratios.fcfConversion}</strong><span>FCF 转化</span></div>
        <div className="metric-card"><strong>{ratios.ltvCac}</strong><span>LTV/CAC</span></div>
        <div className="metric-card"><strong>{ratios.runway}</strong><span>现金跑道(月)</span></div>
      </div>
    </div>
  );
}
