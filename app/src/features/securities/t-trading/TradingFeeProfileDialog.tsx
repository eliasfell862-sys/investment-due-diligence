import { useState } from 'react';
import { DEFAULT_TRADING_FEE_PROFILE, type TradingFeeProfile } from './t-trading-types';

interface Props {
  profile: TradingFeeProfile;
  saving?: boolean;
  externalError?: string;
  onSave(profile: TradingFeeProfile): void | Promise<void>;
  onCancel(): void;
}

type NumericField = 'commissionRate' | 'minimumCommission' | 'sellStampDutyRate' | 'transferFeeRate' | 'fixedSlippageRate';

export function TradingFeeProfileDialog({ profile, saving, externalError, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState({ ...profile });
  const [error, setError] = useState('');
  const update = (field: NumericField, value: string) => setDraft(current => ({ ...current, [field]: Number(value) }));

  const save = () => {
    const values = [draft.commissionRate, draft.minimumCommission, draft.sellStampDutyRate, draft.transferFeeRate, draft.fixedSlippageRate];
    if (values.some(value => !Number.isFinite(value) || value < 0)) {
      setError('费率和最低佣金不能为负数');
      return;
    }
    setError('');
    void onSave({ ...draft });
  };

  return <div role="dialog" aria-label="交易费率设置" style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.65)', display: 'grid', placeItems: 'center' }}>
    <section style={{ width: 430, maxWidth: '92vw', padding: 18, borderRadius: 10, background: '#172727', border: '1px solid #3a5a5a' }}>
      <h3 style={{ marginTop: 0 }}>交易费率设置</h3>
      <label style={{ display: 'block' }}>佣金率<input aria-label="佣金率" type="number" step="0.00001" value={draft.commissionRate} onChange={event => update('commissionRate', event.target.value)} /></label>
      <label style={{ display: 'block' }}>最低佣金<input aria-label="最低佣金" type="number" step="0.01" value={draft.minimumCommission} onChange={event => update('minimumCommission', event.target.value)} /></label>
      <label style={{ display: 'block' }}>卖出印花税率<input aria-label="卖出印花税率" type="number" step="0.00001" value={draft.sellStampDutyRate} onChange={event => update('sellStampDutyRate', event.target.value)} /></label>
      <label style={{ display: 'block' }}>过户费率<input aria-label="过户费率" type="number" step="0.000001" value={draft.transferFeeRate} onChange={event => update('transferFeeRate', event.target.value)} /></label>
      <label style={{ display: 'block' }}>固定滑点率<input aria-label="固定滑点率" type="number" step="0.00001" value={draft.fixedSlippageRate} onChange={event => update('fixedSlippageRate', event.target.value)} /></label>
      <label style={{ display: 'block' }}>滑点模式<select aria-label="滑点模式" value={draft.slippageMode} onChange={event => setDraft(current => ({ ...current, slippageMode: event.target.value as TradingFeeProfile['slippageMode'] }))}><option value="dynamic">动态</option><option value="fixed">固定</option></select></label>
      {(error || externalError) && <p role="alert" style={{ color: '#f87171' }}>{error || externalError}</p>}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
        <button type="button" onClick={() => { setDraft({ ...DEFAULT_TRADING_FEE_PROFILE }); setError(''); }}>恢复默认</button>
        <div style={{ display: 'flex', gap: 8 }}><button type="button" onClick={onCancel}>取消</button><button type="button" disabled={saving} onClick={save}>保存费率</button></div>
      </div>
    </section>
  </div>;
}