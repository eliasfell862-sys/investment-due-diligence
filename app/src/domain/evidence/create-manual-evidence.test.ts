import { describe, expect, it } from 'vitest';
import {
  createManualEvidence,
  ManualEvidenceError,
  type ManualEvidenceInput,
} from './create-manual-evidence';

const NOW = new Date('2026-07-23T09:30:00+08:00');

function create(input: Partial<ManualEvidenceInput> = {}, id = 'manual-1') {
  return createManualEvidence({
    projectId: ' project-1 ',
    fieldId: 'team_summary',
    value: ' Core team has complementary experience. ',
    sourceType: 'investor_assumption',
    sourceNote: ' Based on investor diligence. ',
    ...input,
  }, { createId: () => id, now: () => NOW });
}

function expectCode(action: () => unknown, code: ManualEvidenceError['code']): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ManualEvidenceError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected ManualEvidenceError with code ${code}`);
}

describe('createManualEvidence', () => {
  it('creates frozen investor-assumption evidence with manual provenance', () => {
    const evidence = create();

    expect(evidence).toEqual({
      id: 'manual-1',
      projectId: 'project-1',
      fieldId: 'team_summary',
      periodIdentity: 'manual:undated',
      dimensionIdentity: 'project:project-1:default',
      normalizedValue: 'Core team has complementary experience.',
      importBatchId: 'manual-batch:manual-1',
      sourceType: 'investor_assumption',
      sourceSheet: '人工录入',
      sourceRow: 1,
      sourceLocator: '投资者假设',
      rawValue: 'Based on investor diligence.',
      confidence: 0.5,
      conflictStatus: 'none',
      updatedAt: '2026-07-23T01:30:00.000Z',
    });
    for (const property of [
      'sourceDocumentId',
      'sourceFragmentIds',
      'candidateId',
      'reviewAudit',
      'displayValue',
    ]) {
      expect(evidence).not.toHaveProperty(property);
    }
    expect(Object.isFrozen(evidence)).toBe(true);
  });

  it('creates a located document fact with canonical display behavior', () => {
    const evidence = create({
      fieldId: 'revenue',
      value: ' 1,200.00 ',
      sourceType: 'document_fact',
      sourceNote: ' Optional document context. ',
      sourceDocumentId: ' document-7 ',
      sourceLocator: ' 第 12 页 ',
    });

    expect(evidence).toMatchObject({
      normalizedValue: '1200',
      displayValue: '1,200.00',
      sourceDocumentId: 'document-7',
      sourceLocator: '第 12 页',
      sourceType: 'document_fact',
      rawValue: '1,200.00',
      confidence: 0.8,
    });
  });

  it('requires an interview note and uses interview provenance', () => {
    expectCode(() => create({
      sourceType: 'interview',
      sourceNote: ' ',
    }), 'invalid-source');

    expect(create({
      sourceType: 'interview',
      sourceNote: ' Founder interview on July 20. ',
    })).toMatchObject({
      sourceType: 'interview',
      sourceLocator: '人工访谈',
      rawValue: 'Founder interview on July 20.',
      confidence: 0.7,
    });
  });

  it('requires an explicit sourced period for management forecasts', () => {
    expectCode(() => create({
      sourceType: 'management_forecast',
      sourceNote: 'Management case.',
    }), 'invalid-period');
    expectCode(() => create({
      sourceType: 'management_forecast',
      periodIdentity: 'manual:past',
      sourceNote: 'Management case.',
    }), 'invalid-period');
    expectCode(() => create({
      sourceType: 'management_forecast',
      periodIdentity: '2027',
      sourceNote: undefined,
    }), 'invalid-source');
  });

  it('supports documented and note-only management forecasts', () => {
    expect(create({
      fieldId: 'revenue',
      value: '2000',
      sourceType: 'management_forecast',
      sourceNote: ' Optional forecast context. ',
      periodIdentity: ' FY2027 ',
      sourceDocumentId: ' budget-2027 ',
      sourceLocator: ' Plan!B12 ',
    })).toMatchObject({
      periodIdentity: 'FY2027',
      sourceDocumentId: 'budget-2027',
      sourceLocator: 'Plan!B12',
      rawValue: '2000',
      confidence: 0.6,
    });

    const noteOnly = create({
      fieldId: 'revenue',
      value: '2000',
      sourceType: 'management_forecast',
      periodIdentity: '2027',
      sourceNote: ' Management expects a new product launch. ',
    });
    expect(noteOnly).toMatchObject({
      periodIdentity: '2027',
      sourceLocator: '管理层预测',
      rawValue: 'Management expects a new product launch.',
      confidence: 0.6,
    });
    expect(noteOnly).not.toHaveProperty('sourceDocumentId');
  });

  it.each([
    [{ sourceDocumentId: 'document-1' }],
    [{ sourceLocator: '第 1 页' }],
  ] as const)('rejects partial document-fact provenance %#', (provenance) => {
    expectCode(() => create({
      sourceType: 'document_fact',
      sourceNote: undefined,
      ...provenance,
    }), 'invalid-source');
  });

  it('rejects partial document provenance for other source types', () => {
    expectCode(() => create({
      sourceType: 'management_forecast',
      periodIdentity: '2027',
      sourceDocumentId: 'document-1',
      sourceLocator: undefined,
    }), 'invalid-source');
    expectCode(() => create({
      sourceType: 'interview',
      sourceDocumentId: 'document-1',
    }), 'invalid-source');
  });

  it('rejects unknown fields and invalid numeric or percent values', () => {
    expectCode(() => create({ fieldId: 'unknown-field' }), 'invalid-field');
    expectCode(() => create({
      fieldId: 'revenue',
      value: 'twelve',
    }), 'invalid-value');
    expectCode(() => create({
      fieldId: 'gross_margin',
      value: '12%',
    }), 'invalid-value');
  });

  it('omits displayValue when numeric input is already canonical', () => {
    const evidence = create({ fieldId: 'revenue', value: '1200' });

    expect(evidence.normalizedValue).toBe('1200');
    expect(evidence).not.toHaveProperty('displayValue');
  });

  it('uses exact explicit dimension and generated defaults', () => {
    expect(create({
      projectId: 'project / 中文',
      dimensionIdentity: ' division:north ',
    }).dimensionIdentity).toBe('division:north');

    expect(create({ projectId: 'project / 中文' })).toMatchObject({
      periodIdentity: 'manual:undated',
      dimensionIdentity: 'project:project%20%2F%20%E4%B8%AD%E6%96%87:default',
    });
  });

  it('rejects invalid ids, dates, Unicode, and overlong values with typed codes', () => {
    expectCode(() => create({}, ' '), 'invalid-id');
    expectCode(() => create({}, '\ud800'), 'invalid-id');
    expectCode(() => create({}, 'x'.repeat(257)), 'invalid-id');
    expectCode(() => createManualEvidence({
      projectId: 'project-1',
      fieldId: 'team_summary',
      value: 'summary',
      sourceType: 'investor_assumption',
      sourceNote: 'note',
    }, { now: () => new Date(Number.NaN) }), 'invalid-date');
    expectCode(() => create({
      dimensionIdentity: '\ud800',
    }), 'invalid-dimension');
    expectCode(() => create({
      sourceNote: 'x'.repeat(65_537),
    }), 'invalid-source');
  });

  it('preserves the validation cause', () => {
    try {
      create({ fieldId: 'revenue', value: 'not-a-number' });
    } catch (error) {
      expect(error).toBeInstanceOf(ManualEvidenceError);
      expect((error as ManualEvidenceError).cause).toBeDefined();
      return;
    }
    throw new Error('Expected invalid numeric evidence');
  });
});
