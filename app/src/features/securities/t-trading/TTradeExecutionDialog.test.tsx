import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TTradeExecutionDialog } from './TTradeExecutionDialog';

describe('TTradeExecutionDialog', () => {
  it('validates board lots, ceiling, and optional broker fee', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<TTradeExecutionDialog kind="actual_t_sell" suggestedPrice={11.5} suggestedShares={300} maxShares={300} onConfirm={onConfirm} onCancel={() => undefined} />);
    await user.clear(screen.getByLabelText('成交数量'));
    await user.type(screen.getByLabelText('成交数量'), '250');
    await user.click(screen.getByRole('button', { name: '确认执行' }));
    expect(screen.getByRole('alert')).toHaveTextContent('100 股整数倍');
    await user.clear(screen.getByLabelText('成交数量'));
    await user.type(screen.getByLabelText('成交数量'), '400');
    await user.click(screen.getByRole('button', { name: '确认执行' }));
    expect(screen.getByRole('alert')).toHaveTextContent('不能超过 300 股');
    await user.clear(screen.getByLabelText('成交数量'));
    await user.type(screen.getByLabelText('成交数量'), '300');
    await user.type(screen.getByLabelText('券商实际总手续费（可选）'), '-1');
    await user.click(screen.getByRole('button', { name: '确认执行' }));
    expect(screen.getByRole('alert')).toHaveTextContent('手续费不能为负数');
  });
});