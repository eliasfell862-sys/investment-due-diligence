import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredDocument } from '../../infrastructure/db/app-db';
import { AppDb } from '../../infrastructure/db/app-db';
import { FileVault, FileVaultError } from '../../infrastructure/files/file-vault';
import { DataRoomPage } from './DataRoomPage';
import { formatFileSize } from './format-file-size';
function storedDocument(
  name: string,
  projectId = 'p1',
  id = name,
): StoredDocument {
  return {
    id,
    projectId,
    name,
    mimeType: 'application/pdf',
    size: 1536,
    uploadedAt: '2026-07-21T08:00:00.000Z',
    parseStatus: 'stored',
    blob: new Blob(['sample'], { type: 'application/pdf' }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}


describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KiB'],
    [1536, '1.5 KiB'],
    [1024 ** 2, '1 MiB'],
    [1024 ** 3, '1 GiB'],
  ])('formats %d bytes as %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});

describe('DataRoomPage hardening', () => {
  let db: AppDb | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await db?.delete();
    db = undefined;
  });

  function createVault() {
    db = new AppDb(`data-room-${crypto.randomUUID()}`);
    return new FileVault(db);
  }

  it('loads persisted documents and exposes the initial loading state', async () => {
    const vault = createVault();
    const loading = deferred<StoredDocument[]>();
    vi.spyOn(vault, 'list').mockReturnValueOnce(loading.promise);

    render(<DataRoomPage projectId="p1" vault={vault} />);

    expect(screen.getByText('\u6b63\u5728\u52a0\u8f7d\u8d44\u6599\u2026')).toBeInTheDocument();
    expect(screen.getByLabelText('\u4e0a\u4f20\u8d44\u6599')).toBeDisabled();
    expect(screen.getByRole('region', { name: '\u8d44\u6599\u4e2d\u5fc3' })).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      loading.resolve([storedDocument('persisted.pdf')]);
      await loading.promise;
    });

    expect(await screen.findByText('persisted.pdf')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '\u8d44\u6599\u4e2d\u5fc3' })).toHaveAttribute(
      'aria-busy',
      'false',
    );
  });

  it('clears old project documents immediately when the project changes', async () => {
    const vault = createVault();
    const nextProject = deferred<StoredDocument[]>();
    vi.spyOn(vault, 'list')
      .mockResolvedValueOnce([storedDocument('old.pdf')])
      .mockReturnValueOnce(nextProject.promise);
    const view = render(<DataRoomPage projectId="p1" vault={vault} />);
    expect(await screen.findByText('old.pdf')).toBeInTheDocument();

    view.rerender(<DataRoomPage projectId="p2" vault={vault} />);

    expect(screen.queryByText('old.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('\u6b63\u5728\u52a0\u8f7d\u8d44\u6599\u2026')).toBeInTheDocument();

    await act(async () => {
      nextProject.resolve([]);
      await nextProject.promise;
    });
  });

  it('ignores a late result from the previous project', async () => {
    const vault = createVault();
    const oldProject = deferred<StoredDocument[]>();
    const newProject = deferred<StoredDocument[]>();
    vi.spyOn(vault, 'list')
      .mockReturnValueOnce(oldProject.promise)
      .mockReturnValueOnce(newProject.promise);
    const view = render(<DataRoomPage projectId="p1" vault={vault} />);

    view.rerender(<DataRoomPage projectId="p2" vault={vault} />);
    await act(async () => {
      newProject.resolve([storedDocument('new.pdf', 'p2')]);
      await newProject.promise;
    });
    expect(await screen.findByText('new.pdf')).toBeInTheDocument();

    await act(async () => {
      oldProject.resolve([storedDocument('late-old.pdf')]);
      await oldProject.promise;
    });
    expect(screen.queryByText('late-old.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('new.pdf')).toBeInTheDocument();
  });

  it('stores a selected batch, refreshes the list, clears the input, and stays offline', async () => {
    const vault = createVault();
    const documents = [storedDocument('model.xlsx'), storedDocument('memo.pdf')];
    vi.spyOn(vault, 'list').mockResolvedValueOnce([]).mockResolvedValueOnce(documents);
    const storeMany = vi.spyOn(vault, 'storeMany').mockResolvedValueOnce(documents);
    const fetch = vi.spyOn(globalThis, 'fetch');
    render(<DataRoomPage projectId="p1" vault={vault} />);
    await screen.findByText('\u5c1a\u672a\u4e0a\u4f20\u8d44\u6599');

    const files = [
      new File(['model'], 'model.xlsx', { type: 'application/vnd.ms-excel' }),
      new File(['memo'], 'memo.pdf', { type: 'application/pdf' }),
    ];
    const input = screen.getByLabelText<HTMLInputElement>('\u4e0a\u4f20\u8d44\u6599');
    Object.defineProperty(input, 'value', {
      configurable: true,
      value: 'C:\\fakepath\\model.xlsx',
      writable: true,
    });
    fireEvent.change(input, { target: { files } });

    expect(await screen.findByText('model.xlsx')).toBeInTheDocument();
    expect(screen.getByText('memo.pdf')).toBeInTheDocument();
    expect(storeMany).toHaveBeenCalledWith('p1', files);
    expect(input.value).toBe('');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [
      new FileVaultError('unsupported-file', 'unsupported'),
      '\u65e0\u6cd5\u4fdd\u5b58\u6240\u9009\u8d44\u6599\uff0c\u8bf7\u68c0\u67e5\u6587\u4ef6\u540e\u91cd\u8bd5\u3002',
    ],
    [
      new FileVaultError('quota-exceeded', 'full'),
      '\u672c\u5730\u5b58\u50a8\u7a7a\u95f4\u4e0d\u8db3\uff0c\u8bf7\u6e05\u7406\u6d4f\u89c8\u5668\u5b58\u50a8\u540e\u91cd\u8bd5\u3002',
    ],
  ])('shows a localized upload error and retains persisted documents', async (error, message) => {
    const vault = createVault();
    const existing = [storedDocument('existing.pdf')];
    vi.spyOn(vault, 'list').mockResolvedValueOnce(existing).mockResolvedValueOnce(existing);
    vi.spyOn(vault, 'storeMany').mockRejectedValueOnce(error);
    render(<DataRoomPage projectId="p1" vault={vault} />);
    await screen.findByText('existing.pdf');

    fireEvent.change(screen.getByLabelText('\u4e0a\u4f20\u8d44\u6599'), {
      target: { files: [new File(['new'], 'new.pdf', { type: 'application/pdf' })] },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByText('existing.pdf')).toBeInTheDocument();
  });

  it('clears the input after failure so the same file can be retried', async () => {
    const vault = createVault();
    const saved = storedDocument('retry.pdf');
    vi.spyOn(vault, 'list')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([saved]);
    const storeMany = vi.spyOn(vault, 'storeMany')
      .mockRejectedValueOnce(new FileVaultError('invalid-file', 'invalid'))
      .mockResolvedValueOnce([saved]);
    render(<DataRoomPage projectId="p1" vault={vault} />);
    await screen.findByText('\u5c1a\u672a\u4e0a\u4f20\u8d44\u6599');

    const file = new File(['retry'], 'retry.pdf', { type: 'application/pdf' });
    const input = screen.getByLabelText<HTMLInputElement>('\u4e0a\u4f20\u8d44\u6599');
    Object.defineProperty(input, 'value', {
      configurable: true,
      value: 'C:\\fakepath\\retry.pdf',
      writable: true,
    });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(input.value).toBe('');

    input.value = 'C:\\fakepath\\retry.pdf';
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText('retry.pdf')).toBeInTheDocument();
    expect(storeMany).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input.value).toBe('');
  });

  it('disables upload while busy and keeps keyboard focus visible on the styled label', async () => {
    const vault = createVault();
    const upload = deferred<StoredDocument[]>();
    const saved = storedDocument('busy.pdf');
    vi.spyOn(vault, 'list').mockResolvedValueOnce([]).mockResolvedValueOnce([saved]);
    vi.spyOn(vault, 'storeMany').mockReturnValueOnce(upload.promise);
    render(<DataRoomPage projectId="p1" vault={vault} />);
    await screen.findByText('\u5c1a\u672a\u4e0a\u4f20\u8d44\u6599');

    const input = screen.getByLabelText<HTMLInputElement>('\u4e0a\u4f20\u8d44\u6599');
    input.focus();
    expect(input).toHaveFocus();
    expect(input.closest('label')).toHaveClass('data-room-upload');

    fireEvent.change(input, {
      target: { files: [new File(['busy'], 'busy.pdf', { type: 'application/pdf' })] },
    });

    expect(input).toBeDisabled();
    expect(input.closest('label')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('region', { name: '\u8d44\u6599\u4e2d\u5fc3' })).toHaveAttribute(
      'aria-busy',
      'true',
    );

    await act(async () => {
      upload.resolve([saved]);
      await upload.promise;
    });
    await waitFor(() => expect(input).not.toBeDisabled());
  });
});
