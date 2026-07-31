import { useState, useCallback, useMemo } from 'react';
import { useParams, NavLink } from 'react-router-dom';
import { runInference } from '../../engines/inference/inference-orchestrator';
import type {
  InferenceSessionInput, InvestmentJudgmentOutput, ConfirmedFact,
  NextBestQuestion, InferenceNode, ConfidenceBand,
} from '../../domain/inference/types';

function pn(s: unknown): string { const v = parseFloat(String(s ?? '')); return isNaN(v) ? '' : String(v); }

/** Load confirmed facts from all analysis modules */
function loadFacts(projectId: string): ConfirmedFact[] {
  const facts: ConfirmedFact[] = [];
  const now = new Date().toISOString();
  const add = (metricId: string, value: string | boolean, unit?: string) => {
    if (value === '' || value === 'null' || value === 'undefined' || value === null) return;
    facts.push({ factId: `fact_${metricId}_${projectId}`, metricId, value, unit: unit || null, period: null, evidenceIds: [], confirmedBy: 'system', confirmedAt: now });
  };

  try {
    const co = JSON.parse(localStorage.getItem(`dd-p-${projectId}-company-overview`) || '{}');
    add('company_name', co.name || co.companyName || '');
    add('business_description', co.description || '');
    add('founded', co.founded || '');
    add('headquarters', co.headquarters || '');
    add('business_model', co.businessModel || '');
    add('website', co.website || '');
    add('employee_count', co.employeeCount || '');
  } catch {}

  try {
    const fin = JSON.parse(localStorage.getItem(`dd-p-${projectId}-financials`) || '{}');
    add('revenue', pn(fin.revenue || fin.revenue2025), '万元');
    add('revenue_2023', pn(fin.revenue2023), '万元');
    add('revenue_2024', pn(fin.revenue2024), '万元');
    add('revenue_2025', pn(fin.revenue2025), '万元');
    add('gross_profit', pn(fin.grossProfit || fin.grossProfit2025), '万元');
    add('net_income', pn(fin.netIncome), '万元');
    add('ebitda', pn(fin.ebitda), '万元');
    add('gross_margin', pn(fin.grossMargin), '%');
    add('operating_cash_flow', pn(fin.operatingCashFlow), '万元');
    add('free_cash_flow', pn(fin.freeCashFlow), '万元');
    add('cash_balance', pn(fin.cashBalance), '万元');
    add('burn_rate', pn(fin.burnRate), '万元/月');
    add('customer_count', pn(fin.customerCount), '个');
    add('arpu', pn(fin.arpu), '元');
    add('cac', pn(fin.cac), '元');
    add('ltv', pn(fin.ltv), '元');
    add('arr', pn(fin.arr), '万元');
    add('nrr', pn(fin.nrr), '%');
  } catch {}

  try {
    const ind = JSON.parse(localStorage.getItem(`dd-p-${projectId}-industry`) || '{}');
    add('industry', ind.industryName || ind.industry || '');
    add('tam', pn(ind.tam), '万元');
    add('sam', pn(ind.sam), '万元');
    add('som', pn(ind.som), '万元');
    add('market_growth', pn(ind.growthRate), '%');
  } catch {}

  try {
    const val = JSON.parse(localStorage.getItem(`dd-p-${projectId}-valuation`) || '{}');
    add('valuation', pn(val.entryValuation || val.valuation), '万元');
    add('target_irr', pn(val.targetIrr), '%');
    add('wacc', pn(val.wacc), '%');
  } catch {}

  try {
    const team = JSON.parse(localStorage.getItem(`dd-p-${projectId}-team-members`) || '[]');
    if (team.length > 0) {
      add('team_size', String(team.length), '人');
      const founders = team.filter((t: any) => t.isKey || t.role?.includes('创始人') || t.role?.includes('CEO'));
      if (founders.length > 0) add('founders', founders.map((f: any) => `${f.name}(${f.role})`).join(', '));
    }
  } catch {}

  try {
    const exit = JSON.parse(localStorage.getItem(`dd-p-${projectId}-exit`) || '{}');
    add('exit_valuation', pn(exit.exitValuation), '万元');
    add('ownership_pct', pn(exit.ownershipPct), '%');
    add('holding_years', pn(exit.holdingYears), '年');
    if (exit.moic) add('moic', pn(exit.moic), 'x');
    if (exit.irr) add('irr', pn(exit.irr), '%');
  } catch {}

  try {
    const finHistory = JSON.parse(localStorage.getItem(`dd-p-${projectId}-financing-history`) || '[]');
    add('funding_round_count', String(finHistory.length), '轮');
    const totalFunding = finHistory.reduce((s: number, r: any) => s + (parseFloat(r.amount) || 0), 0);
    if (totalFunding > 0) add('total_funding', String(totalFunding), '万元');
  } catch {}

  try {
    const sales = JSON.parse(localStorage.getItem(`dd-p-${projectId}-sales`) || '[]');
    add('customer_count_sales', String(sales.length), '个');
    const topRevenue = sales.reduce((max: number, s: any) => Math.max(max, parseFloat(s.revenue2025) || 0), 0);
    const totalRevenue = sales.reduce((s: number, c: any) => s + (parseFloat(c.revenue2025) || 0), 0);
    if (totalRevenue > 0 && topRevenue > 0) {
      add('customer_concentration', String(Math.round(topRevenue / totalRevenue * 100)), '%');
    }
  } catch {}

  try {
    const riskItems = JSON.parse(localStorage.getItem(`dd-p-${projectId}-risk-items`) || '[]');
    add('risk_item_count', String(riskItems.length), '项');
  } catch {}

  return facts;
}

