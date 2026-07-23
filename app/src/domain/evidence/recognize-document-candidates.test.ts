import { describe, expect, it } from 'vitest';
import type { SourceFragment } from '../documents/source-fragment';
import {
  RecognitionError,
  recognizeDocumentCandidates,
} from './recognize-document-candidates';

const NOW = new Date('2026-07-23T09:30:00+08:00');

function fragment(
  id: string,
  normalizedText: string,
  overrides: Partial<SourceFragment> = {},
): SourceFragment {
  return {
    id,
    projectId: 'project-1',
    documentId: 'document-1',
    documentVersionId: 'version-1',
    sourceKind: 'pdf_text',
    locator: { pageNumber: Number(id.replace(/\D/g, '')) || 1 },
    rawText: normalizedText,
    normalizedText,
    extractionMethod: 'pdfjs',
    extractionVersion: '1.0.0',
    contentHash: `sha256:${id}`,
    createdAt: '2026-07-23T01:00:00.000Z',
    ...overrides,
  };
}

function recognize(
  fragments: readonly SourceFragment[],
  now: () => Date = () => NOW,
) {
  return recognizeDocumentCandidates(
    ' project-1 ',
    ' document-1 ',
    fragments,
    { now },
  );
}

function expectCode(action: () => unknown, code: RecognitionError['code']): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(RecognitionError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected RecognitionError with code ${code}`);
}

describe('recognizeDocumentCandidates', () => {
  it('recognizes exact company, revenue, and gross-margin lines', () => {
    const candidates = recognize([
      fragment('fragment-1', [
        '公司名称：星河科技',
        '2025 年 营业收入：1.2 亿元',
        '2025 年 毛利率：48%',
      ].join('\n')),
    ]);

    expect(candidates.map((candidate) => ({
      fieldId: candidate.fieldId,
      normalizedValue: candidate.normalizedValue,
      displayValue: candidate.displayValue,
      periodIdentity: candidate.periodIdentity,
      sourceFragmentIds: candidate.sourceFragmentIds,
      confidence: candidate.confidence,
    }))).toEqual([
      {
        fieldId: 'company_name',
        normalizedValue: '星河科技',
        displayValue: '星河科技',
        periodIdentity: 'source-document:document-1:undated',
        sourceFragmentIds: ['fragment-1'],
        confidence: 0.9,
      },
      {
        fieldId: 'gross_margin',
        normalizedValue: '0.48',
        displayValue: '48%',
        periodIdentity: '2025-12-31',
        sourceFragmentIds: ['fragment-1'],
        confidence: 0.82,
      },
      {
        fieldId: 'revenue',
        normalizedValue: '120000000',
        displayValue: '1.2 亿元',
        periodIdentity: '2025-12-31',
        sourceFragmentIds: ['fragment-1'],
        confidence: 0.82,
      },
    ]);
  });

  it('supports Chinese and case-insensitive English labels and full-width punctuation', () => {
    const candidates = recognize([
      fragment('fragment-1', [
        '公司简介： 面向工业客户的分析平台',
        'TEAM: Operators and engineers',
        'Product： Risk analytics',
        'MARKET: Advanced manufacturing',
        'Company Name： Acme Labs',
        'Gross Margin： 12.5％',
      ].join('\r\n')),
    ]);

    expect(candidates.map(({ fieldId, normalizedValue }) => [fieldId, normalizedValue]))
      .toEqual([
        ['business_description', '面向工业客户的分析平台'],
        ['company_name', 'Acme Labs'],
        ['gross_margin', '0.125'],
        ['market_summary', 'Advanced manufacturing'],
        ['product_summary', 'Risk analytics'],
        ['team_summary', 'Operators and engineers'],
      ]);
  });

  it.each([
    ['营业收入：1.2 亿元', '120000000'],
    ['营业收入：1,200 万元', '12000000'],
    ['营业收入：-500 万', '-5000000'],
    ['Revenue: RMB 2.5 亿', '250000000'],
    ['Revenue: 300 CNY', '300'],
  ])('parses the currency value in %s', (line, expected) => {
    expect(recognize([fragment('fragment-1', line)])[0]?.normalizedValue).toBe(expected);
  });

  it.each([
    '营业收入：1,20 万元',
    '营业收入：1.2 亿元 万元',
    '营业收入：人民币 RMB 100 万元',
    'Revenue: Infinity CNY',
    'Revenue: about 20 million',
  ])('ignores malformed or prose currency values: %s', (line) => {
    expect(recognize([fragment('fragment-1', line)])).toEqual([]);
  });

  it('treats a percent-free gross margin as an already normalized decimal', () => {
    expect(recognize([fragment('fragment-1', '毛利率：0.48')])[0])
      .toMatchObject({ normalizedValue: '0.48', displayValue: '0.48' });
  });

  it('uses captured years and encoded undated document identities', () => {
    const candidates = recognizeDocumentCandidates(
      'project / 中文',
      'document / 中文',
      [fragment('fragment-1', '2026 Revenue: 100', {
        projectId: 'project / 中文',
        documentId: 'document / 中文',
      })],
      { now: () => NOW },
    );

    expect(candidates[0]).toMatchObject({
      periodIdentity: '2026-12-31',
      dimensionIdentity: 'project:project%20%2F%20%E4%B8%AD%E6%96%87:default',
    });
    expect(recognizeDocumentCandidates(
      'project / 中文',
      'document / 中文',
      [fragment('fragment-1', 'Company: Acme', {
        projectId: 'project / 中文',
        documentId: 'document / 中文',
      })],
      { now: () => NOW },
    )[0]?.periodIdentity).toBe(
      'source-document:document%20%2F%20%E4%B8%AD%E6%96%87:undated',
    );
  });

  it('recognizes a dated management ARR forecast', () => {
    expect(recognize([
      fragment('fragment-1', '管理层预测：2026 年 ARR：2 亿元'),
    ])[0]).toMatchObject({
      fieldId: 'arr',
      normalizedValue: '200000000',
      displayValue: '2 亿元',
      periodIdentity: '2026-12-31',
      sourceTypeHint: 'management_forecast',
    });
  });

  it('keeps an equal document fact and management forecast separate', () => {
    const candidates = recognize([
      fragment('fragment-1', '2026 ARR：2 亿元\n预测：2026 ARR：2 亿元'),
    ]);

    expect(candidates).toHaveLength(2);
    expect(candidates.map(({ sourceTypeHint }) => sourceTypeHint).sort()).toEqual([
      'document_fact',
      'management_forecast',
    ]);
    expect(candidates[0]?.id).not.toBe(candidates[1]?.id);
  });

  it('merges duplicate lines and fragments using canonical document order', () => {
    const later = fragment('fragment-2', 'Revenue: 100', { locator: { pageNumber: 2 } });
    const earlier = fragment('fragment-1', 'Revenue: 100\nRevenue: 100', {
      locator: { pageNumber: 1 },
    });
    const forward = recognize([later, earlier]);
    const reverse = recognize([earlier, later]);

    expect(forward).toEqual(reverse);
    expect(forward).toHaveLength(1);
    expect(forward[0]?.sourceFragmentIds).toEqual(['fragment-1', 'fragment-2']);
  });

  it('creates stable ids, fingerprints, and one timestamp per call', () => {
    let clockCalls = 0;
    const now = () => {
      clockCalls += 1;
      return NOW;
    };
    const first = recognize([
      fragment('fragment-1', 'Revenue: 100\nGross Margin: 50%'),
    ], now);
    const repeat = recognize([
      fragment('fragment-1', 'Revenue: 100\nGross Margin: 50%'),
    ]);
    const changedValue = recognize([fragment('fragment-1', 'Revenue: 101')]);
    const changedSource = recognize([fragment('fragment-2', 'Revenue: 100')]);

    expect(clockCalls).toBe(1);
    expect(first).toEqual(repeat);
    expect(new Set(first.map(({ createdAt }) => createdAt))).toEqual(
      new Set(['2026-07-23T01:30:00.000Z']),
    );
    expect(first[1]?.candidateFingerprint).not.toBe(changedValue[0]?.candidateFingerprint);
    expect(first[1]?.candidateFingerprint).not.toBe(changedSource[0]?.candidateFingerprint);
    expect(first.every(({ id }) => /^document-candidate:[a-f0-9]{64}$/.test(id))).toBe(true);
    expect(first.every(({ candidateFingerprint }) => /^sha256:[a-f0-9]{64}$/.test(candidateFingerprint)))
      .toBe(true);
  });

  it.each([
    '我们的目标是收入快速增长',
    '市场毛利通常较高',
    '预计未来规模可观',
    '根据访谈，公司名称：星河科技',
    '本年 Revenue: 100 was achieved',
    '收入：100',
  ])('does not recognize unlabeled prose or partial labels: %s', (line) => {
    expect(recognize([fragment('fragment-1', line)])).toEqual([]);
  });

  it.each([
    'Company Overview', 'Team members', 'Market size', 'Product roadmap', 'Revenue 100', 'Gross Margin 50%', 'forecastRevenue: 100', '\u9884\u6d4bARR\uff1a2\u4ebf\u5143',
  ])('requires an explicit field label and forecast boundary: %s', (line) => {
    expect(recognize([fragment('fragment-1', line)])).toEqual([]);
  });

  it.each([
    ['Company: Acme', 'company_name', 'Acme', 'document_fact'], ['\u516c\u53f8\u540d\u79f0\uff1a\u661f\u6cb3\u79d1\u6280', 'company_name', '\u661f\u6cb3\u79d1\u6280', 'document_fact'], ['Revenue: 100', 'revenue', '100', 'document_fact'], ['\u8425\u4e1a\u6536\u5165\uff1a200', 'revenue', '200', 'document_fact'], ['forecast: 2026 ARR: 300', 'arr', '300', 'management_forecast'], ['forecast 2027 ARR: 400', 'arr', '400', 'management_forecast'],
  ] as const)('accepts an explicitly labeled field form: %s', (line, fieldId, normalizedValue, sourceTypeHint) => {
    expect(recognize([fragment('fragment-1', line)])[0]).toMatchObject({ fieldId, normalizedValue, sourceTypeHint });
  });

  it('does not infer chart or image values', () => {
    expect(recognize([
      fragment('fragment-1', 'Revenue: 100', { sourceKind: 'embedded_chart_data' }),
      fragment('fragment-2', 'Revenue: 200', {
        sourceKind: 'ocr',
        extractionMethod: 'tesseract',
      }),
    ])).toEqual([]);
  });

  it('falls back to raw text only when normalized text is blank', () => {
    expect(recognize([
      fragment('fragment-1', ' ', { rawText: 'Company: Raw Acme' }),
    ])[0]?.normalizedValue).toBe('Raw Acme');
  });

  it('rejects invalid boundary inputs and malformed fragments with typed causes', () => {
    expectCode(() => recognizeDocumentCandidates(' ', 'document-1', []), 'invalid-project');
    expectCode(() => recognizeDocumentCandidates('project-1', '\ud800', []), 'invalid-document');
    expectCode(() => recognizeDocumentCandidates('x'.repeat(257), 'document-1', []), 'invalid-project');
    expectCode(() => recognize([fragment('fragment-1', 'Revenue: 100', {
      projectId: 'other-project',
    })]), 'invalid-fragment');
    expectCode(() => recognize([fragment(' ', 'Revenue: 100')]), 'invalid-fragment');
    expectCode(() => recognize([fragment('fragment-1', 'Revenue: 100', {
      createdAt: 'not-a-date',
    })]), 'invalid-fragment');
  });

  it('wraps invalid and throwing clocks as invalid-date and uses Date intrinsics', () => {
    expectCode(() => recognize([], () => new Date(Number.NaN)), 'invalid-date');
    const clockFailure = new Error('clock failed');
    try {
      recognize([], () => { throw clockFailure; });
    } catch (error) {
      expect(error).toBeInstanceOf(RecognitionError);
      expect(error).toMatchObject({ code: 'invalid-date', cause: clockFailure });
    }

    class HostileDate extends Date {
      override getTime(): number { throw new Error('override must not run'); }
      override toISOString(): string { throw new Error('override must not run'); }
    }
    expect(recognize([], () => new HostileDate(NOW))).toEqual([]);
  });

  it('returns deeply frozen candidates and a frozen empty result', () => {
    const candidates = recognize([fragment('fragment-1', 'Revenue: 100')]);
    const empty = recognize([]);

    expect(Object.isFrozen(candidates)).toBe(true);
    expect(Object.isFrozen(candidates[0])).toBe(true);
    expect(Object.isFrozen(candidates[0]?.sourceFragmentIds)).toBe(true);
    expect(Object.isFrozen(empty)).toBe(true);
  });
});
