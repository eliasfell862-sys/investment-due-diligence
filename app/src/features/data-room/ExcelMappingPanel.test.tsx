import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { InspectedSheet } from '../../infrastructure/import/excel-importer';
import { ExcelMappingPanel } from './ExcelMappingPanel';

const profitSheet: InspectedSheet = {
  name: '利润表',
  headers: ['年份', '营业收入'],
  rows: [
    { 年份: '2025', 营业收入: 1200 },
    { 年份: '2024', 营业收入: 1000 },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('ExcelMappingPanel', () => {
  it('submits the selected source-to-target mapping', async () => {
    const user = userEvent.setup();
    const onMap = vi.fn();
    render(<ExcelMappingPanel sheet={profitSheet} onMap={onMap} />);

    await user.selectOptions(screen.getByLabelText('营业收入 映射字段'), 'revenue');
    await user.click(screen.getByRole('button', { name: '确认导入' }));

    expect(onMap).toHaveBeenCalledWith({ 营业收入: 'revenue' });
  });

  it('offers exactly the supported import targets for each header', () => {
    render(<ExcelMappingPanel sheet={profitSheet} onMap={() => undefined} />);

    expect(
      screen.getByLabelText<HTMLSelectElement>('营业收入 映射字段').options,
    ).toHaveLength(7);
    expect(
      [...screen.getByLabelText<HTMLSelectElement>('营业收入 映射字段').options].map(
        ({ text, value }) => [value, text],
      ),
    ).toEqual([
      ['', '不导入'],
      ['company_name', 'company_name 公司名称'],
      ['revenue', 'revenue 营业收入'],
      ['gross_margin', 'gross_margin 毛利率'],
      ['net_profit', 'net_profit 净利润'],
      ['operating_cash_flow', 'operating_cash_flow 经营现金流'],
      ['arr', 'arr ARR'],
    ]);
  });

  it('allows an explicit empty mapping', async () => {
    const user = userEvent.setup();
    const onMap = vi.fn();
    render(<ExcelMappingPanel sheet={profitSheet} onMap={onMap} />);

    await user.click(screen.getByRole('button', { name: '确认导入' }));

    expect(onMap).toHaveBeenCalledWith({});
  });

  it('blocks duplicate target fields with a clear validation error', async () => {
    const user = userEvent.setup();
    const onMap = vi.fn();
    render(<ExcelMappingPanel sheet={profitSheet} onMap={onMap} />);

    await user.selectOptions(screen.getByLabelText('年份 映射字段'), 'revenue');
    await user.selectOptions(screen.getByLabelText('营业收入 映射字段'), 'revenue');
    await user.click(screen.getByRole('button', { name: '确认导入' }));

    expect(screen.getByRole('alert')).toHaveTextContent('每个目标字段只能映射一次');
    expect(onMap).not.toHaveBeenCalled();
  });

  it('resets mappings when the sheet identity or headers change', async () => {
    const user = userEvent.setup();
    const view = render(<ExcelMappingPanel sheet={profitSheet} onMap={() => undefined} />);
    await user.selectOptions(screen.getByLabelText('营业收入 映射字段'), 'revenue');

    view.rerender(
      <ExcelMappingPanel
        sheet={{ name: '资产负债表', headers: ['总资产'], rows: [{ 总资产: 10 }] }}
        onMap={() => undefined}
      />,
    );

    expect(screen.getByLabelText<HTMLSelectElement>('总资产 映射字段')).toHaveValue('');
    expect(screen.queryByLabelText('营业收入 映射字段')).not.toBeInTheDocument();
  });

  it('disables submission and prevents double import while pending', async () => {
    const pending = deferred<void>();
    const onMap = vi.fn(() => pending.promise);
    render(<ExcelMappingPanel sheet={profitSheet} onMap={onMap} />);

    const button = screen.getByRole('button', { name: '确认导入' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onMap).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '正在导入…' })).toBeDisabled();

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(screen.getByRole('button', { name: '确认导入' })).not.toBeDisabled();
  });

  it('shows async failures and allows a retry', async () => {
    const user = userEvent.setup();
    const onMap = vi.fn()
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce(undefined);
    render(<ExcelMappingPanel sheet={profitSheet} onMap={onMap} />);

    await user.click(screen.getByRole('button', { name: '确认导入' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('导入失败，请重试');

    await user.click(screen.getByRole('button', { name: '确认导入' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(onMap).toHaveBeenCalledTimes(2);
  });

  it('renders an accessible five-row preview with the sheet name and total row count', () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({
      年份: String(2025 - index),
      营业收入: index * 100,
    }));
    render(
      <ExcelMappingPanel
        sheet={{ ...profitSheet, rows }}
        onMap={() => undefined}
      />,
    );

    expect(screen.getByRole('heading', { name: '利润表' })).toBeInTheDocument();
    expect(screen.getByText('7 行数据')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '利润表 前五行预览' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
    expect(screen.getByText('2021')).toBeInTheDocument();
    expect(screen.queryByText('2020')).not.toBeInTheDocument();
    for (const header of screen.getAllByRole('columnheader')) {
      expect(header).toHaveAttribute('scope', 'col');
    }
  });
});
