import { useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { executeAiTask, AiGatewayError } from '../ai-agents/ai-gateway';
import { useAiVault } from '../ai-agents/useAiVault';
import {
  buildResearchQueryPrompt, buildResearchSystemPrompt, isOnline, parseResearchResponse,
  type ResearchQuery, type ResearchResult,
} from '../../infrastructure/research/research-adapter';

const TOPICS: ResearchQuery['topic'][] = ['industry', 'competitors', 'market_size', 'policy'];

export function ResearchPage() {
  const { projectId = 'default' } = useParams<{ projectId: string }>();
  const vault = useAiVault();
  const configured = !vault.locked && vault.settings !== null;

  const [topic, setTopic] = useState<ResearchQuery['topic']>('industry');
  const [companyName, setCompanyName] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dd-company-overview')||'{}').name || ''; } catch { return ''; }
  });
  const [industry, setIndustry] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dd-industry')||'{}').chainMid || ''; } catch { return ''; }
  });
  const [region, setRegion] = useState('China');

  const [result, setResult] = useState<ResearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!configured || !vault.settings) return;
    setLoading(true);
    setError(null);
    try {
      const query: ResearchQuery = { topic, companyName, industry: industry || undefined, region };
      const response = await executeAiTask({
        taskId: 'due_diligence.research',
        systemPrompt: buildResearchSystemPrompt(),
        userPrompt: buildResearchQueryPrompt(query),
        responseFormat: 'text',
      }, {
        settings: vault.settings,
        resolveSecret: vault.resolveSecret,
        fetchImpl: fetch,
      });
      setResult(parseResearchResponse(response.content, query, response.providerId, response.model));
    } catch (err) {
      setError(err instanceof AiGatewayError ? err.userMessage : err instanceof Error ? err.message : 'Research failed');
    } finally { setLoading(false); }
  }, [configured, vault.settings, vault.resolveSecret, topic, companyName, industry, region]);

  const online = isOnline();

  return (
    <div className="module-page">
      <Link to={`/projects/${projectId}`} style={{color:'var(--teal)',fontSize:'0.85rem',display:'inline-block',marginBottom:12}}>← 返回项目总览</Link>
      <h1>AI Research</h1>
      <p style={{color:'var(--ink-500)',marginBottom:24}}>
        AI 配置统一在 AI Agent 配置页管理，密钥只保存在本机加密密钥库中。
        All queries include source annotations and dates. Data is sent only when you explicitly run a query.
      </p>

      {!online && <div className="loss-info">Offline — research requires internet connectivity.</div>}

      {!configured ? (
        <div className="loss-info">
          本机 AI 密钥库未解锁或未配置模型，无法使用 AI 研究。
          <Link to="/ai-agents" style={{marginLeft:8,color:'var(--teal)'}}>配置 AI Agent</Link>
        </div>
      ) : (
        <>
          <h2>Research Query</h2>
          <form className="module-form" onSubmit={e => { e.preventDefault(); void run(); }}>
            <label>Topic<select value={topic} onChange={e => setTopic(e.target.value as ResearchQuery['topic'])}>
              {TOPICS.map(t => <option key={t} value={t}>{t}</option>)}
            </select></label>
            <label>Company<input value={companyName} onChange={e => setCompanyName(e.target.value)} /></label>
            <label>Industry<input value={industry} onChange={e => setIndustry(e.target.value)} /></label>
            <label>Region<input value={region} onChange={e => setRegion(e.target.value)} /></label>
            <button className="button button-primary" type="submit" disabled={loading || !online}>
              {loading ? 'Researching...' : 'Run Research'}
            </button>
          </form>
        </>
      )}

      {error && <div className="loss-info" style={{marginTop:16}}>{error}</div>}

      {result && (
        <section style={{marginTop:24,background:'var(--paper-light)',border:'1px solid var(--line)',padding:24}}>
          <h2>Results</h2>
          <p style={{color:'var(--ink-500)',fontSize:'0.8rem'}}>Retrieved: {result.retrievedAt} · Provider: {result.provider} · Model: {result.model}</p>
          <div style={{whiteSpace:'pre-wrap',lineHeight:1.8,margin:'16px 0'}}>{result.summary}</div>
          {result.sources.length > 0 && (
            <>
              <h3>Sources ({result.sources.length})</h3>
              <ul>
                {result.sources.map((s, i) => (
                  <li key={i} style={{marginBottom:8}}>
                    {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title}
                    {s.date && <small style={{color:'var(--ink-500)'}}> ({s.date})</small>}
                    <br /><small style={{color:'var(--ink-500)'}}>{s.snippet}</small>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