// ── Component ──

const BAND_COLORS: Record<ConfidenceBand, string> = { high: '#70b8b0', medium: '#f0b870', low: '#f87171', blocked: '#ff4444' };
const BAND_LABELS: Record<ConfidenceBand, string> = { high: '高', medium: '中', low: '低', blocked: '阻断' };

function NodeCard({ node }: { node: InferenceNode }) {
  return (
    <div style={{ background: '#0d1f1f', padding: '8px 12px', borderRadius: 6, marginBottom: 6, borderLeft: `3px solid ${BAND_COLORS[node.confidence]}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#e0e0e0', fontSize: '0.85rem', fontWeight: 500 }}>{node.metricId}</span>
        <span style={{ fontSize: '0.7rem', color: BAND_COLORS[node.confidence], fontWeight: 'bold' }}>{BAND_LABELS[node.confidence]}</span>
      </div>
      {node.value && <div style={{ color: '#aaa', fontSize: '0.8rem', marginTop: 4 }}>{String(node.value)}</div>}
      {node.lowerBound && node.upperBound && (
        <div style={{ color: '#5a7a7a', fontSize: '0.7rem', marginTop: 2 }}>区间: [{node.lowerBound}, {node.upperBound}]</div>
      )}
      <div style={{ fontSize: '0.65rem', color: '#4a6a6a', marginTop: 4 }}>
        {node.kind === 'fact' ? '事实' : node.kind === 'calculation' ? '计算' : node.kind === 'inference' ? '推断' : node.kind === 'judgment' ? '判断' : '未知'}
      </div>
    </div>
  );
}

export function SmartAssessmentPage() {
  const { projectId = 'default' } = useParams<{ projectId: string }>();

  const [result, setResult] = useState<InvestmentJudgmentOutput | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const facts = useMemo(() => loadFacts(projectId), [projectId]);

  const handleRun = useCallback(() => {
    setRunning(true); setError('');
    try {
      const input: InferenceSessionInput = {
        version: '1', projectId,
        institutionPolicyVersion: '1.0.0',
        asOfDate: new Date().toISOString().slice(0, 10),
        confirmedFacts: facts,
        candidateFacts: [],
        requestedStrategy: 'growth_equity',
      };
      const output = runInference(input);
      setResult(output);
    } catch (e) {
      setError(e instanceof Error ? e.message : '推理引擎执行失败');
    } finally {
      setRunning(false);
    }
  }, [facts, projectId]);

  return (
    <div className="module-page">
      <NavLink to={`/projects/${projectId}`} style={{ color: '#70b8b0', fontSize: '0.85rem', marginBottom: 12, display: 'inline-block' }}>
        ← 返回项目总览
      </NavLink>
      <h1>🧠 智能投资初判</h1>
      <p style={{ color: '#8ba8a8', fontSize: '0.85rem', marginBottom: 16 }}>
        基于已录入的分析数据，自动进行企业原型分类、推理分析和置信度评估。
        系统会主动提出下一批最有价值的问题。
      </p>

      {/* Facts summary */}
      <div style={{ background: '#1a2a2a', padding: '12px 16px', borderRadius: 8, marginBottom: 16, border: '1px solid #2a4a4a' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#e0e0e0' }}>
            📊 已确认事实: <strong>{facts.length}</strong> 项
          </span>
          <button className="button" onClick={handleRun} disabled={running || facts.length === 0}
            style={{ background: running ? '#3a5a5a' : '#70b8b0', color: '#0d1a1a', fontWeight: 'bold', padding: '8px 20px' }}>
            {running ? '⏳ 推理中...' : '🚀 运行推理'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#2a1a1a', padding: '12px 16px', borderRadius: 8, marginBottom: 16, color: '#f87171', fontSize: '0.85rem' }}>
          ⚠️ {error}
        </div>
      )}

      {result && (
        <>
          {/* Archetype */}
          <div style={{ background: '#1a2a2a', padding: 16, borderRadius: 8, marginBottom: 16, border: '1px solid #2a4a4a' }}>
            <h3 style={{ color: '#e0e0e0', margin: '0 0 8px' }}>🏷️ 企业原型</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Tag color="#70b8b0">{result.archetype.primaryPackId}</Tag>
              {result.archetype.supplementalPackIds.map(p => <Tag key={p} color="#5a8a8a">{p}</Tag>)}
            </div>
            <div style={{ marginTop: 8, fontSize: '0.82rem', color: '#8ba8a8' }}>
              匹配度: {(parseFloat(result.archetype.matchScore) * 100).toFixed(1)}%
              {result.archetype.fallbackUsed && <span style={{ color: '#f0b870', marginLeft: 8 }}>⚠ 使用通用包</span>}
            </div>
            <div style={{ marginTop: 6 }}>
              {result.archetype.classificationReasons.map((r, i) => (
                <div key={i} style={{ fontSize: '0.78rem', color: '#6a8a8a' }}>• {r}</div>
              ))}
            </div>
            {result.archetype.confirmationQuestions.length > 0 && (
              <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#f0b870' }}>
                <strong>待确认:</strong>
                {result.archetype.confirmationQuestions.map((q, i) => (
                  <div key={i}>❓ {q}</div>
                ))}
              </div>
            )}
          </div>

          {/* Overall verdict */}
          <div style={{ background: '#1a2a2a', padding: 16, borderRadius: 8, marginBottom: 16, border: '1px solid #2a4a4a' }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <MetricBadge label="置信度" value={BAND_LABELS[result.overallConfidence]} color={BAND_COLORS[result.overallConfidence]} />
              <MetricBadge label="结论稳定性" value={result.stability === 'stable' ? '稳定' : result.stability === 'sensitive' ? '敏感' : '不稳定'} color={result.stability === 'stable' ? '#70b8b0' : result.stability === 'sensitive' ? '#f0b870' : '#f87171'} />
              <MetricBadge label="正式提交" value={result.formalSubmissionBlocked ? '已阻断' : '可提交'} color={result.formalSubmissionBlocked ? '#f87171' : '#70b8b0'} />
            </div>
            {result.blockingReasons.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {result.blockingReasons.map((r, i) => (
                  <div key={i} style={{ color: '#f87171', fontSize: '0.82rem' }}>🚫 {r}</div>
                ))}
              </div>
            )}
          </div>

          {/* Investment Thesis */}
          {result.investmentThesis.length > 0 && (
            <Section title="💡 投资逻辑">
              {result.investmentThesis.map(n => <NodeCard key={n.nodeId} node={n} />)}
            </Section>
          )}

          {/* Counter Thesis */}
          {result.strongestCounterThesis.length > 0 && (
            <Section title="⚠️ 反面逻辑">
              {result.strongestCounterThesis.map(n => <NodeCard key={n.nodeId} node={n} />)}
            </Section>
          )}

          {/* Operating */}
          {result.operatingAssessment.length > 0 && (
            <Section title="📊 经营评估">
              {result.operatingAssessment.map(n => <NodeCard key={n.nodeId} node={n} />)}
            </Section>
          )}

          {/* Financial */}
          {result.financialAssessment.length > 0 && (
            <Section title="💰 财务评估">
              {result.financialAssessment.map(n => <NodeCard key={n.nodeId} node={n} />)}
            </Section>
          )}

          {/* Next Best Questions */}
          {result.nextQuestions.length > 0 && (
            <Section title="🎯 下一最佳问题（按信息价值排序）">
              {result.nextQuestions.map((q, i) => (
                <div key={q.questionId} style={{
                  background: q.blocking ? '#2a1a1a' : '#1a2a2a',
                  padding: '12px 16px', borderRadius: 8, marginBottom: 8,
                  border: `1px solid ${q.blocking ? '#5a3a3a' : '#2a4a4a'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#e0e0e0', fontWeight: 'bold', fontSize: '0.9rem' }}>
                        {i + 1}. {q.prompt}
                      </div>
                      <div style={{ color: '#8ba8a8', fontSize: '0.78rem', marginTop: 4 }}>
                        为什么现在问: {q.reason}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                        {q.affectedOutputs.map(o => <Tag key={o} color="#3a5a5a">{o}</Tag>)}
                        {q.unit && <Tag color="#1a3a3a">{q.unit}</Tag>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', marginLeft: 16 }}>
                      <div style={{ fontSize: '0.7rem', color: '#5a7a7a' }}>信息价值</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#70b8b0' }}>
                        {(parseFloat(q.informationValue) * 100).toFixed(0)}%
                      </div>
                      {q.blocking && <div style={{ color: '#f87171', fontSize: '0.7rem', fontWeight: 'bold' }}>阻断</div>}
                    </div>
                  </div>
                </div>
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ color: '#e0e0e0', fontSize: '0.95rem', margin: '0 0 8px' }}>{title}</h3>
      {children}
    </div>
  );
}

function Tag({ children, color }: { children: string; color: string }) {
  return (
    <span style={{ background: color, color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 500 }}>
      {children}
    </span>
  );
}

function MetricBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '0.7rem', color: '#8ba8a8' }}>{label}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color }}>{value}</div>
    </div>
  );
}
