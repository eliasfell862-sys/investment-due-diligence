import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VirtualCapitalCleanupDialog } from './VirtualCapitalCleanupDialog';

const preview = {
  previewId: 'preview-1',
  snapshotHash: 'hash-1',
  snapshotAt: '2026-08-18T02:00:00.000Z',
  originalTransactionCount: 12,
  retainedTransactionCount: 9,
  removedTransactionCount: 3,
  endingCash: 76543.21,
  containsEstimatedFees: false,
};

describe('VirtualCapitalCleanupDialog', () => {
  it('does not apply cleanup until the exact confirmation text is entered', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <VirtualCapitalCleanupDialog
        preview={preview}
        onApply={onApply}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '执行账本清理' }));
    expect(onApply).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('确认文字'), '确认清理超额虚拟交易');
    await user.click(screen.getByRole('button', { name: '执行账本清理' }));
    expect(onApply).toHaveBeenCalledWith(preview.previewId, preview.snapshotHash);
  });
  it('blocks cleanup when the preview contains estimated fees', async () => {
    const user = userEvent.setup();
    render(
      <VirtualCapitalCleanupDialog
        preview={{ ...preview, containsEstimatedFees: true }}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText('确认文字'), '确认清理超额虚拟交易');
    expect(screen.getByRole('button', { name: '执行账本清理' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('包含估算手续费');
  });

  it('blocks cleanup while applying or after the preview becomes stale', () => {
    const { rerender } = render(
      <VirtualCapitalCleanupDialog
        preview={preview}
        applying
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '执行账本清理' })).toBeDisabled();

    rerender(
      <VirtualCapitalCleanupDialog
        preview={preview}
        stale
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('预演已失效');
    expect(screen.getByRole('button', { name: '执行账本清理' })).toBeDisabled();
  });

});
