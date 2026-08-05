import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ActualPositionGroupDialog } from './ActualPositionGroupDialog';

const groups = [
  { id: 'default', name: '默认持仓' },
  { id: 'core', name: '核心持仓' },
];

describe('ActualPositionGroupDialog', () => {
  it('submits an existing target group', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ActualPositionGroupDialog
      stockName="平安银行" currentGroupId="default" groups={groups}
      onConfirm={onConfirm} onCancel={vi.fn()}
    />);

    expect(screen.getByLabelText('目标持仓组')).toHaveValue('default');
    await user.selectOptions(screen.getByLabelText('目标持仓组'), 'core');
    await user.click(screen.getByRole('button', { name: '确认调整' }));
    expect(onConfirm).toHaveBeenCalledWith({ groupId: 'core', newGroupName: '' });
  });

  it('requires and trims a new group name', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ActualPositionGroupDialog
      stockName="平安银行" currentGroupId="default" groups={groups}
      onConfirm={onConfirm} onCancel={vi.fn()}
    />);

    await user.selectOptions(screen.getByLabelText('目标持仓组'), '__new__');
    await user.click(screen.getByRole('button', { name: '确认调整' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请输入新持仓组名称');
    await user.type(screen.getByLabelText('新持仓组名称'), '  波段持仓  ');
    await user.click(screen.getByRole('button', { name: '确认调整' }));
    expect(onConfirm).toHaveBeenCalledWith({ groupId: '__new__', newGroupName: '波段持仓' });
  });

  it('shows persistence errors and disables actions while submitting', () => {
    render(<ActualPositionGroupDialog
      stockName="平安银行" currentGroupId="default" groups={groups}
      submitting externalError="存储空间不足"
      onConfirm={vi.fn()} onCancel={vi.fn()}
    />);

    expect(screen.getByRole('alert')).toHaveTextContent('存储空间不足');
    expect(screen.getByRole('button', { name: '提交中...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  });
});
