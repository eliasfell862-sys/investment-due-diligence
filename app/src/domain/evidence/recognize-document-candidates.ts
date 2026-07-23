import Decimal from 'decimal.js';
import type { SourceFragment } from '../documents/source-fragment';
import { parseSourceFragment } from '../documents/source-fragment.schema';
import { sha256Hex } from '../../shared/crypto/sha256';
import { canonicalizeEnUsNumber } from './canonicalize-en-us-number';
import type { EvidenceCandidate } from './evidence-candidate';
import { parseEvidenceCandidate } from './evidence-candidate.schema';
import { findTargetFieldDefinition } from './target-fields';
import { validateNormalizedTargetValue } from './validate-normalized-target-value';

export interface DocumentCandidateRecognitionOptions {
  readonly now?: () => Date;
}

export type RecognitionErrorCode =
  | 'invalid-project'
  | 'invalid-document'
  | 'invalid-fragment'
  | 'invalid-date'
  | 'invalid-value';

export class RecognitionError extends Error {
  readonly code: RecognitionErrorCode;
  override readonly cause: unknown;

  constructor(code: RecognitionErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'RecognitionError';
    this.code = code;
    this.cause = cause;
  }
}

interface RecognitionRule {
  readonly fieldId: string;
  readonly label: string;
  readonly confidence: number;
  readonly kind: 'text' | 'currency' | 'percent';
  readonly acceptsYear: boolean;
}

interface Match {
  readonly fieldId: string;
  readonly normalizedValue: string;
  readonly displayValue: string;
  readonly periodIdentity: string;
  readonly dimensionIdentity: string;
  readonly sourceTypeHint: 'document_fact' | 'management_forecast';
  readonly confidence: number;
}

interface Aggregate extends Match {
  readonly sourceFragmentIds: Set<string>;
}

const MAX_IDENTIFIER_LENGTH = 256;
const WS = String.raw`[\p{Zs}\t\f\v]`;
const FORECAST = String.raw`(?:管理层预测|预测|预计|目标|forecast|projection)`;
const FORECAST_SEPARATOR = String.raw`(?:${WS}*[\u003a\uff1a]${WS}*|${WS}+)`;
const VALUE_SEPARATOR = String.raw`${WS}*[\u003a\uff1a]${WS}*`;
const YEAR = String.raw`(?<year>\d{4})${WS}*年?${WS}*(?:[:：\-—]${WS}*)?`;

const rules: readonly RecognitionRule[] = [
  { fieldId: 'company_name', label: String.raw`(?:公司名称|项目名称|company${WS}+name|company)`, confidence: 0.9, kind: 'text', acceptsYear: false },
  { fieldId: 'business_description', label: String.raw`(?:业务简介|公司简介|business${WS}+description)`, confidence: 0.82, kind: 'text', acceptsYear: false },
  { fieldId: 'team_summary', label: String.raw`(?:核心团队|团队概览|team)`, confidence: 0.78, kind: 'text', acceptsYear: false },
  { fieldId: 'product_summary', label: String.raw`(?:核心产品|产品概览|product)`, confidence: 0.78, kind: 'text', acceptsYear: false },
  { fieldId: 'market_summary', label: String.raw`(?:目标市场|市场概览|market)`, confidence: 0.75, kind: 'text', acceptsYear: false },
  { fieldId: 'revenue', label: String.raw`(?:营业收入|营收|revenue)`, confidence: 0.82, kind: 'currency', acceptsYear: true },
  { fieldId: 'gross_margin', label: String.raw`(?:毛利率|gross${WS}+margin)`, confidence: 0.82, kind: 'percent', acceptsYear: true },
  { fieldId: 'arr', label: String.raw`(?:ARR|年度经常性收入)`, confidence: 0.82, kind: 'currency', acceptsYear: true },
];

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function requireIdentifier(
  value: unknown,
  code: 'invalid-project' | 'invalid-document' | 'invalid-fragment',
  label: string,
): string {
  const source = typeof value === 'string' ? value : '';
  const normalized = isWellFormedUnicode(source)
    ? source.normalize('NFC').trim()
    : '';
  if (
    normalized.length === 0
    || normalized.length > MAX_IDENTIFIER_LENGTH
    || !isWellFormedUnicode(normalized)
  ) {
    throw new RecognitionError(
      code,
      `${label} must be well-formed Unicode with 1-${MAX_IDENTIFIER_LENGTH} characters.`,
    );
  }
  return normalized;
}

