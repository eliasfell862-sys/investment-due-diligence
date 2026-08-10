import { useEffect, useMemo, useState } from 'react';

import { testAiConnection } from './ai-gateway';
import { AiGatewayError } from './ai-provider-adapter';
import { detectLegacyResearchConfig, migrateLegacyResearchConfig, type LegacyConfigPreview } from './legacy-config-migration';
import { AI_PROVIDER_PRESETS, validateAiEndpoint } from './provider-presets';
import type { AiAgentSettings, AiFeatureGroup, AiModelProfile, AiProviderId } from './types';
import { useAiVault } from './useAiVault';

const PROVIDERS = Object.values(AI_PROVIDER_PRESETS);

function profileFromProvider(providerId: AiProviderId): AiModelProfile {
  const preset = AI_PROVIDER_PRESETS[providerId];
  return {
    providerId,
    model: preset.defaultModel,
    endpoint: preset.endpoint,
    temperature: 0.2,
    maxOutputTokens: 2_000,
  };
}

function initialSettings(): AiAgentSettings {
  return {
    defaultProfile: profileFromProvider('deepseek'),
    featureOverrides: {},
    connectionStatuses: {},
    updatedAt: new Date().toISOString(),
  };
}

interface ProfileEditorProps {
  title: string;
  profile: AiModelProfile;
  onChange(profile: AiModelProfile): void;
  pendingKey: string;
  onKeyChange(value: string): void;
  keyTail: string | null;
  disabled?: boolean;
  onTest(): Promise<void>;
  testing: boolean;
}

