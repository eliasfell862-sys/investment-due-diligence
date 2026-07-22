import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from './evidence';
import { resolveEvidenceConflict } from './resolve-conflict';

interface CandidateIdentityOverrides {
  readonly projectId?: string;
  readonly fieldId?: string;
  readonly periodIdentity?: string;
  readonly dimensionIdentity?: string;
}

const candidate = (
  id: string,
  normalizedValue: string,
  overrides: CandidateIdentityOverrides = {},
) => ({
  id,
  projectId: overrides.projectId ?? 'p1',
  fieldId: overrides.fieldId ?? 'monthly_active_users',
  periodIdentity: overrides.periodIdentity ?? '2025',
  dimensionIdentity: overrides.dimensionIdentity ?? 'company=acme',
  normalizedValue,
});

const item = (
  id: string,
  value: string,
  overrides: Partial<EvidenceItem> = {},
): EvidenceItem => ({
  id,
  importBatchId: 'batch-1',
  projectId: 'p1',
  fieldId: 'monthly_active_users',
  periodIdentity: '2025',
  dimensionIdentity: 'company=acme',
  sourceSheet: 'Sheet1',
  sourceRow: 2,
  rawValue: value,
  normalizedValue: value,
  confidence: 0.8,
  conflictStatus: 'unresolved',
  updatedAt: '2026-07-21T00:00:00.000Z',
  ...overrides,
});

