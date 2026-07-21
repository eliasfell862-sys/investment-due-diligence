import { describe, expect, it } from 'vitest';
import { AppDb } from '../db/app-db';
import { FileVault } from './file-vault';

describe('FileVault', () => {
  it('stores the original document in IndexedDB', async () => {
    const db = new AppDb(`files-${crypto.randomUUID()}`);
    const vault = new FileVault(db);
    const file = new File(['sample'], 'bp.pdf', { type: 'application/pdf' });
    const stored = await vault.store('p1', file);
    expect(stored.name).toBe('bp.pdf');
    expect(await vault.list('p1')).toHaveLength(1);
    await db.delete();
  });
});
