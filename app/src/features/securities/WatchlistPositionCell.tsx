import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { StockQuote } from '../../infrastructure/market-data/stock-api';
import type { BacktestSignalAlert } from './backtest-signal-inbox-store';
import {
  buyStockPosition,
  findStockPosition,
  type BuyStockPositionInput,
  type StockPositionLedger,
} from './stock-position-ledger';
import { StockTradeConfirmDialog, type StockTradeConfirmation } from './StockTradeConfirmDialog';

export interface WatchlistPositionCellProps {
  quote: StockQuote;
  ledger: StockPositionLedger;
  ledgerError: string;
  onLedgerChanged(): void;
  onBuy?(input: BuyStockPositionInput): Promise<void> | void;
}

function createManualAlert(quote: StockQuote): BacktestSignalAlert {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `manual-watchlist-${quote.code}-${suffix}`,
    code: quote.code,
    name: quote.name,
    price: quote.price,
    action: 'buy',
    intent: 'open',
    suggestedShares: 100,
    positionSharesAtSignal: 0,
    availableSharesAtSignal: 0,
    reasons: ['用户从自选股确认买入'],
    signalAt: new Date().toISOString(),
    status: 'pending',
    readAt: null,
    executedAt: null,
    entryPrice: quote.price,
    stopLoss: quote.price,
    metrics: {
      totalTrades: 0,
      winRate: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      annualReturn: 0,
      profitFactor: 0,
    },
  };
}

export function WatchlistPositionCell({
  quote,
  ledger,
  ledgerError,
  onLedgerChanged,
  onBuy,
}: WatchlistPositionCellProps) {
  const position = findStockPosition(ledger, quote.code);
  const [manualAlert, setManualAlert] = useState<BacktestSignalAlert | null>(null);
  const [actionError, setActionError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const openDialog = () => {
    setActionError('');
    if (!Number.isFinite(quote.price) || quote.price <= 0) {
      setActionError('当前没有有效实时价格，请先刷新行情');
      return;
    }
    setManualAlert(createManualAlert(quote));
  };

  const confirmBuy = async (input: StockTradeConfirmation) => {
    if (!manualAlert || submitting) return;
    setSubmitting(true);
    setActionError('');
    try {
      const groupId = input.groupId === '__new__' ? `group-${Date.now()}` : input.groupId;
      const groupName = input.groupId === '__new__'
        ? input.newGroupName
        : ledger.groups.find(group => group.id === groupId)?.name ?? '默认持仓';
      const buyInput: BuyStockPositionInput = {
        code: quote.code,
        name: quote.name,
        shares: input.shares,
        price: input.price,
        groupId,
        groupName,
        sourceAlertId: manualAlert.id,
        tradedAt: new Date().toISOString(),
      };
      if (onBuy) {
        await onBuy(buyInput);
      } else {
        buyStockPosition(buyInput);
        onLedgerChanged();
      }
      setManualAlert(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const label = ledgerError ? '持仓状态异常' : position ? '已加入持仓' : '加入持仓';
  const disabled = Boolean(ledgerError || position);

  return (
    <>
      <td onClick={event => event.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
        <button
          type="button"
          aria-label={`${label} ${quote.name}`}
          disabled={disabled}
          onClick={event => { event.stopPropagation(); openDialog(); }}
          style={{
            padding: '5px 9px', borderRadius: 5,
            border: `1px solid ${position ? '#3f6d66' : '#d4a574'}`,
            background: position ? '#1a3632' : '#3d321f',
            color: position ? '#8fd3c8' : '#f6c87a',
            cursor: disabled ? 'default' : 'pointer',
            opacity: ledgerError ? 0.65 : 1,
          }}
        >
          {label}
        </button>
        {actionError && !manualAlert && (
          <div role="alert" style={{ color: '#f87171', fontSize: '0.68rem', marginTop: 4 }}>
            {actionError}
          </div>
        )}
      </td>
      {manualAlert && createPortal(
        <div onClick={event => event.stopPropagation()}>
          <StockTradeConfirmDialog
            alert={manualAlert}
            position={null}
            groups={ledger.groups}
            priceLabel="最新价"
            submitting={submitting}
            externalError={actionError}
            onConfirm={input => { void confirmBuy(input); }}
            onCancel={() => { if (!submitting) setManualAlert(null); }}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