function timestamp(now: () => Date): string {
  try {
    const value: unknown = now();
    const milliseconds = Date.prototype.getTime.call(value);
    if (!Number.isFinite(milliseconds)) {
      throw new RangeError('Recognition date must be valid.');
    }
    return Date.prototype.toISOString.call(value);
  } catch (error) {
    throw new RecognitionError('invalid-date', 'Recognition date creation failed.', error);
  }
}

function encodeIdentity(value: string, label: string): string {
  try {
    return encodeURIComponent(value);
  } catch (error) {
    throw new RecognitionError('invalid-value', `${label} cannot be encoded safely.`, error);
  }
}

function numberCorePattern(): string {
  return String.raw`[+-]?(?:\d[\d,.]*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)`;
}

function parseCurrency(value: string): string | null {
  const match = new RegExp(
    String.raw`^(?:(?<prefix>人民币|RMB|CNY)${WS}*)?`
      + String.raw`(?<core>${numberCorePattern()})${WS}*`
      + String.raw`(?<unit>万元|亿元|万|亿|元)?${WS}*`
      + String.raw`(?<suffix>人民币|RMB|CNY)?$`,
    'iu',
  ).exec(value);
  if (!match?.groups || (match.groups.prefix && match.groups.suffix)) return null;
  const canonical = canonicalizeEnUsNumber(match.groups.core);
  if (canonical.status !== 'valid') return null;
  const multiplier = match.groups.unit?.startsWith('万')
    ? '10000'
    : match.groups.unit?.startsWith('亿') ? '100000000' : '1';
  try {
    return new Decimal(canonical.canonicalValue).times(multiplier).toString();
  } catch {
    return null;
  }
}

function parsePercent(value: string): string | null {
  const match = new RegExp(
    String.raw`^(?<core>${numberCorePattern()})${WS}*(?<sign>[%％])?$`,
    'u',
  ).exec(value);
  if (!match?.groups) return null;
  const canonical = canonicalizeEnUsNumber(match.groups.core);
  if (canonical.status !== 'valid') return null;
  try {
    const decimal = new Decimal(canonical.canonicalValue);
    return (match.groups.sign ? decimal.dividedBy(100) : decimal).toString();
  } catch {
    return null;
  }
}