describe('resolveEvidenceConflict', () => {
  it('reports missing evidence with the complete blocking state', () => {
    expect(resolveEvidenceConflict([], 'higher_is_better')).toEqual({
      status: 'missing',
      analysisValue: null,
      selectedEvidenceId: null,
      requiresConfirmation: false,
      blocksConclusion: true,
    });
  });

  it('accepts a single valid numeric value as agreed and canonicalizes it', () => {
    expect(resolveEvidenceConflict([candidate('only', '1.00')], 'higher_is_better')).toEqual({
      status: 'agreed',
      analysisValue: '1',
      selectedEvidenceId: 'only',
      requiresConfirmation: false,
      blocksConclusion: false,
    });
  });

  it('accepts a single valid neutral text value as agreed', () => {
    expect(resolveEvidenceConflict([candidate('only', 'licensed')], 'neutral')).toEqual({
      status: 'agreed',
      analysisValue: 'licensed',
      selectedEvidenceId: 'only',
      requiresConfirmation: false,
      blocksConclusion: false,
    });
  });

  it('uses the lower value for positive metrics', () => {
    expect(
      resolveEvidenceConflict(
        [item('bp', '5000000'), item('backend', '2000000')],
        'higher_is_better',
      ),
    ).toEqual({
      status: 'provisional',
      analysisValue: '2000000',
      selectedEvidenceId: 'backend',
      requiresConfirmation: true,
      blocksConclusion: false,
    });
  });

  it('uses the higher value for risk or cost metrics', () => {
    expect(
      resolveEvidenceConflict(
        [item('bp', '8'), item('crm', '15')],
        'lower_is_better',
      ),
    ).toEqual({
      status: 'provisional',
      analysisValue: '15',
      selectedEvidenceId: 'crm',
      requiresConfirmation: true,
      blocksConclusion: false,
    });
  });

  it('blocks non-orderable conflicts', () => {
    expect(
      resolveEvidenceConflict(
        [item('a', 'licensed'), item('b', 'unlicensed')],
        'neutral',
      ),
    ).toEqual({
      status: 'blocked',
      analysisValue: null,
      selectedEvidenceId: null,
      requiresConfirmation: true,
      blocksConclusion: true,
    });
  });

  it.each(['abc', '', ' ', 'NaN', 'Infinity', '-Infinity'])(
    'blocks invalid ordered value %j without throwing',
    (value) => {
      let result: ReturnType<typeof resolveEvidenceConflict> | undefined;

      expect(() => {
        result = resolveEvidenceConflict([candidate('bad', value)], 'higher_is_better');
      }).not.toThrow();
      expect(result).toEqual({
        status: 'invalid',
        analysisValue: null,
        selectedEvidenceId: null,
        requiresConfirmation: true,
        blocksConclusion: true,
      });
    },
  );

  it('treats identical neutral strings as agreed and chooses the lowest id', () => {
    expect(
      resolveEvidenceConflict(
        [candidate('z-source', 'licensed'), candidate('a-source', 'licensed')],
        'neutral',
      ),
    ).toEqual({
      status: 'agreed',
      analysisValue: 'licensed',
      selectedEvidenceId: 'a-source',
      requiresConfirmation: false,
      blocksConclusion: false,
    });
  });

  it('treats equivalent numeric forms as agreed regardless of input order', () => {
    expect(
      resolveEvidenceConflict(
        [candidate('z-source', '1.00'), candidate('a-source', '1')],
        'lower_is_better',
      ),
    ).toEqual({
      status: 'agreed',
      analysisValue: '1',
      selectedEvidenceId: 'a-source',
      requiresConfirmation: false,
      blocksConclusion: false,
    });
  });

  it('chooses the lowest id when multiple items share the conservative value', () => {
    expect(
      resolveEvidenceConflict(
        [
          candidate('z-source', '2.00'),
          candidate('other', '3'),
          candidate('a-source', '2'),
        ],
        'higher_is_better',
      ),
    ).toEqual({
      status: 'provisional',
      analysisValue: '2',
      selectedEvidenceId: 'a-source',
      requiresConfirmation: true,
      blocksConclusion: false,
    });
  });

  it('blocks candidates from mixed projects', () => {
    expect(
      resolveEvidenceConflict(
        [candidate('a', '1'), candidate('b', '2', { projectId: 'p2' })],
        'higher_is_better',
      ),
    ).toEqual({
      status: 'invalid',
      analysisValue: null,
      selectedEvidenceId: null,
      requiresConfirmation: true,
      blocksConclusion: true,
    });
  });

  it('blocks candidates from mixed fields', () => {
    expect(
      resolveEvidenceConflict(
        [candidate('a', '1'), candidate('b', '2', { fieldId: 'annual_revenue' })],
        'higher_is_better',
      ),
    ).toEqual({
      status: 'invalid',
      analysisValue: null,
      selectedEvidenceId: null,
      requiresConfirmation: true,
      blocksConclusion: true,
    });
  });

  it('blocks candidates from mixed periods', () => {
    expect(
      resolveEvidenceConflict(
        [candidate('a', '100', { periodIdentity: '2024' }), candidate('b', '120')],
        'higher_is_better',
      ),
    ).toEqual({
      status: 'invalid',
      analysisValue: null,
      selectedEvidenceId: null,
      requiresConfirmation: true,
      blocksConclusion: true,
    });
  });

  it('blocks candidates from mixed dimensions', () => {
    expect(
      resolveEvidenceConflict(
        [
          candidate('a', '100', { dimensionIdentity: 'company=acme' }),
          candidate('b', '120', { dimensionIdentity: 'company=globex' }),
        ],
        'higher_is_better',
      ),
    ).toEqual({
      status: 'invalid',
      analysisValue: null,
      selectedEvidenceId: null,
      requiresConfirmation: true,
      blocksConclusion: true,
    });
  });

  it.each([
    ['id', { id: '' }],
    ['projectId', { projectId: ' ' }],
    ['fieldId', { fieldId: '' }],
  ] as const)('blocks an empty %s', (_name, overrides) => {
    expect(
      resolveEvidenceConflict(
        [{ ...candidate('source', '1'), ...overrides }],
        'higher_is_better',
      ),
    ).toEqual({
      status: 'invalid',
      analysisValue: null,
      selectedEvidenceId: null,
      requiresConfirmation: true,
      blocksConclusion: true,
    });
  });

  it('accepts full evidence items without letting confidence or conflict flags alter selection', () => {
    expect(
      resolveEvidenceConflict(
        [
          item('low-confidence', '2', { confidence: 0.01, conflictStatus: 'none' }),
          item('high-confidence', '5', { confidence: 1, conflictStatus: 'resolved' }),
        ],
        'higher_is_better',
      ),
    ).toMatchObject({
      status: 'provisional',
      analysisValue: '2',
      selectedEvidenceId: 'low-confidence',
    });
  });

  it('does not mutate frozen inputs', () => {
    const first = Object.freeze(candidate('b', '3'));
    const second = Object.freeze(candidate('a', '2'));
    const items = Object.freeze([first, second]);

    expect(() => resolveEvidenceConflict(items, 'higher_is_better')).not.toThrow();
    expect(items).toEqual([first, second]);
  });

  it('compares huge, exponent, and long-precision values without number coercion', () => {
    expect(
      resolveEvidenceConflict(
        [candidate('huge', '1e1000'), candidate('smaller-huge', '9e999')],
        'higher_is_better',
      ),
    ).toMatchObject({ analysisValue: '9e+999', selectedEvidenceId: 'smaller-huge' });

    expect(
      resolveEvidenceConflict(
        [
          candidate('larger', '1.0000000000000000000000000000000000002'),
          candidate('smaller', '1.0000000000000000000000000000000000001'),
        ],
        'higher_is_better',
      ),
    ).toMatchObject({
      analysisValue: '1.0000000000000000000000000000000000001',
      selectedEvidenceId: 'smaller',
    });

    expect(
      resolveEvidenceConflict(
        [candidate('exponent', '1000e-3'), candidate('plain', '1.00')],
        'lower_is_better',
      ),
    ).toMatchObject({ status: 'agreed', analysisValue: '1' });
  });
});
