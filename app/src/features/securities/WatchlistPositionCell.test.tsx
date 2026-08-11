import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadStockLedger, type StockPositionLedger } from './stock-position-ledger';
import { WatchlistPositionCell } from './WatchlistPositionCell';

const quote = {
  code: '000001', name: '平安银行', market: 'sz' as const, price: 10.8,
  change: 0, changePct: 0, open: 10.8, high: 10.8, low: 10.8,
  volume: 1_000, amount: 10_800, preClose: 10.8, turnover: 1,
  pe: 10, pb: 1, totalShares: 1, floatShares: 1, totalCap: 1, floatCap: 1,
};

const emptyLedger: StockPositionLedger = {
  version: 1, groups: [], positions: [], transactions: [],
};

describe('WatchlistPositionCell', () => {
  beforeEach(() => localStorage.clear());

  it('confirms a manual buy at the realtime price and persists it', async () => {
    const user = userEvent.setup();
    const onLedgerChanged = vi.fn();
    render(<table><tbody><tr><WatchlistPositionCell
      quote={quote} ledger={emptyLedger} ledgerError="" onLedgerChanged={onLedgerChanged}
    /></tr></tbody></table>);

    await user.click(screen.getByRole('button', { name: '加入持仓 平安银行' }));
    expect(screen.getByLabelText('交易股数')).toHaveValue(100);
    expect(screen.getByLabelText('成交价格')).toHaveValue(10.8);
    expect(screen.getByText(/最新价 ¥10.80/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认买入' }));

    expect(loadStockLedger().positions[0]).toMatchObject({
      code: '000001', shares: 100, averageCost: 10.8, groupId: 'default',
    });
    expect(loadStockLedger().transactions[0].sourceAlertId)
      .toMatch(/^manual-watchlist-000001-/);
    expect(onLedgerChanged).toHaveBeenCalledOnce();
  });
  it('delegates persistence to the supplied ledger writer', async () => {
    const user = userEvent.setup();
    const onBuy = vi.fn().mockResolvedValue(undefined);
    render(<table><tbody><tr><WatchlistPositionCell
      quote={quote}
      ledger={emptyLedger}
      ledgerError=""
      onLedgerChanged={vi.fn()}
      onBuy={onBuy}
    /></tr></tbody></table>);

    await user.click(screen.getByRole('button', { name: /\u52a0\u5165\u6301\u4ed3/ }));
    await user.click(screen.getByRole('button', { name: /\u786e\u8ba4\u4e70\u5165/ }));

    await waitFor(() => expect(onBuy).toHaveBeenCalledWith(expect.objectContaining({
      code: '000001',
      shares: 100,
      price: 10.8,
      sourceAlertId: expect.stringMatching(/^manual-watchlist-000001-/),
    })));
    expect(loadStockLedger().positions).toEqual([]);
  });


  it('shows a disabled held state and blocks writes when the ledger is invalid', () => {
    const heldLedger: StockPositionLedger = {
      ...emptyLedger,
      positions: [{
        id: 'position-1', groupId: 'default', code: '000001', name: '平安银行',
        shares: 100, averageCost: 10.8, totalCost: 1_080,
        openedAt: '2026-08-05T01:30:00.000Z', updatedAt: '2026-08-05T01:30:00.000Z',
        sourceAlertIds: ['manual-1'],
      }],
    };
    const { rerender } = render(<table><tbody><tr><WatchlistPositionCell
      quote={quote} ledger={heldLedger} ledgerError="" onLedgerChanged={vi.fn()}
    /></tr></tbody></table>);
    expect(screen.getByRole('button', { name: '已加入持仓 平安银行' })).toBeDisabled();

    rerender(<table><tbody><tr><WatchlistPositionCell
      quote={quote} ledger={emptyLedger} ledgerError="实际持仓数据损坏" onLedgerChanged={vi.fn()}
    /></tr></tbody></table>);
    expect(screen.getByRole('button', { name: '持仓状态异常 平安银行' })).toBeDisabled();
  });

  it('rejects opening a buy dialog without a valid realtime price', async () => {
    const user = userEvent.setup();
    render(<table><tbody><tr><WatchlistPositionCell
      quote={{ ...quote, price: 0 }} ledger={emptyLedger} ledgerError="" onLedgerChanged={vi.fn()}
    /></tr></tbody></table>);

    await user.click(screen.getByRole('button', { name: '加入持仓 平安银行' }));
    expect(screen.getByRole('alert')).toHaveTextContent('当前没有有效实时价格，请先刷新行情');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
