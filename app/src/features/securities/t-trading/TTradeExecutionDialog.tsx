import { useState } from 'react';
import type { TTradeMessageKind } from '../backtest-signal-inbox-store';

export interface TTradeExecutionResult {
  price: number;
  shares: number;
  brokerActualTotalFee: number | null;
  resolution: 'execute' | 'keep_as_reduction';
}

interface Props {
  kind: TTradeMessageKind;
  suggestedPrice: number;
  suggestedShares: number;
  maxShares: number;
  submitting?: boolean;
  externalError?: string;
  onConfirm(result: TTradeExecutionResult): void;
  onCancel(): void;
}

export function TTradeExecutionDialog(props: Props) {
  const [price, setPrice] = useState(String(props.suggestedPrice));
  const [shares, setShares] = useState(String(props.suggestedShares));
  const [fee, setFee] = useState('');
  const [error, setError] = useState('');

  const confirm = () => {
    const parsedPrice = Number(price);
    const parsedShares = Number(shares);
    const parsedFee = fee.trim() === '' ? null : Number(fee);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) return setError('成交价格必须大于 0');
    if (!Number.isInteger(parsedShares) || parsedShares <= 0 || parsedShares % 100 !== 0) {
      return setError('成交数量必须是 100 股整数倍');
    }
    if (parsedShares > props.maxShares) return setError(`成交数量不能超过 ${props.maxShares} 股`);
    if (parsedFee !== null && (!Number.isFinite(parsedFee) || parsedFee < 0)) return setError('手续费不能为负数');
    props.onConfirm({ price: parsedPrice, shares: parsedShares, brokerActualTotalFee: parsedFee, resolution: 'execute' });
  };

  return <div role="dialog" aria-label="做 T 成交确认" style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.65)', display: 'grid', placeItems: 'center' }}>
    <section style={{ width: 390, maxWidth: '92vw', padding: 18, borderRadius: 10, background: '#172727', border: '1px solid #3a5a5a' }}>
      <h3 style={{ marginTop: 0 }}>{props.kind === 'actual_t_sell' ? '确认做 T 卖出' : '确认做 T 回补'}</h3>
      <label style={{ display: 'block', marginBottom: 10 }}>成交价格<input aria-label="成交价格" type="number" step="0.01" value={price} onChange={event => setPrice(event.target.value)} /></label>
      <label style={{ display: 'block', marginBottom: 10 }}>成交数量<input aria-label="成交数量" type="number" step="100" value={shares} onChange={event => setShares(event.target.value)} /></label>
      <label style={{ display: 'block', marginBottom: 10 }}>券商实际总手续费（可选）<input aria-label="券商实际总手续费（可选）" type="number" step="0.01" value={fee} onChange={event => setFee(event.target.value)} /></label>
      {(error || props.externalError) && <p role="alert" style={{ color: '#f87171' }}>{error || props.externalError}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" onClick={props.onCancel}>取消</button>
        <button type="button" disabled={props.submitting} onClick={confirm}>确认执行</button>
      </div>
    </section>
  </div>;
}