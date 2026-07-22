import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { importableTargetFieldDefinitions } from '../../domain/evidence/target-fields';
import type { InspectedSheet } from '../../infrastructure/import/excel-importer';
import { ExcelMappingPanel, type ExcelMappingPanelProps } from './ExcelMappingPanel';

const profitSheet: InspectedSheet = {
  name: '利润表',
  headers: ['年份', '营业收入'],
  rows: [
    { 年份: '2025', 营业收入: 1200 },
    { 年份: '2024', 营业收入: 1000 },
  ],
  cells: [{}, {}],
  startRow: 0,
  startColumn: 0,
  headerRowIndex: 0,
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
  it('requires a document identity in its public props', () => {
    expectTypeOf<ExcelMappingPanelProps['documentId']>().toEqualTypeOf<string>();
  });

  it('submits the selected source-to-target mapping', async () => {
    const user = userEvent.setup();
    const onMap = vi.fn();
    render(<ExcelMappingPanel documentId="document-1" sheet={profitSheet} onMap={onMap} />);

    await user.selectOptions(screen.getByLabelText('营业收入 映射字段'), 'revenue');
    await user.click(screen.getByRole('button', { name: '确认导入' }));

    expect(onMap).toHaveBeenCalledWith({ 营业收入: 'revenue' });
  });

  it('offers exactly the supported import targets for each header', () => {
    render(<ExcelMappingPanel documentId="document-1" sheet={profitSheet} onMap={() => undefined} />);

    const options = screen.getByLabelText<HTMLSelectElement>(
      `${profitSheet.headers[1]} \u6620\u5c04\u5b57\u6bb5`,
    ).options;
    expect([...options].map(({ text, value }) => [value, text])).toEqual([
      ['', '\u4e0d\u5bfc\u5165'],
      ...importableTargetFieldDefinitions.map(({ id, label }) => [id, label]),
    ]);
  });

  it('blocks an empty mapping with a clear validation error', async () => {
    const user = userEvent.setup();
    const onMap = vi.fn();
    render(<ExcelMappingPanel documentId="document-1" sheet={profitSheet} onMap={onMap} />);

    await user.click(screen.getByRole('button', { name: '确认导入' }));

    expect(screen.getByRole('alert')).toHaveTextContent('至少映射一个字段后才能导入');
    expect(onMap).not.toHaveBeenCalled();
  });

  it.each(['toString', 'hasOwnProperty'])(
    'does not treat inherited selection %s as an active mapping',
    async (header) => {
      const user = userEvent.setup();
      const onMap = vi.fn();
      const sheet: InspectedSheet = {
        name: 'Crafted',
        headers: [header],
        rows: [{ [header]: null }],
        cells: [{}],
        startRow: 0,
        startColumn: 0,
        headerRowIndex: 0,
      };

      render(<ExcelMappingPanel documentId="document-1" sheet={sheet} onMap={onMap} />);
      await user.click(screen.getByRole('button', { name: '\u786e\u8ba4\u5bfc\u5165' }));

      expect(screen.getByRole('alert')).toHaveTextContent('\u81f3\u5c11\u6620\u5c04\u4e00\u4e2a\u5b57\u6bb5\u540e\u624d\u80fd\u5bfc\u5165');
      expect(onMap).not.toHaveBeenCalled();
    },
  );

  it('blocks duplicate target fields with a clear validation error', async () => {
    const user = userEvent.setup();
    const onMap = vi.fn();
    render(<ExcelMappingPanel documentId="document-1" sheet={profitSheet} onMap={onMap} />);

    await user.selectOptions(screen.getByLabelText('年份 映射字段'), 'revenue');
    await user.selectOptions(screen.getByLabelText('营业收入 映射字段'), 'revenue');
    await user.click(screen.getByRole('button', { name: '确认导入' }));

    expect(screen.getByRole('alert')).toHaveTextContent('每个目标字段只能映射一次');
    expect(onMap).not.toHaveBeenCalled();
  });

  it('resets mappings when the document identity changes', async () => {
    const user = userEvent.setup();
    const onMap = () => undefined;
    const panelProps = (documentId: string): ExcelMappingPanelProps => ({
      documentId,
      sheet: profitSheet,
      onMap,
    });
    const view = render(<ExcelMappingPanel {...panelProps('document-1')} />);
    await user.selectOptions(
      screen.getByLabelText(`${profitSheet.headers[1]} \u6620\u5c04\u5b57\u6bb5`),
      'revenue',
    );

    view.rerender(<ExcelMappingPanel {...panelProps('document-2')} />);

    expect(
      screen.getByLabelText(`${profitSheet.headers[1]} \u6620\u5c04\u5b57\u6bb5`),
    ).toHaveValue('');
  });

  it('uses unique accessible ids for multiple panel instances', () => {
    const { container } = render(<>
      <ExcelMappingPanel documentId="document-1" sheet={profitSheet} onMap={() => undefined} />
      <ExcelMappingPanel documentId="document-2" sheet={profitSheet} onMap={() => undefined} />
    </>);

    const selectIds = [...container.querySelectorAll('select')].map((select) => select.id);
    expect(new Set(selectIds).size).toBe(selectIds.length);
    const headingIds = [...container.querySelectorAll('section')].map(
      (section) => section.getAttribute('aria-labelledby'),
    );
    expect(new Set(headingIds).size).toBe(headingIds.length);
  });

  it('resets mappings when the sheet identity or headers change', async () => {
    const user = userEvent.setup();
    const view = render(<ExcelMappingPanel documentId="document-1" sheet={profitSheet} onMap={() => undefined} />);
    await user.selectOptions(screen.getByLabelText('营业收入 映射字段'), 'revenue');

    view.rerender(
      <ExcelMappingPanel
        documentId="document-1"
        sheet={{
          name: '资产负债表',
          headers: ['总资产'],
          rows: [{ 总资产: 10 }],
          cells: [{}],
          startRow: 0,
          startColumn: 0,
          headerRowIndex: 0,
        }}
        onMap={() => undefined}
      />,
    );

    expect(screen.getByLabelText<HTMLSelectElement>('总资产 映射字段')).toHaveValue('');
    expect(screen.queryByLabelText('营业收入 映射字段')).not.toBeInTheDocument();
  });

  it('disables submission and prevents double import while pending', async () => {
    const pending = deferred<void>();
    const onMap = vi.fn(() => pending.promise);
    render(<ExcelMappingPanel documentId="document-1" sheet={profitSheet} onMap={onMap} />);
    fireEvent.change(screen.getByLabelText('营业收入 映射字段'), { target: { value: 'revenue' } });

    const button = screen.getByRole('button', { name: '确认导入' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onMap).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '正在导入…' })).toBeDisabled();

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(screen.getByRole('button', { name: '导入完成' })).toBeDisabled();
  });


  it('locks a completed import and keeps repeated submission idempotent', async () => {
    const user = userEvent.setup();
    const onMap = vi.fn().mockResolvedValue(undefined);
    render(<ExcelMappingPanel documentId="document-1" sheet={profitSheet} onMap={onMap} />);
    await user.selectOptions(
      screen.getByLabelText(`${profitSheet.headers[1]} \u6620\u5c04\u5b57\u6bb5`),
      'revenue',
    );
    await user.click(screen.getByRole('button', { name: '\u786e\u8ba4\u5bfc\u5165' }));

    const completedButton = await screen.findByRole('button', { name: '\u5bfc\u5165\u5b8c\u6210' });
    expect(completedButton).toBeDisabled();
    await user.click(completedButton);
    expect(onMap).toHaveBeenCalledTimes(1);
  });


  it('resets completion when the keyed document identity changes', async () => {
    const user = userEvent.setup();
    const onMap = vi.fn().mockResolvedValue(undefined);
    const view = render(<ExcelMappingPanel documentId="document-1" sheet={profitSheet} onMap={onMap} />);
    await user.selectOptions(
      screen.getByLabelText(`${profitSheet.headers[1]} \u6620\u5c04\u5b57\u6bb5`),
      'revenue',
    );
    await user.click(screen.getByRole('button', { name: '\u786e\u8ba4\u5bfc\u5165' }));
    await screen.findByRole('button', { name: '\u5bfc\u5165\u5b8c\u6210' });

    view.rerender(<ExcelMappingPanel documentId="document-2" sheet={profitSheet} onMap={onMap} />);
    const button = screen.getByRole('button', { name: '\u786e\u8ba4\u5bfc\u5165' });
    expect(button).not.toBeDisabled();
    await user.selectOptions(
      screen.getByLabelText(`${profitSheet.headers[1]} \u6620\u5c04\u5b57\u6bb5`),
      'revenue',
    );
    await user.click(button);

    expect(onMap).toHaveBeenCalledTimes(2);
  });
  it('shows async failures and allows a retry', async () => {
    const user = userEvent.setup();
    const onMap = vi.fn()
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce(undefined);
    render(<ExcelMappingPanel documentId="document-1" sheet={profitSheet} onMap={onMap} />);
    await user.selectOptions(screen.getByLabelText('营业收入 映射字段'), 'revenue');

    await user.click(screen.getByRole('button', { name: '确认导入' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('导入失败，请重试');

    await user.click(screen.getByRole('button', { name: '确认导入' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(onMap).toHaveBeenCalledTimes(2);
  });


  it('prefers formatted cell text in the preview, including an empty string', () => {
    const displaySheet: InspectedSheet = {
      name: 'Display',
      headers: ['Percent', 'Date', 'Formula', 'Hidden'],
      rows: [{ Percent: 0.123, Date: new Date(0), Formula: 3, Hidden: 0 }],
      cells: [{
        Percent: { value: 0.123, w: '12.3%', t: 'n', z: '0.0%' },
        Date: { value: new Date(0), w: '2025/12/31', t: 'd' },
        Formula: { value: 3, w: '3.00', f: '1+2', t: 'n' },
        Hidden: { value: 0, w: '', t: 'n' },
      }],
      startRow: 0,
      startColumn: 0,
      headerRowIndex: 0,
    };
    render(<ExcelMappingPanel documentId="document-1" sheet={displaySheet} onMap={() => undefined} />);

    const preview = screen.getByRole('table', { name: 'Display \u524d\u4e94\u884c\u9884\u89c8' });
    expect(within(preview).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      '12.3%',
      '2025/12/31',
      '3.00',
      '',
    ]);
  });

  it('renders an accessible five-row preview with the sheet name and total row count', () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({
      年份: String(2025 - index),
      营业收入: index * 100,
    }));
    render(
      <ExcelMappingPanel
        documentId="document-1"
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
