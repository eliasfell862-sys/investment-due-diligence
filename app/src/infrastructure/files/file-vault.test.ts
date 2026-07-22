/// <reference types="node" />
import { File as NativeFile } from 'node:buffer';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { AppDb, type StoredDocument } from '../db/app-db';
import { FileVault, FileVaultError } from './file-vault';

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

function makeFile(
  name = 'bp.pdf',
  contents: string | Uint8Array = 'sample',
  type = 'application/pdf',
) {
  return new NativeFile([contents], name, { type }) as unknown as File;
}

function readBlob(blob: Blob): Promise<Uint8Array> {
  return new Response(blob).arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

describe('FileVault', () => {
  it('models persisted documents as stored until a real status transition exists', () => {
    expectTypeOf<StoredDocument['parseStatus']>().toEqualTypeOf<'stored'>();
  });

  let db: AppDb | undefined;

  afterEach(async () => {
    await db?.delete();
    db = undefined;
  });

  function createDb() {
    db = new AppDb(`files-${crypto.randomUUID()}`);
    return db;
  }

  it('stores complete metadata and the original bytes in IndexedDB', async () => {
    const database = createDb();
    const bytes = new Uint8Array([0, 1, 2, 127, 255]);
    const vault = new FileVault(database, {
      createId: () => 'doc-1',
      now: () => new Date('2026-07-21T08:00:00.000Z'),
    });

    const stored = await vault.store(' project-1 ', makeFile(' diligence.PDF ', bytes));
    const persisted = await database.documents.get(stored.id);

    expect(stored).toMatchObject({
      id: 'doc-1',
      projectId: 'project-1',
      name: 'diligence.PDF',
      mimeType: 'application/pdf',
      size: bytes.byteLength,
      uploadedAt: '2026-07-21T08:00:00.000Z',
      parseStatus: 'stored',
    });
    expect(await readBlob(persisted!.blob)).toEqual(bytes);
  });

  it.each([
    ['', makeFile(), 'invalid-project'],
    ['   ', makeFile(), 'invalid-project'],
    ['p1', makeFile('   '), 'invalid-file'],
    ['p1', makeFile(`${'a'.repeat(252)}.pdf`), 'invalid-file'],
    ['p1', makeFile('notes.txt'), 'unsupported-file'],
    ['p1', makeFile('no-extension'), 'unsupported-file'],
    ['p1', makeFile('empty.pdf', ''), 'invalid-file'],
  ])('rejects invalid input with %s / %s as %s', async (projectId, file, code) => {
    const vault = new FileVault(createDb());

    await expect(vault.store(projectId, file)).rejects.toMatchObject({ code });
  });

  it('rejects files over 100 MiB', async () => {
    const file = makeFile('large.pdf');
    Object.defineProperty(file, 'size', { value: MAX_FILE_SIZE_BYTES + 1 });
    const vault = new FileVault(createDb());

    await expect(vault.store('p1', file)).rejects.toMatchObject({ code: 'file-too-large' });
  });

  it('keeps projects isolated', async () => {
    const vault = new FileVault(createDb());
    await vault.store('p1', makeFile('one.pdf'));
    await vault.store('p2', makeFile('two.pdf'));

    expect((await vault.list('p1')).map(({ name }) => name)).toEqual(['one.pdf']);
    expect((await vault.list('p2')).map(({ name }) => name)).toEqual(['two.pdf']);
  });

  it('lists newest first with id ascending as the timestamp tie-breaker', async () => {
    const ids = ['b', 'a', 'c'];
    const dates = [
      new Date('2026-07-20T08:00:00.000Z'),
      new Date('2026-07-21T08:00:00.000Z'),
      new Date('2026-07-21T08:00:00.000Z'),
    ];
    const vault = new FileVault(createDb(), {
      createId: () => ids.shift()!,
      now: () => dates.shift()!,
    });
    await vault.store('p1', makeFile('old.pdf'));
    await vault.store('p1', makeFile('first.pdf'));
    await vault.store('p1', makeFile('second.pdf'));

    expect((await vault.list('p1')).map(({ id }) => id)).toEqual(['a', 'c', 'b']);
  });

  it('validates project ids when listing', async () => {
    const vault = new FileVault(createDb());

    await expect(vault.list('   ')).rejects.toMatchObject({ code: 'invalid-project' });
  });

  it('reports duplicate generated ids without overwriting the existing file', async () => {
    const vault = new FileVault(createDb(), { createId: () => 'duplicate' });
    await vault.store('p1', makeFile('first.pdf'));

    await expect(vault.store('p1', makeFile('second.pdf'))).rejects.toMatchObject({
      code: 'duplicate-id',
    });
    expect((await vault.list('p1')).map(({ name }) => name)).toEqual(['first.pdf']);
  });

  it('rolls back the entire batch when any generated id collides', async () => {
    const vault = new FileVault(createDb(), { createId: () => 'duplicate' });

    await expect(
      vault.storeMany('p1', [makeFile('first.pdf'), makeFile('second.pdf')]),
    ).rejects.toMatchObject({ code: 'duplicate-id' });
    expect(await vault.list('p1')).toEqual([]);
  });

  it('validates every file before starting a batch write', async () => {
    const database = createDb();
    const transaction = vi.spyOn(database, 'transaction');
    const vault = new FileVault(database);

    await expect(
      vault.storeMany('p1', [makeFile('valid.pdf'), makeFile('invalid.txt')]),
    ).rejects.toMatchObject({ code: 'unsupported-file' });
    expect(transaction).not.toHaveBeenCalled();
    expect(await vault.list('p1')).toEqual([]);
  });


  it('rejects batches with more than 50 files before opening a transaction', async () => {
    const database = createDb();
    const transaction = vi.spyOn(database, 'transaction');
    const vault = new FileVault(database);
    const files = Array.from({ length: 51 }, (_, index) => makeFile(`file-${index}.pdf`));

    await expect(vault.storeMany('p1', files)).rejects.toMatchObject({
      code: 'batch-too-large',
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects batches over 250 MiB before opening a transaction', async () => {
    const database = createDb();
    const transaction = vi.spyOn(database, 'transaction');
    const vault = new FileVault(database);
    const files = ['one.pdf', 'two.pdf', 'three.pdf'].map((name) => {
      const file = makeFile(name);
      Object.defineProperty(file, 'size', { value: 90 * 1024 * 1024 });
      return file;
    });

    await expect(vault.storeMany('p1', files)).rejects.toMatchObject({
      code: 'batch-too-large',
    });
    expect(transaction).not.toHaveBeenCalled();
  });
  it('translates quota failures to a typed error', async () => {
    const database = createDb();
    vi.spyOn(database, 'transaction').mockRejectedValueOnce(
      Object.assign(new Error('full'), { name: 'QuotaExceededError' }),
    );
    const vault = new FileVault(database);

    const error = await vault.store('p1', makeFile()).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(FileVaultError);
    expect(error).toMatchObject({ code: 'quota-exceeded' });
  });
});
