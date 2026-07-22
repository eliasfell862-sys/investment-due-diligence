import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EvidenceItem } from '../../domain/evidence/evidence';
import { resolveEvidenceConflict } from '../../domain/evidence/resolve-conflict';
import { findTargetFieldDefinition } from '../../domain/evidence/target-fields';
import { AppDb } from './app-db';
import { EvidenceRepository } from './evidence-repository';

function evidence(
  id: string,
  normalizedValue: string,
  overrides: Partial<EvidenceItem> = {},
): EvidenceItem {
  return {
    id,
    projectId: 'project-1',
    fieldId: 'revenue',
    periodIdentity: '2025',
    dimensionIdentity: 'company=acme',
    normalizedValue,
    importBatchId: 'batch-1',
    sourceDocumentId: 'document-1',
    sourceSheet: 'Financials',
    sourceRow: 2,
    sourceLocator: 'Financials!B2',
    rawValue: normalizedValue,
    confidence: 0.8,
    conflictStatus: 'none',
    updatedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('EvidenceRepository', () => {
  let db: AppDb;
  let repository: EvidenceRepository;

  beforeEach(() => {
    db = new AppDb(`evidence-repository-${crypto.randomUUID()}`);
    repository = new EvidenceRepository(db);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('rejects an invalid batch before writing any row', async () => {
    await repository.saveMany([evidence('existing', '100')]);

    await expect(
      repository.saveMany([
        evidence('valid-new', '120'),
        evidence('invalid', 'not-a-number'),
      ]),
    ).rejects.toMatchObject({ code: 'invalid-evidence' });

    expect((await repository.listByProject('project-1')).map(({ id }) => id)).toEqual([
      'existing',
    ]);
  });

  it('replays stable evidence IDs idempotently with bulk upsert', async () => {
    const batch = [
      evidence('b', '120', { sourceRow: 3 }),
      evidence('a', '100', { sourceRow: 2 }),
    ];

    await repository.saveMany(batch);
    const first = await repository.listByProject('project-1');
    await repository.saveMany(batch);

    expect(await db.evidence.count()).toBe(2);
    expect(await repository.listByProject('project-1')).toEqual(first);
    expect(batch.map((item) => item.conflictStatus)).toEqual(['none', 'none']);
  });

  it('marks every disagreeing row in one full identity group unresolved', async () => {
    await repository.saveMany([
      evidence('high', '120'),
      evidence('low', '100', { sourceRow: 3 }),
    ]);

    expect(
      (await repository.listByProject('project-1')).map(({ id, conflictStatus }) => ({
        id,
        conflictStatus,
      })),
    ).toEqual([
      { id: 'high', conflictStatus: 'unresolved' },
      { id: 'low', conflictStatus: 'unresolved' },
    ]);
  });

  it('uses the canonical target direction for conservative numeric resolution', async () => {
    await repository.saveMany([
      evidence('high', '120'),
      evidence('low', '100', { sourceRow: 3 }),
    ]);
    const definition = findTargetFieldDefinition('revenue');
    if (!definition) {
      throw new Error('Expected revenue target definition');
    }

    const resolution = resolveEvidenceConflict(
      await repository.listByProject('project-1'),
      definition.direction,
    );

    expect(resolution).toMatchObject({
      status: 'provisional',
      analysisValue: '100',
      selectedEvidenceId: 'low',
    });
  });

  it('resets an affected group to none when an overwrite makes values agree', async () => {
    await repository.saveMany([
      evidence('a', '100'),
      evidence('b', '120', { sourceRow: 3 }),
    ]);

    await repository.saveMany([
      evidence('b', '100', { sourceRow: 3, conflictStatus: 'resolved' }),
    ]);

    expect(
      (await repository.listByProject('project-1')).map(({ id, conflictStatus }) => ({
        id,
        conflictStatus,
      })),
    ).toEqual([
      { id: 'a', conflictStatus: 'none' },
      { id: 'b', conflictStatus: 'none' },
    ]);
  });

  it('recomputes both old and new identity groups when an ID moves', async () => {
    await repository.saveMany([
      evidence('a', '100'),
      evidence('b', '120', { sourceRow: 3 }),
    ]);

    await repository.saveMany([
      evidence('b', '120', { periodIdentity: '2024', sourceRow: 3 }),
    ]);

    expect(
      (await repository.listByProject('project-1')).map(
        ({ id, periodIdentity, conflictStatus }) => ({ id, periodIdentity, conflictStatus }),
      ),
    ).toEqual([
      { id: 'b', periodIdentity: '2024', conflictStatus: 'none' },
      { id: 'a', periodIdentity: '2025', conflictStatus: 'none' },
    ]);
  });

  it('isolates conflicts across project, field, period, and dimension identities', async () => {
    await repository.saveMany([
      evidence('base', '100'),
      evidence('other-project', '120', { projectId: 'project-2' }),
      evidence('other-field', '0.4', { fieldId: 'gross_margin' }),
      evidence('other-period', '120', { periodIdentity: '2024' }),
      evidence('other-dimension', '120', { dimensionIdentity: 'company=beta' }),
    ]);

    expect(
      [...await repository.listByProject('project-1'), ...await repository.listByProject('project-2')]
        .every((item) => item.conflictStatus === 'none'),
    ).toBe(true);
  });

  it('serializes concurrent writes and leaves the complete group unresolved', async () => {
    await Promise.all([
      repository.saveMany([evidence('a', '100')]),
      repository.saveMany([evidence('b', '120', { sourceRow: 3 })]),
    ]);

    expect(await db.evidence.count()).toBe(2);
    expect(
      (await repository.listByProject('project-1')).map((item) => item.conflictStatus),
    ).toEqual(['unresolved', 'unresolved']);
  });

  it('returns deterministic identity ordering independent of write order', async () => {
    await repository.saveMany([
      evidence('z', '1', { fieldId: 'net_profit', periodIdentity: '2025' }),
      evidence('c', '1', { fieldId: 'revenue', periodIdentity: '2025', dimensionIdentity: 'b' }),
      evidence('b', '1', { fieldId: 'revenue', periodIdentity: '2025', dimensionIdentity: 'a' }),
      evidence('a', '1', { fieldId: 'revenue', periodIdentity: '2024', dimensionIdentity: 'z' }),
    ]);

    expect((await repository.listByProject('project-1')).map(({ id }) => id)).toEqual([
      'z',
      'a',
      'b',
      'c',
    ]);
  });
});