function ProfileEditor(props: ProfileEditorProps) {
  const preset = AI_PROVIDER_PRESETS[props.profile.providerId];
  const update = (patch: Partial<AiModelProfile>) => props.onChange({ ...props.profile, ...patch });

  return (
    <div>
      <div className="section-heading">
        <h2>{props.title}</h2>
        <p>选择供应商、模型和兼容接口。保存的 Key 只能替换或删除，不能再次显示。</p>
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${props.title}-provider`}>供应商</label>
          <select
            id={`${props.title}-provider`}
            value={props.profile.providerId}
            disabled={props.disabled}
            onChange={(event) => props.onChange(profileFromProvider(event.target.value as AiProviderId))}
          >
            {PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${props.title}-model`}>模型名称</label>
          <input id={`${props.title}-model`} value={props.profile.model} disabled={props.disabled} onChange={(event) => update({ model: event.target.value })} />
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor={`${props.title}-endpoint`}>Endpoint</label>
          <input id={`${props.title}-endpoint`} value={props.profile.endpoint} disabled={props.disabled} onChange={(event) => update({ endpoint: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={`${props.title}-temperature`}>Temperature</label>
          <input id={`${props.title}-temperature`} type="number" min="0" max="2" step="0.1" value={props.profile.temperature} disabled={props.disabled} onChange={(event) => update({ temperature: Number(event.target.value) })} />
        </div>
        <div className="field">
          <label htmlFor={`${props.title}-tokens`}>最大输出 Token</label>
          <input id={`${props.title}-tokens`} type="number" min="1" value={props.profile.maxOutputTokens} disabled={props.disabled} onChange={(event) => update({ maxOutputTokens: Number(event.target.value) })} />
        </div>
        {preset.needsKey && (
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor={`${props.title}-key`}>API Key（留空则保留现有 Key）</label>
            <input id={`${props.title}-key`} type="password" autoComplete="new-password" value={props.pendingKey} disabled={props.disabled} onChange={(event) => props.onKeyChange(event.target.value)} />
            {props.keyTail && <small>已保存：<span>{`•••• ${props.keyTail}`}</span></small>}
          </div>
        )}
      </div>
      <div className="form-actions">
        <button className="button" type="button" disabled={props.disabled || props.testing || (preset.needsKey && !props.pendingKey && !props.keyTail)} onClick={() => void props.onTest()}>
          {props.testing ? '正在测试…' : '连接测试'}
        </button>
      </div>
    </div>
  );
}

export function AiAgentSettingsPage() {
  const vault = useAiVault();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [defaultProfile, setDefaultProfile] = useState(() => profileFromProvider('deepseek'));
  const [dueDiligenceProfile, setDueDiligenceProfile] = useState(() => profileFromProvider('deepseek'));
  const [securitiesProfile, setSecuritiesProfile] = useState(() => profileFromProvider('deepseek'));
  const [dueDiligenceEnabled, setDueDiligenceEnabled] = useState(false);
  const [securitiesEnabled, setSecuritiesEnabled] = useState(false);
  const [keys, setKeys] = useState<Record<'default' | AiFeatureGroup, string>>({ default: '', due_diligence: '', securities: '' });
  const [message, setMessage] = useState<string | null>(null);
  const [testingScope, setTestingScope] = useState<string | null>(null);
  const [clearPhrase, setClearPhrase] = useState('');
  const [showReset, setShowReset] = useState(false);
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetting, setResetting] = useState(false);
  const [legacyPreview, setLegacyPreview] = useState<LegacyConfigPreview | null>(null);
  const [legacyConfirmed, setLegacyConfirmed] = useState(false);
  const [migrating, setMigrating] = useState(false);

  useEffect(() => {
    if (!vault.settings) return;
    setDefaultProfile(vault.settings.defaultProfile);
    setDueDiligenceProfile(vault.settings.featureOverrides.due_diligence ?? vault.settings.defaultProfile);
    setSecuritiesProfile(vault.settings.featureOverrides.securities ?? vault.settings.defaultProfile);
    setDueDiligenceEnabled(Boolean(vault.settings.featureOverrides.due_diligence));
    setSecuritiesEnabled(Boolean(vault.settings.featureOverrides.securities));
  }, [vault.settings]);

  // 仅在解锁状态下检测旧配置；绝不自动迁移，必须用户勾选确认后手动导入。
  useEffect(() => {
    if (vault.locked || !vault.settings) {
      setLegacyPreview(null);
      setLegacyConfirmed(false);
      return;
    }
    const detected = detectLegacyResearchConfig();
    setLegacyPreview(detected.status === 'found' ? detected.preview : null);
  }, [vault.locked, vault.settings]);

  const handleMigrateLegacy = async () => {
    setMigrating(true);
    setMessage(null);
    try {
      const result = await migrateLegacyResearchConfig({
        setSecret: vault.setSecret,
        saveSettings: vault.saveSettings,
        getSnapshot: vault.getSnapshot,
      });
      if (result.status === 'migrated') {
        setMessage('旧版研究配置已加密导入本机密钥库，原始配置已删除');
        setLegacyPreview(null);
        setLegacyConfirmed(false);
      } else if (result.status === 'invalid') {
        setMessage('旧配置格式无法识别，未做任何修改');
      } else {
        setLegacyPreview(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setMigrating(false); }
  };

  const descriptorTails = useMemo(() => Object.fromEntries(vault.secretDescriptors.map((item) => [item.id, item.lastFour])), [vault.secretDescriptors]);
  const secretId = (scope: 'default' | AiFeatureGroup, profile: AiModelProfile) => `${scope}:${profile.providerId}`;
  const keyTail = (scope: 'default' | AiFeatureGroup, profile: AiModelProfile) => descriptorTails[profile.secretId ?? secretId(scope, profile)] ?? null;

  const handleResetLockedVault = async () => {
    if (resetPhrase !== '清空密钥库') return;
    setResetting(true);
    setMessage(null);
    try {
      await vault.clearVault();
      setPassword('');
      setResetPhrase('');
      setShowReset(false);
      setMessage('本机 AI 密钥库已清空，请重新创建密钥库并填写 API Key');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setResetting(false);
    }
  };

  const handleCreate = async () => {
    setMessage(null);
    if (password !== confirmPassword) return setMessage('两次输入的密钥库密码不一致');
    try {
      await vault.createVault(password, initialSettings());
      setPassword(''); setConfirmPassword('');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  const handleUnlock = async () => {
    try { await vault.unlock(password); setPassword(''); setMessage(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  const saveProfileKey = async (scope: 'default' | AiFeatureGroup, profile: AiModelProfile): Promise<AiModelProfile> => {
    validateAiEndpoint(profile);
    const preset = AI_PROVIDER_PRESETS[profile.providerId];
    if (!preset.needsKey) return { ...profile, secretId: undefined };
    const id = secretId(scope, profile);
    const pending = keys[scope].trim();
    if (pending) await vault.setSecret(id, profile.providerId, pending);
    if (!pending && !descriptorTails[profile.secretId ?? id]) throw new Error(`请为${scope === 'default' ? '全站默认模型' : '功能覆盖模型'}填写 API Key`);
    return { ...profile, secretId: id };
  };

  const handleSave = async () => {
    try {
      const savedDefault = await saveProfileKey('default', defaultProfile);
      const due = dueDiligenceEnabled ? await saveProfileKey('due_diligence', dueDiligenceProfile) : undefined;
      const sec = securitiesEnabled ? await saveProfileKey('securities', securitiesProfile) : undefined;
      await vault.saveSettings({
        defaultProfile: savedDefault,
        featureOverrides: { ...(due && { due_diligence: due }), ...(sec && { securities: sec }) },
        connectionStatuses: vault.settings?.connectionStatuses ?? {},
        updatedAt: new Date().toISOString(),
      });
      setKeys({ default: '', due_diligence: '', securities: '' });
      setMessage('AI Agent 配置已加密保存到当前浏览器');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  const handleTest = async (scope: 'default' | AiFeatureGroup, profile: AiModelProfile) => {
    setTestingScope(scope); setMessage(null);
    try {
      const id = profile.secretId ?? secretId(scope, profile);
      const key = keys[scope].trim() || vault.resolveSecret(id);
      const result = await testAiConnection(profile, key, fetch);
      setMessage(`连接成功：${result.model}，${result.latencyMs} ms`);
    } catch (error) {
      setMessage(error instanceof AiGatewayError ? error.userMessage : error instanceof Error ? error.message : String(error));
    } finally { setTestingScope(null); }
  };

  if (vault.loading) return <div role="status">正在读取本机 AI 密钥库…</div>;

  return (
    <div>
      <header className="form-header">
        <p className="eyebrow">03 / Local AI Control</p>
        <h1>AI Agent 配置</h1>
        <p className="page-intro">选择客户自己的后端大模型。API Key 只在本机当前浏览器中加密保存，不上传平台数据库。</p>
      </header>
      <div className="project-form">
        <section className="form-section">
          <span className="section-number">01</span>
          <div>
            <div className="section-heading"><h2>本机 AI 密钥库</h2><p>刷新、退出登录、切换账户或后台停留 30 分钟后会重新锁定。</p></div>
            {!vault.exists ? (
              <div className="form-grid">
                <div className="field"><label htmlFor="vault-password">密钥库密码</label><input id="vault-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
                <div className="field"><label htmlFor="vault-password-confirm">确认密钥库密码</label><input id="vault-password-confirm" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></div>
                <button className="button button-primary" type="button" onClick={() => void handleCreate()}>创建密钥库</button>
              </div>
            ) : vault.locked ? (
              <div>
                <div className="form-grid">
                  <div className="field"><label htmlFor="vault-unlock-password">密钥库密码</label><input id="vault-unlock-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
                  <button className="button button-primary" type="button" disabled={vault.retryAfter !== null && vault.retryAfter > Date.now()} onClick={() => void handleUnlock()}>解锁密钥库</button>
                  {vault.retryAfter !== null && vault.retryAfter > Date.now() && <p>尝试次数过多，请稍后再试。</p>}
                </div>
                <div className="form-actions"><button className="button" type="button" onClick={() => { setShowReset((shown) => !shown); setResetPhrase(''); }}>{showReset ? '取消重置' : '忘记密码 / 重置密钥库'}</button></div>
                {showReset && <div style={{ marginTop: 18, padding: 18, border: '1px solid #a44' }}>
                  <p>重置会永久删除当前账户在本浏览器中保存的 AI 配置和 API Key，但不会影响项目、自选股或持仓。</p>
                  <div className="field"><label htmlFor="locked-vault-reset-confirmation">重置确认</label><input id="locked-vault-reset-confirmation" value={resetPhrase} placeholder="输入：清空密钥库" onChange={(event) => setResetPhrase(event.target.value)} /></div>
                  <div className="form-actions"><button className="button" type="button" disabled={resetPhrase !== '清空密钥库' || resetting} onClick={() => void handleResetLockedVault()}>{resetting ? '正在重置…' : '确认重置密钥库'}</button></div>
                </div>}
              </div>
            ) : <button className="button" type="button" onClick={vault.lock}>立即锁定</button>}
          </div>
        </section>

        {!vault.locked && vault.settings && <>
          {legacyPreview && (
            <section className="form-section"><span className="section-number">迁移</span><div>
              <div className="section-heading"><h2>发现旧版研究配置</h2><p>检测到本机保存的旧版 dd-research-config。不会自动迁移，确认后才加密导入并删除原始配置。</p></div>
              <div className="form-grid">
                <div className="field"><span>供应商</span><strong>{AI_PROVIDER_PRESETS[legacyPreview.providerId].label}</strong></div>
                <div className="field"><span>模型</span><strong>{legacyPreview.model}</strong></div>
                <div className="field" style={{ gridColumn: '1 / -1' }}><span>Endpoint</span><strong>{legacyPreview.endpoint}</strong></div>
                {legacyPreview.hasKey && legacyPreview.keyLastFour && (
                  <div className="field"><span>API Key</span><strong>{`已保存 Key：•••• ${legacyPreview.keyLastFour}`}</strong></div>
                )}
              </div>
              <label><input type="checkbox" checked={legacyConfirmed} onChange={(e) => setLegacyConfirmed(e.target.checked)} /> 我确认导入到当前账户的本机密钥库</label>
              <div className="form-actions">
                <button className="button button-primary" type="button" disabled={!legacyConfirmed || migrating} onClick={() => void handleMigrateLegacy()}>
                  {migrating ? '正在导入…' : '导入旧配置'}
                </button>
              </div>
            </div></section>
          )}
          <section className="form-section"><span className="section-number">02</span><ProfileEditor title="全站默认模型" profile={defaultProfile} onChange={setDefaultProfile} pendingKey={keys.default} onKeyChange={(value) => setKeys((old) => ({ ...old, default: value }))} keyTail={keyTail('default', defaultProfile)} testing={testingScope === 'default'} onTest={() => handleTest('default', defaultProfile)} /></section>
          <section className="form-section"><span className="section-number">03</span><div><label><input type="checkbox" checked={dueDiligenceEnabled} onChange={(e) => setDueDiligenceEnabled(e.target.checked)} /> 启用投研尽调独立模型</label><ProfileEditor title="投研尽调 AI" profile={dueDiligenceProfile} onChange={setDueDiligenceProfile} pendingKey={keys.due_diligence} onKeyChange={(value) => setKeys((old) => ({ ...old, due_diligence: value }))} keyTail={dueDiligenceEnabled ? keyTail('due_diligence', dueDiligenceProfile) : null} disabled={!dueDiligenceEnabled} testing={testingScope === 'due_diligence'} onTest={() => handleTest('due_diligence', dueDiligenceProfile)} /></div></section>
          <section className="form-section"><span className="section-number">04</span><div><label><input type="checkbox" checked={securitiesEnabled} onChange={(e) => setSecuritiesEnabled(e.target.checked)} /> 启用证券分析独立模型</label><ProfileEditor title="证券分析 AI" profile={securitiesProfile} onChange={setSecuritiesProfile} pendingKey={keys.securities} onKeyChange={(value) => setKeys((old) => ({ ...old, securities: value }))} keyTail={securitiesEnabled ? keyTail('securities', securitiesProfile) : null} disabled={!securitiesEnabled} testing={testingScope === 'securities'} onTest={() => handleTest('securities', securitiesProfile)} /></div></section>
          <section className="form-section"><span className="section-number">05</span><div><div className="section-heading"><h2>保存与安全操作</h2><p>清空后，本机保存的所有模型配置和 Key 都无法恢复。</p></div><div className="form-actions"><button className="button button-primary" type="button" onClick={() => void handleSave()}>加密保存配置</button></div><div className="field"><label htmlFor="clear-vault-confirmation">清空确认</label><input id="clear-vault-confirmation" value={clearPhrase} placeholder="输入：清空密钥库" onChange={(e) => setClearPhrase(e.target.value)} /></div><button className="button" type="button" disabled={clearPhrase !== '清空密钥库'} onClick={() => void vault.clearVault()}>确认清空密钥库</button></div></section>
        </>}
      </div>
      {message && <p className="form-error" role="status">{message}</p>}
    </div>
  );
}
