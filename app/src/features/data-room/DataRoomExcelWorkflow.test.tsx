import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InspectedWorkbook } from '../../infrastructure/import/excel-importer';
import { createExcelImportKey } from '../../infrastructure/import/excel-importer';
import type { StoredDocument } from '../../infrastructure/db/app-db';
import { AppDb } from '../../infrastructure/db/app-db';
import { EvidenceRepository } from '../../infrastructure/db/evidence-repository';
import { FileVault } from '../../infrastructure/files/file-vault';
import { DataRoomPage } from './DataRoomPage';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function storedDocument(
  name: string,
  projectId = 'project-1',
  id = 'document-1',
): StoredDocument {
  return {
    id,
    projectId,
    name,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 5,
    uploadedAt: '2026-07-22T00:00:00.000Z',
    parseStatus: 'stored',
    blob: new Blob(['excel'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  };
}

function inspectedWorkbook(): InspectedWorkbook {
  return {
    sheetNames: ['Profit', 'Metrics'],
    sheets: {
      Profit: {
        name: 'Profit',
        headers: ['Period', 'Revenue'],
        rows: [{ Period: '2025', Revenue: '1,200' }],
        cells: [{}],
        startRow: 0,
        startColumn: 0,
        headerRowIndex: 0,
      },
      Metrics: {
        name: 'Metrics',
        headers: ['Company', 'Margin'],
        rows: [{ Company: 'ACME', Margin: '0.4' }],
        cells: [{}],
        startRow: 0,
        startColumn: 0,
        headerRowIndex: 0,
      },
    },
  };
}

describe('DataRoomPage Excel workflow', () => {
  let db: AppDb | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await db?.delete();
    db = undefined;
  });

  function setupDocument(document = storedDocument('model.xlsx')) {
    db = new AppDb(`data-room-excel-${crypto.randomUUID()}`);
    const vault = new FileVault(db);
    vi.spyOn(vault, 'list').mockResolvedValue([document]);
    return { db, vault };
  }

  it('reopens a stored Excel file through the injected Worker inspector and selects sheets', async () => {
    const { vault } = setupDocument();
    const parsing = deferred<InspectedWorkbook>();
    const inspector = vi.fn(() => parsing.promise);

    render(
      <DataRoomPage
        projectId="project-1"
        vault={vault}
        inspector={inspector}
      />,
    );

    await screen.findByText('model.xlsx');
    fireEvent.click(screen.getByRole('button', { name: '解析 model.xlsx' }));
    expect(screen.getByText('正在解析 model.xlsx…')).toBeInTheDocument();

    await act(async () => {
      parsing.resolve(inspectedWorkbook());
      await parsing.promise;
    });

    expect(inspector).toHaveBeenCalledTimes(1);
    const sheetSelect = await screen.findByLabelText('选择工作表');
    expect(screen.getByRole('heading', { name: 'Profit' })).toBeInTheDocument();
    fireEvent.change(sheetSelect, { target: { value: 'Metrics' } });
    expect(screen.getByRole('heading', { name: 'Metrics' })).toBeInTheDocument();
  });

  it('shows a parse error and retries the same stored Excel file', async () => {
    const { vault } = setupDocument();
    const inspector = vi
      .fn()
      .mockRejectedValueOnce(new Error('worker failed'))
      .mockResolvedValueOnce(inspectedWorkbook());

    render(
      <DataRoomPage projectId="project-1" vault={vault} inspector={inspector} />,
    );

    await screen.findByText('model.xlsx');
    fireEvent.click(screen.getByRole('button', { name: '解析 model.xlsx' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '无法解析 Excel 文件，请重试。',
    );

    fireEvent.click(screen.getByRole('button', { name: '重新解析 model.xlsx' }));
    expect(await screen.findByRole('heading', { name: 'Profit' })).toBeInTheDocument();
    expect(inspector).toHaveBeenCalledTimes(2);
  });

  it('ignores a late parse result after the project changes', async () => {
    db = new AppDb(`data-room-excel-${crypto.randomUUID()}`);
    const vault = new FileVault(db);
    vi.spyOn(vault, 'list')
      .mockResolvedValueOnce([storedDocument('old.xlsx', 'project-1', 'old')])
      .mockResolvedValueOnce([storedDocument('new.xlsx', 'project-2', 'new')]);
    const parsing = deferred<InspectedWorkbook>();
    const inspector = vi.fn(() => parsing.promise);
    const view = render(
      <DataRoomPage projectId="project-1" vault={vault} inspector={inspector} />,
    );
    await screen.findByText('old.xlsx');
    fireEvent.click(screen.getByRole('button', { name: '解析 old.xlsx' }));

    view.rerender(
      <DataRoomPage projectId="project-2" vault={vault} inspector={inspector} />,
    );
    expect(await screen.findByText('new.xlsx')).toBeInTheDocument();

    await act(async () => {
      parsing.resolve(inspectedWorkbook());
      await parsing.promise;
    });

    expect(screen.queryByRole('heading', { name: 'Profit' })).not.toBeInTheDocument();
  });

  it('maps a selected sheet into the evidence repository and reports completion', async () => {
    const { db: database, vault } = setupDocument();
    const repository = new EvidenceRepository(database);
    const onImportCompleted = vi.fn();

    render(
      <DataRoomPage
        projectId="project-1"
        vault={vault}
        inspector={vi.fn().mockResolvedValue(inspectedWorkbook())}
        evidenceRepository={repository}
        completedImportKeys={new Set<string>()}
        onImportCompleted={onImportCompleted}
      />,
    );

    await screen.findByText('model.xlsx');
    fireEvent.click(screen.getByRole('button', { name: '解析 model.xlsx' }));
    await screen.findByRole('heading', { name: 'Profit' });
    fireEvent.change(screen.getByLabelText('Period 映射字段'), {
      target: { value: 'period_end' },
    });
    fireEvent.change(screen.getByLabelText('Revenue 映射字段'), {
      target: { value: 'revenue' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }));

    await waitFor(async () => {
      expect(await repository.listByProject('project-1')).toHaveLength(2);
    });
    const stored = await repository.listByProject('project-1');
    expect(stored.map(({ fieldId, normalizedValue }) => ({ fieldId, normalizedValue }))).toEqual([
      { fieldId: 'period_end', normalizedValue: '2025' },
      { fieldId: 'revenue', normalizedValue: '1200' },
    ]);
    expect(onImportCompleted).toHaveBeenCalledWith(
      createExcelImportKey('document-1', inspectedWorkbook().sheets.Profit!),
    );
  });

  it('passes controlled completed import keys to a reopened mapping panel', async () => {
    const { vault } = setupDocument();
    const workbook = inspectedWorkbook();
    const completedKey = createExcelImportKey('document-1', workbook.sheets.Profit!);

    render(
      <DataRoomPage
        projectId="project-1"
        vault={vault}
        inspector={vi.fn().mockResolvedValue(workbook)}
        completedImportKeys={new Set([completedKey])}
      />,
    );

    await screen.findByText('model.xlsx');
    fireEvent.click(screen.getByRole('button', { name: '解析 model.xlsx' }));

    expect(await screen.findByRole('button', { name: '导入完成' })).toBeDisabled();
  });
});