function matchRule(
  line: string,
  rule: RecognitionRule,
  undatedPeriodIdentity: string,
  dimensionIdentity: string,
): Match | null {
  const pattern = new RegExp(
    String.raw`^(?:(?<forecast>${FORECAST})${FORECAST_SEPARATOR})?`
      + (rule.acceptsYear ? String.raw`(?:${YEAR})?` : '')
      + String.raw`${rule.label}${VALUE_SEPARATOR}(?<value>.+)$`,
    'iu',
  );
  const matched = pattern.exec(line);
  if (!matched?.groups) return null;
  const displayValue = matched.groups.value?.trim() ?? '';
  if (displayValue.length === 0) return null;

  const year = matched.groups.year;
  if (year !== undefined) {
    const numericYear = Number(year);
    if (numericYear < 1900 || numericYear > 2200) return null;
  }

  let candidateValue: string | null;
  if (rule.kind === 'currency') candidateValue = parseCurrency(displayValue);
  else if (rule.kind === 'percent') candidateValue = parsePercent(displayValue);
  else candidateValue = displayValue.normalize('NFC').trim();
  if (candidateValue === null) return null;

  const definition = findTargetFieldDefinition(rule.fieldId);
  if (!definition) return null;
  const validation = validateNormalizedTargetValue(definition, candidateValue);
  if (validation.status !== 'valid') return null;
  return {
    fieldId: rule.fieldId,
    normalizedValue: validation.canonicalValue,
    displayValue,
    periodIdentity: year === undefined ? undatedPeriodIdentity : `${year}-12-31`,
    dimensionIdentity,
    sourceTypeHint: matched.groups.forecast
      ? 'management_forecast'
      : 'document_fact',
    confidence: rule.confidence,
  };
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareOptionalNumber(left: number | undefined, right: number | undefined): number {
  return (left ?? -1) - (right ?? -1);
}

function compareFragments(left: SourceFragment, right: SourceFragment): number {
  const leftPage = left.locator.pageNumber ?? left.locator.slideNumber;
  const rightPage = right.locator.pageNumber ?? right.locator.slideNumber;
  return compareOptionalNumber(leftPage, rightPage)
    || compareOptionalNumber(left.locator.tableIndex, right.locator.tableIndex)
    || compareOptionalNumber(left.locator.tableRow, right.locator.tableRow)
    || compareOptionalNumber(left.locator.tableColumn, right.locator.tableColumn)
    || compareText(left.locator.objectId ?? '', right.locator.objectId ?? '')
    || compareText(left.locator.objectName ?? '', right.locator.objectName ?? '')
    || compareText(JSON.stringify(left.locator.boundingBox ?? []), JSON.stringify(right.locator.boundingBox ?? []))
    || compareText(left.id, right.id);
}

function aggregateIdentity(match: Match): string {
  return JSON.stringify([
    match.fieldId,
    match.periodIdentity,
    match.dimensionIdentity,
    match.normalizedValue,
    match.sourceTypeHint,
  ]);
}

export function recognizeDocumentCandidates(
  projectId: string,
  documentId: string,
  fragments: readonly SourceFragment[],
  options: DocumentCandidateRecognitionOptions = {},
): EvidenceCandidate[] {
  const normalizedProjectId = requireIdentifier(projectId, 'invalid-project', 'Project id');
  const normalizedDocumentId = requireIdentifier(documentId, 'invalid-document', 'Document id');
  if (!Array.isArray(fragments)) {
    throw new RecognitionError('invalid-fragment', 'Fragments must be an array.');
  }
  const parsedFragments = fragments.map((input) => {
    let parsed: SourceFragment;
    try {
      parsed = parseSourceFragment(input);
    } catch (error) {
      throw new RecognitionError('invalid-fragment', 'Invalid source fragment.', error);
    }
    requireIdentifier(parsed.id, 'invalid-fragment', 'Source fragment id');
    if (
      parsed.projectId !== normalizedProjectId
      || parsed.documentId !== normalizedDocumentId
    ) {
      throw new RecognitionError(
        'invalid-fragment',
        'Every source fragment must belong to the requested project and document.',
      );
    }
    return parsed;
  }).sort(compareFragments);
  const createdAt = timestamp(options.now ?? (() => new Date()));
  const encodedProjectId = encodeIdentity(normalizedProjectId, 'Project id');
  const encodedDocumentId = encodeIdentity(normalizedDocumentId, 'Document id');
  const dimensionIdentity = `project:${encodedProjectId}:default`;
  const undatedPeriodIdentity = `source-document:${encodedDocumentId}:undated`;
  const aggregates = new Map<string, Aggregate>();

  for (const source of parsedFragments) {
    if (source.sourceKind === 'embedded_chart_data' || source.sourceKind === 'ocr') continue;
    const selectedText = source.normalizedText.trim().length > 0
      ? source.normalizedText
      : source.rawText;
    for (const rawLine of selectedText.split(/[\r\n]+/u)) {
      const line = rawLine.normalize('NFC').trim();
      if (line.length === 0) continue;
      for (const rule of rules) {
        const matched = matchRule(line, rule, undatedPeriodIdentity, dimensionIdentity);
        if (!matched) continue;
        const identity = aggregateIdentity(matched);
        const existing = aggregates.get(identity);
        if (existing) existing.sourceFragmentIds.add(source.id);
        else aggregates.set(identity, { ...matched, sourceFragmentIds: new Set([source.id]) });
        break;
      }
    }
  }

  const candidates = [...aggregates.values()].map((aggregate) => {
    const sourceFragmentIds = [...aggregate.sourceFragmentIds];
    const seed = JSON.stringify([
      normalizedProjectId,
      normalizedDocumentId,
      aggregateIdentity(aggregate),
      aggregate.sourceTypeHint,
      sourceFragmentIds,
    ]);
    const digest = sha256Hex(seed);
    try {
      return parseEvidenceCandidate({
        id: `document-candidate:${digest}`,
        projectId: normalizedProjectId,
        documentId: normalizedDocumentId,
        fieldId: aggregate.fieldId,
        normalizedValue: aggregate.normalizedValue,
        displayValue: aggregate.displayValue,
        periodIdentity: aggregate.periodIdentity,
        dimensionIdentity: aggregate.dimensionIdentity,
        sourceFragmentIds,
        recognitionMethod: 'rule',
        sourceTypeHint: aggregate.sourceTypeHint,
        confidence: aggregate.confidence,
        reviewStatus: 'pending',
        candidateFingerprint: `sha256:${digest}`,
        createdAt,
        updatedAt: createdAt,
      });
    } catch (error) {
      throw new RecognitionError('invalid-value', 'Recognized candidate failed validation.', error);
    }
  });
  candidates.sort((left, right) =>
    compareText(left.fieldId, right.fieldId)
    || compareText(left.periodIdentity, right.periodIdentity)
    || compareText(left.dimensionIdentity, right.dimensionIdentity)
    || compareText(left.id, right.id));
  return Object.freeze(candidates) as EvidenceCandidate[];
}
