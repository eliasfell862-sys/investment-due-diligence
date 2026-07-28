import { useState, useMemo } from 'react';
import { evaluateRisk } from '../../engines/risk/evaluate-risk';
import type { RiskCategory, RiskItemInput, FatalFlawCheckInput, RiskAssessment, RiskLight } from '../../engines/risk/risk-types';

const CATEGORIES: RiskCategory[] = ['market', 'technology', 'customer', 'financial', 'financing', 'legal_compliance', 'governance', 'data_authenticity', 'exit'];
const FATAL_IDS = ['material_data_or_business_fraud', 'core_ownership_or_license_unclear', 'irremediable_major_illegality', 'business_model_unverifiable', 'pre_close_cash_break', 'founder_integrity_failure'] as const;
const FATAL_LABELS: Record<string, string> = {
  material_data_or_business_fraud: '财务/业务数据重大造假',
  core_ownership_or_license_unclear: '核心权属或许可不清',
  irremediable_major_illegality: '重大违法违规无法补救',
  business_model_unverifiable: '商业模式无法验证',
  pre_close_cash_break: '资金链在交割前可能断裂',
  founder_integrity_failure: '创始人严重诚信问题',
};

const LIGHT_LABEL: Record<RiskLight, string> = { green: '绿', yellow: '黄', red: '红' };

