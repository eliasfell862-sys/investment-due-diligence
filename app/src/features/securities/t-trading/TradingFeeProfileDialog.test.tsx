import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TRADING_FEE_PROFILE } from './t-trading-types';
import { TradingFeeProfileDialog } from './TradingFeeProfileDialog';

describe('TradingFeeProfileDialog', () => {
  it('rejects negative fees and restores exact defaults', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<TradingFeeProfileDialog profile={{ ...DEFAULT_TRADING_FEE_PROFILE, commissionRate: .001 }} onSave={onSave} onCancel={() => undefined} />);    fireEvent.change(screen.getByLabelText('佣金率'), { target: { value: '-0.1' } });
    await user.click(screen.getByRole('button', { name: '保存费率' }));
    expect(screen.getByRole('alert')).toHaveTextContent('不能为负数');
    await user.click(screen.getByRole('button', { name: '恢复默认' }));
    await user.click(screen.getByRole('button', { name: '保存费率' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining(DEFAULT_TRADING_FEE_PROFILE));
  });
});