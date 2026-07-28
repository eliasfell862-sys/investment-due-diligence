import { useState, useCallback } from 'react';
import {
  loadResearchConfig, saveResearchConfig, clearResearchConfig,
  executeResearch, isOnline, PROVIDER_PRESETS,
  type ResearchConfig, type ResearchProvider, type ResearchQuery, type ResearchResult,
} from '../../infrastructure/research/research-adapter';

const TOPICS: ResearchQuery['topic'][] = ['industry', 'competitors', 'market_size', 'policy'];

export function ResearchPage() {
  const [config, setConfig] = useState<ResearchConfig | null>(() => loadResearchConfig());
  const [apiKey, setApiKey] = useState(() => config?.apiKey ?? '');
  const [provider, setProvider] = useState<ResearchProvider>(() => config?.provider ?? 'ollama');
  const needsKey = PROVIDER_PRESETS[provider]?.needsKey !== false;
  const [endpoint, setEndpoint] = useState(() => config?.endpoint ?? PROVIDER_PRESETS[config?.provider ?? 'ollama']?.endpoint ?? '');
  const [model, setModel] = useState(() => config?.model || PROVIDER_PRESETS[config?.provider ?? 'ollama']?.defaultModel || '');

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

  const saveConfig = useCallback(() => {
    const preset = PROVIDER_PRESETS[provider];
    const cfg: ResearchConfig = {
      provider,
      apiKey: needsKey ? apiKey : undefined,
      endpoint: endpoint || preset?.endpoint || undefined,
      model: model || preset?.defaultModel || undefined,
    };
    saveResearchConfig(cfg);
    setConfig(cfg);
  }, [provider, apiKey, endpoint, model, needsKey]);

  const clearConfig = useCallback(() => {
    clearResearchConfig();
    setConfig(null);
    setApiKey('');
    setError(null);
  }, []);

  const run = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    setError(null);
    try {
      const query: ResearchQuery = { topic, companyName, industry: industry || undefined, region };
      const r = await executeResearch(config, query);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Research failed');
    } finally { setLoading(false); }
  }, [config, topic, companyName, industry, region]);

  const online = isOnline();

  return (
    <div className="module-page">
      <h1>AI Research</h1>
      <p style={{color:'var(--ink-500)',marginBottom:24}}>
        Configure an API key to enable AI-powered industry, competitor and policy research.
        All queries include source annotations and dates. Data is sent only when you explicitly run a query.
      </p>

      {!online && <div className="loss-info">Offline — research requires internet connectivity.</div>}

      <h2>API Configuration</h2>
      {!config ? (
        <form className="module-form" onSubmit={e => { e.preventDefault(); saveConfig(); }}>
          <label>Provider<select value={provider} onChange={e => {
            const p = e.target.value as ResearchProvider;
            setProvider(p);
            const preset = PROVIDER_PRESETS[p];
            if (preset) {
              if (preset.endpoint) setEndpoint(preset.endpoint);
              if (preset.defaultModel) setModel(preset.defaultModel);
            }
          }}>
            <option value="ollama">Ollama (本地免费)</option>
            <option value="deepseek">DeepSeek</option>
            <option value="kimi">Kimi (Moonshot)</option>
            <option value="openai">OpenAI</option>
            <option value="custom">Custom</option>
          </select></label>
          {needsKey && <label>API Key<input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." /></label>}
          {!needsKey && <div className="loss-info" style={{background:'#dff3e6',borderLeftColor:'#16766f'}}>Ollama 本地运行，无需 API Key。请确保 Ollama 已启动且模型已拉取。</div>}
          {provider === 'custom' && <label>Endpoint<input value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://api.openai.com/v1/chat/completions" /></label>}
          <label>Model (optional)<input value={model} onChange={e => setModel(e.target.value)} placeholder="gpt-4o-mini" /></label>
          <button className="button button-primary" type="submit" disabled={needsKey && !apiKey}>Save Configuration</button>
        </form>
      ) : (
        <div className="loss-info" style={{background:'#dff3e6',borderLeftColor:'#16766f'}}>
          Configured: {config.provider} {config.model && `(${config.model})`}
          <button className="danger" style={{marginLeft:16}} onClick={clearConfig}>Remove</button>
        </div>
      )}

      {config && (
        <>
          <h2>Research Query</h2>
          <form className="module-form" onSubmit={e => { e.preventDefault(); run(); }}>
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