export function RiskAssessmentPage() {
  const [items, setItems] = useState<RiskItemInput[]>(() => {
    const saved = localStorage.getItem('dd-risk-items');
    return saved ? JSON.parse(saved) : [];
  });
  const [flaws, setFlaws] = useState<FatalFlawCheckInput[]>(() =>
    FATAL_IDS.map((id) => ({ fatalFlawId: id, status: 'clear' as const, evidenceRefs: [] })),
  );

  const addItem = () => {
    setItems([...items, { riskId: crypto.randomUUID(), category: 'market', title: '', probability: '0.5', impact: '0.5', mitigationEffectiveness: '0' }]);
  };
  const updateItem = (id: string, field: keyof RiskItemInput, value: unknown) => {
    const next = items.map((i) => i.riskId === id ? { ...i, [field]: value } : i);
    setItems(next);
    localStorage.setItem('dd-risk-items', JSON.stringify(next));
  };
  const removeItem = (id: string) => {
    const next = items.filter((i) => i.riskId !== id);
    setItems(next);
    localStorage.setItem('dd-risk-items', JSON.stringify(next));
  };
  const updateFlaw = (id: string, field: string, value: unknown) => {
    setFlaws(flaws.map((f) => f.fatalFlawId === id ? { ...f, [field]: value } : f));
  };

  const result = useMemo(() => {
    if (items.length === 0) return null;
    return evaluateRisk({
      version: '1',
      asOfDate: new Date().toISOString().slice(0, 10),
      riskItems: items,
      fatalFlaws: flaws,
    });
  }, [items, flaws]);

  const assessment: RiskAssessment | null = result?.status === 'ok' ? result.value : null;

  return (
    <div className="module-page">
      <h1>风险评估</h1>

      <section>
        <h2>风险项 ({items.length})</h2>
        <button onClick={addItem} className="primary-link">+ 添加风险</button>
        {items.map((item) => (
          <div key={item.riskId} className="card">
            <div className="flex-row">
              <select value={item.category} onChange={(e) => updateItem(item.riskId, 'category', e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input placeholder="风险标题" value={item.title} onChange={(e) => updateItem(item.riskId, 'title', e.target.value)} />
            </div>
            <div className="flex-row">
              <label>概率<input type="number" min="0" max="1" step="0.1" value={item.probability} onChange={(e) => updateItem(item.riskId, 'probability', e.target.value)} /></label>
              <label>影响<input type="number" min="0" max="1" step="0.1" value={item.impact} onChange={(e) => updateItem(item.riskId, 'impact', e.target.value)} /></label>
              <label>缓释<input type="number" min="0" max="1" step="0.1" value={item.mitigationEffectiveness} onChange={(e) => updateItem(item.riskId, 'mitigationEffectiveness', e.target.value)} /></label>
            </div>
            <button onClick={() => removeItem(item.riskId)} className="danger">删除</button>
          </div>
        ))}
      </section>

      <section>
        <h2>致命缺陷检查</h2>
        {FATAL_IDS.map((id) => (
          <div key={id} className="flex-row">
            <span>{FATAL_LABELS[id]}</span>
            <select value={flaws.find((f) => f.fatalFlawId === id)!.status} onChange={(e) => updateFlaw(id, 'status', e.target.value)}>
              <option value="clear">Clear</option>
              <option value="open">Open</option>
              <option value="covered">Covered</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
        ))}
      </section>

      {assessment && (
        <section>
          <h2>分析结果</h2>
          <div className="results-grid">
            <div className="metric-card">
              <strong>{assessment.overall.light ? LIGHT_LABEL[assessment.overall.light] : '—'}</strong>
              <span>总体灯号</span>
            </div>
            <div className="metric-card">
              <strong>{assessment.overall.residualRisk ?? '—'}</strong>
              <span>残余风险</span>
            </div>
            <div className="metric-card">
              <strong>{assessment.overall.riskPenalty ?? '—'}</strong>
              <span>风险惩罚</span>
            </div>
            <div className="metric-card">
              <strong>{assessment.fatalFlaws.fatalOutcome === 'none' ? '无' : assessment.fatalFlaws.fatalOutcome}</strong>
              <span>致命缺陷结论</span>
            </div>
          </div>
          <h3>九类矩阵</h3>
          <table className="data-table">
            <thead><tr><th>类别</th><th>状态</th><th>风险值</th><th>灯号</th><th>条款数</th></tr></thead>
            <tbody>
              {assessment.categoryMatrix.map((row) => (
                <tr key={row.category}>
                  <td>{row.category}</td>
                  <td>{row.status === 'assessed' ? '已评估' : '未评估'}</td>
                  <td>{row.residualRisk ?? '—'}</td>
                  <td>{row.light ? LIGHT_LABEL[row.light] : '—'}</td>
                  <td>{row.clauseRecommendationCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {assessment.permanentLoss && (
            <div className="loss-info">
              <strong>Permanent Loss:</strong> [{assessment.permanentLoss.lower}, {assessment.permanentLoss.upper}]
              &nbsp;|&nbsp;
              <strong>Drawdown:</strong> [{assessment.temporaryDrawdown.lower}, {assessment.temporaryDrawdown.upper}]
            </div>
          )}

          {assessment.clauseRecommendations.length > 0 && (
            <>
              <h3>条款建议 ({assessment.clauseRecommendations.length})</h3>
              <table className="data-table">
                <thead><tr><th>优先级</th><th>条款类型</th><th>来源风险</th><th>保护机制</th><th>需法务审核</th></tr></thead>
                <tbody>
                  {assessment.clauseRecommendations.map((c) => (
                    <tr key={c.clauseId}>
                      <td><span className={`status-badge ${c.negotiationPriority === 'must_have' ? 'status-danger' : 'status-warning'}`}>{c.negotiationPriority === 'must_have' ? 'Must' : 'High'}</span></td>
                      <td>{c.clauseType}</td>
                      <td>{c.sourceRiskIds.join(', ')}</td>
                      <td style={{maxWidth:300,fontSize:'0.8rem'}}>{c.protectionMechanism}</td>
                      <td>{c.legalReviewRequired ? 'Yes' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{color:'var(--ink-500)',fontSize:'0.78rem',marginTop:8}}>{assessment.clauseRecommendations[0]?.disclaimer}</p>
            </>
          )}

          {assessment.verificationChecklist.length > 0 && (
            <>
              <h3>验证清单</h3>
              <ul>
                {assessment.verificationChecklist.map((v) => (
                  <li key={v.checklistId}>{v.description}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
