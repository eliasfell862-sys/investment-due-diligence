# PDF/PPT Evidence Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a complete offline path from a text PDF or PPTX upload to locally extracted source fragments, reviewable evidence candidates, confirmed evidence, manual fallback, and PDF/PPT-aware project readiness without requiring Excel.

**Architecture:** Add immutable document-source fragments and reviewable evidence candidates beside the existing formal evidence table. PDF and PPTX extraction run behind one bounded Web Worker contract; deterministic recognition produces candidates, while only explicit confirmation or correction promotes a candidate into `EvidenceRepository`. Data Room becomes the entry point for parsing, review, and manual evidence; Dashboard consumes report-specific readiness rather than treating Excel as a gate.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Dexie 4, Zod 4, pdfjs-dist 5.6.205, JSZip 3.10.1, fast-xml-parser 5.10.1, Vitest, Testing Library.

---

## Scope decomposition

The approved design contains three independently risky subsystems. This plan implements the first deployable vertical slice:

- Included: text PDF extraction, PPTX visible text/table extraction, immutable source locators, deterministic candidates, candidate review, manual fallback, conflict-aware promotion, document parse status, and quick-look/formal readiness gates.
- Separate follow-up plan: local on-demand OCR with bundled Chinese and English language assets, per-page progress, cancellation, and no runtime CDN access.
- Separate follow-up plan: production DOCX generation for the quick-look and formal investment memorandum, including charts and golden-file rendering checks.

The vertical slice must remain usable after every task. OCR and DOCX work must build on the contracts defined here rather than change them.

## File structure

### New domain files

- `app/src/domain/documents/source-fragment.ts` — immutable extracted source fragment types and locator formatting.
- `app/src/domain/documents/source-fragment.schema.ts` — strict storage-boundary validation.
- `app/src/domain/documents/source-fragment.schema.test.ts` — schema and locator tests.
- `app/src/domain/evidence/evidence-candidate.ts` — candidate and review-state types.
- `app/src/domain/evidence/evidence-candidate.schema.ts` — candidate storage validation.
- `app/src/domain/evidence/evidence-candidate.schema.test.ts` — candidate validation tests.
- `app/src/domain/evidence/recognize-document-candidates.ts` — deterministic, conservative field recognition.
- `app/src/domain/evidence/recognize-document-candidates.test.ts` — labeled-value recognition and false-positive tests.
- `app/src/domain/evidence/create-manual-evidence.ts` — manual form input to formal evidence conversion.
- `app/src/domain/evidence/create-manual-evidence.test.ts` — source-type and validation tests.
- `app/src/domain/readiness/calculate-report-readiness.ts` — quick-look and formal report gates.
- `app/src/domain/readiness/calculate-report-readiness.test.ts` — PDF/PPT-only readiness tests.

### New infrastructure files

- `app/src/infrastructure/archive/zip-preflight.ts` — shared bounded ZIP central-directory validation.
- `app/src/infrastructure/archive/zip-preflight.test.ts` — ZIP-bomb and malformed archive tests.
- `app/src/infrastructure/db/document-evidence-repository.ts` — transactional storage for fragments/candidates and parse state.
- `app/src/infrastructure/db/document-evidence-repository.test.ts` — idempotency, project isolation, and status tests.
- `app/src/infrastructure/db/candidate-review-service.ts` — candidate confirmation/correction/rejection and formal evidence promotion.
- `app/src/infrastructure/db/candidate-review-service.test.ts` — audit and retry-safety tests.
- `app/src/infrastructure/import/document-extractor.ts` — shared extraction result and worker protocol.
- `app/src/infrastructure/import/pdf-extractor.ts` — pdf.js text extraction adapter.
- `app/src/infrastructure/import/pdf-extractor.test.ts` — page, text-budget, and password/error tests.
- `app/src/infrastructure/import/pptx-extractor.ts` — bounded PPTX OOXML text/table extraction.
- `app/src/infrastructure/import/pptx-extractor.test.ts` — slide, shape, table, notes, and archive-limit tests.
- `app/src/infrastructure/import/document-candidate.worker.ts` — worker entrypoint.
- `app/src/infrastructure/import/document-importer.ts` — strict worker orchestration and response rebuilding.
- `app/src/infrastructure/import/document-importer.test.ts` — timeout, malformed response, and transfer tests.
- `app/src/infrastructure/import/document-importer.worker.test.ts` — worker request/response boundary tests.

### New feature files

- `app/src/features/data-room/DocumentExtractionWorkspace.tsx` — parse/retry/status controller.
- `app/src/features/data-room/DocumentExtractionWorkspace.test.tsx` — extraction states and stale-request tests.
- `app/src/features/data-room/CandidateReviewWorkspace.tsx` — three-column candidate review surface.
- `app/src/features/data-room/CandidateReviewWorkspace.test.tsx` — confirm/correct/reject workflow tests.
- `app/src/features/data-room/ManualEvidenceForm.tsx` — always-available structured manual fallback.
- `app/src/features/data-room/ManualEvidenceForm.test.tsx` — validation and submission tests.
- `app/src/integration/pdf-ppt-only-flow.test.tsx` — end-to-end local vertical-slice test.

### Existing files to modify

- `app/package.json`, `app/package-lock.json` — add pinned parser dependencies.
- `app/src/infrastructure/db/app-db.ts` — Dexie v2 tables and expanded document parse status.
- `app/src/infrastructure/files/file-vault.ts` — initialize documents as `unparsed` and preserve local-first guarantees.
- `app/src/domain/evidence/evidence.ts` — add optional candidate/source provenance and review audit.
- `app/src/domain/evidence/evidence.schema.ts` — validate new provenance fields without breaking Excel evidence.
- `app/src/domain/evidence/target-fields.ts` — add text fields needed for PDF/PPT quick-look readiness.
- `app/src/infrastructure/import/excel-importer.ts` — consume shared ZIP preflight without changing Excel behavior.
- `app/src/features/data-room/DataRoomPage.tsx` — expose parse/manual actions by file type.
- `app/src/features/data-room/ProjectDataRoomRoute.tsx` — inject new repositories and review service.
- `app/src/features/dashboard/ProjectDashboardRoute.tsx` — calculate report-specific readiness.
- `app/src/features/dashboard/ProjectDashboardPage.tsx` — show quick-look/formal gates and pending candidates.
- `app/src/app/router.tsx` — construct and inject the new services.
- `app/src/index.css` — implement the accepted three-column review layout using existing design tokens.

---

### Task 1: Add source-fragment and candidate domain contracts

**Files:**
- Create: `app/src/domain/documents/source-fragment.ts`
- Create: `app/src/domain/documents/source-fragment.schema.ts`
- Create: `app/src/domain/documents/source-fragment.schema.test.ts`
- Create: `app/src/domain/evidence/evidence-candidate.ts`
- Create: `app/src/domain/evidence/evidence-candidate.schema.ts`
- Create: `app/src/domain/evidence/evidence-candidate.schema.test.ts`

- [ ] **Step 1: Write failing source-fragment schema tests**

```ts
import { describe, expect, it } from 'vitest';
import { formatSourceLocator } from './source-fragment';
import { parseSourceFragment } from './source-fragment.schema';

const validFragment = {
  id: 'fragment:1',
  projectId: 'project:1',
  documentId: 'document:1',
  documentVersionId: 'document:1',
  sourceKind: 'pdf_text',
  locator: { pageNumber: 12, tableIndex: 2, tableRow: 4, tableColumn: 3 },
  rawText: '2025 年营业收入 1.2 亿元',
  normalizedText: '2025 年营业收入 1.2 亿元',
  extractionMethod: 'pdfjs',
  extractionVersion: '1',
  contentHash: 'sha256:fragment-1',
  createdAt: '2026-07-23T08:00:00.000Z',
} as const;

describe('source fragment schema', () => {
  it('accepts a located PDF table cell', () => {
    expect(parseSourceFragment(validFragment)).toEqual(validFragment);
    expect(formatSourceLocator(validFragment)).toBe('第 12 页 / 表格 2 / 第 4 行第 3 列');
  });

  it('rejects a fragment without a page or slide locator', () => {
    expect(() => parseSourceFragment({ ...validFragment, locator: {} })).toThrow();
  });

  it('rejects text beyond the storage budget', () => {
    expect(() => parseSourceFragment({
      ...validFragment,
      rawText: 'x'.repeat(65_537),
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run the source-fragment test and verify it fails**

Run: `npm test -- src/domain/documents/source-fragment.schema.test.ts`

Expected: FAIL because the source-fragment modules do not exist.

- [ ] **Step 3: Implement the source-fragment contract and schema**

```ts
export type SourceFragmentKind =
  | 'pdf_text'
  | 'pdf_table'
  | 'ppt_text'
  | 'ppt_table'
  | 'ppt_notes'
  | 'embedded_chart_data'
  | 'ocr';

export interface SourceLocator {
  readonly pageNumber?: number;
  readonly slideNumber?: number;
  readonly objectId?: string;
  readonly objectName?: string;
  readonly tableIndex?: number;
  readonly tableRow?: number;
  readonly tableColumn?: number;
  readonly boundingBox?: readonly [number, number, number, number];
}

export interface SourceFragment {
  readonly id: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly sourceKind: SourceFragmentKind;
  readonly locator: SourceLocator;
  readonly rawText: string;
  readonly normalizedText: string;
  readonly extractionMethod: 'pdfjs' | 'pptx_ooxml' | 'tesseract';
  readonly extractionVersion: string;
  readonly contentHash: string;
  readonly createdAt: string;
}

export function formatSourceLocator(fragment: SourceFragment): string {
  const parts = fragment.locator.pageNumber
    ? [`第 ${fragment.locator.pageNumber} 页`]
    : [`第 ${fragment.locator.slideNumber} 页`];
  if (fragment.locator.objectName) parts.push(fragment.locator.objectName);
  if (fragment.locator.tableIndex) parts.push(`表格 ${fragment.locator.tableIndex}`);
  if (fragment.locator.tableRow && fragment.locator.tableColumn) {
    parts.push(`第 ${fragment.locator.tableRow} 行第 ${fragment.locator.tableColumn} 列`);
  }
  return parts.join(' / ');
}
```

Implement `source-fragment.schema.ts` with Zod, requiring exactly one of `pageNumber` or `slideNumber`, positive integer locator indices, finite non-negative bounding-box values, `rawText` and `normalizedText` lengths of 1–65,536 characters, a non-empty content hash, and an ISO datetime.

- [ ] **Step 4: Write failing candidate schema tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseEvidenceCandidate } from './evidence-candidate.schema';

const candidate = {
  id: 'candidate:1',
  projectId: 'project:1',
  documentId: 'document:1',
  fieldId: 'revenue',
  normalizedValue: '120000000',
  displayValue: '1.2 亿元',
  periodIdentity: '2025-12-31',
  dimensionIdentity: 'project:project%3A1:default',
  sourceFragmentIds: ['fragment:1'],
  recognitionMethod: 'rule',
  confidence: 0.82,
  reviewStatus: 'pending',
  candidateFingerprint: 'sha256:candidate-1',
  createdAt: '2026-07-23T08:00:00.000Z',
  updatedAt: '2026-07-23T08:00:00.000Z',
} as const;

describe('evidence candidate schema', () => {
  it('accepts a pending candidate', () => {
    expect(parseEvidenceCandidate(candidate)).toEqual(candidate);
  });

  it('requires a reason for corrected candidates', () => {
    expect(() => parseEvidenceCandidate({
      ...candidate,
      reviewStatus: 'corrected',
      correctedValue: '110000000',
    })).toThrow();
  });

  it('rejects unknown target fields', () => {
    expect(() => parseEvidenceCandidate({ ...candidate, fieldId: 'invented_metric' })).toThrow();
  });
});
```

- [ ] **Step 5: Run the candidate test and verify it fails**

Run: `npm test -- src/domain/evidence/evidence-candidate.schema.test.ts`

Expected: FAIL because the candidate modules do not exist.

- [ ] **Step 6: Implement candidate types and schema**

```ts
export type CandidateReviewStatus =
  | 'pending'
  | 'confirmed'
  | 'corrected'
  | 'rejected'
  | 'conflicted';

export interface EvidenceCandidate {
  readonly id: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly fieldId: string;
  readonly normalizedValue: string;
  readonly displayValue?: string;
  readonly periodIdentity: string;
  readonly dimensionIdentity: string;
  readonly sourceFragmentIds: readonly string[];
  readonly recognitionMethod: 'rule' | 'ocr_rule' | 'ai_assisted';
  readonly confidence: number;
  readonly reviewStatus: CandidateReviewStatus;
  readonly correctedValue?: string;
  readonly reviewReason?: string;
  readonly reviewedAt?: string;
  readonly candidateFingerprint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

Implement the schema with these invariants: one or more unique source fragment ids; confidence from 0 to 1; `correctedValue`, `reviewReason`, and `reviewedAt` required for `corrected`; `reviewReason` and `reviewedAt` required for `rejected`; reviewed fields absent for `pending`; target-field values validated through `validateNormalizedTargetValue`.

- [ ] **Step 7: Run the domain tests**

Run: `npm test -- src/domain/documents/source-fragment.schema.test.ts src/domain/evidence/evidence-candidate.schema.test.ts`

Expected: PASS.

- [ ] **Step 8: Run validation**

Run: `npm run typecheck && npm run lint`

Expected: both commands PASS.

- [ ] **Step 9: Commit**

```bash
git add app/src/domain/documents app/src/domain/evidence/evidence-candidate.ts app/src/domain/evidence/evidence-candidate.schema.ts app/src/domain/evidence/evidence-candidate.schema.test.ts
git commit -m "feat: add document evidence domain contracts"
```

---

### Task 2: Add Dexie v2 storage and document-evidence repositories

**Files:**
- Modify: `app/src/infrastructure/db/app-db.ts`
- Modify: `app/src/infrastructure/files/file-vault.ts`
- Modify: `app/src/infrastructure/files/file-vault.test.ts`
- Create: `app/src/infrastructure/db/document-evidence-repository.ts`
- Create: `app/src/infrastructure/db/document-evidence-repository.test.ts`

- [ ] **Step 1: Write a failing migration and repository test**

```ts
it('stores one deterministic extraction without duplicating candidates', async () => {
  const db = new AppDb(`document-evidence-${crypto.randomUUID()}`);
  const repository = new DocumentEvidenceRepository(db);
  await db.documents.add({
    id: 'd1', projectId: 'p1', name: 'bp.pdf', mimeType: 'application/pdf',
    size: 10, uploadedAt: '2026-07-23T08:00:00.000Z', parseStatus: 'unparsed',
    blob: new Blob(['pdf']),
  });

  await repository.saveExtraction('p1', 'd1', [fragment], [candidate]);
  await repository.saveExtraction('p1', 'd1', [fragment], [candidate]);

  expect(await repository.listFragments('p1', 'd1')).toHaveLength(1);
  expect(await repository.listCandidates('p1', 'd1')).toHaveLength(1);
  expect((await db.documents.get('d1'))?.parseStatus).toBe('review');
  await db.delete();
});
```

Also test that a project id mismatch throws, a failed extraction sets `parseStatus: 'failed'` without deleting previous fragments, and a zero-candidate extraction sets `parseStatus: 'partial'` so manual entry remains available.

- [ ] **Step 2: Run the repository test and verify it fails**

Run: `npm test -- src/infrastructure/db/document-evidence-repository.test.ts`

Expected: FAIL because the table and repository do not exist.

- [ ] **Step 3: Add v2 tables and parse states**

Update `StoredDocument`:

```ts
export type DocumentParseStatus =
  | 'unparsed'
  | 'parsing'
  | 'review'
  | 'partial'
  | 'complete'
  | 'failed'
  | 'unsupported';

export interface StoredDocument {
  id: string;
  projectId: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  parseStatus: DocumentParseStatus;
  parseErrorCode?: string;
  blob: Blob;
}
```

Add tables and the v2 migration:

```ts
sourceFragments!: EntityTable<SourceFragment, 'id'>;
evidenceCandidates!: EntityTable<EvidenceCandidate, 'id'>;

this.version(2).stores({
  projects: 'id, updatedAt, status, name',
  evidence: 'id, projectId, fieldId, conflictStatus, updatedAt',
  documents: 'id, projectId, uploadedAt, mimeType, parseStatus',
  sourceFragments: 'id, projectId, documentId, [projectId+documentId], contentHash, createdAt',
  evidenceCandidates: 'id, projectId, documentId, fieldId, reviewStatus, [projectId+documentId], &candidateFingerprint, updatedAt',
}).upgrade(async (transaction) => {
  await transaction.table<StoredDocument>('documents').toCollection().modify((document) => {
    if ((document.parseStatus as string) === 'stored') document.parseStatus = 'unparsed';
  });
});
```

Change new uploads in `FileVault.storeMany` from `parseStatus: 'stored'` to `parseStatus: 'unparsed'`. Update all file-vault and Data Room fixtures accordingly.

- [ ] **Step 4: Implement `DocumentEvidenceRepository`**

Expose these exact methods:

```ts
class DocumentEvidenceRepository {
  constructor(private readonly db: AppDb) {}
  markParsing(projectId: string, documentId: string): Promise<void>;
  saveExtraction(
    projectId: string,
    documentId: string,
    fragments: readonly SourceFragment[],
    candidates: readonly EvidenceCandidate[],
  ): Promise<void>;
  markFailed(projectId: string, documentId: string, errorCode: string): Promise<void>;
  listFragments(projectId: string, documentId: string): Promise<SourceFragment[]>;
  listCandidates(projectId: string, documentId?: string): Promise<EvidenceCandidate[]>;
  setCandidate(candidate: EvidenceCandidate): Promise<void>;
  refreshDocumentStatus(projectId: string, documentId: string): Promise<void>;
}
```

`saveExtraction` must parse every incoming record before opening one `rw` transaction over `documents`, `sourceFragments`, and `evidenceCandidates`; verify the stored document belongs to the project; `bulkPut` deterministic fragments and candidates; preserve reviewed candidates by not overwriting records whose status is not `pending`; clear `parseErrorCode`; set `review` when candidates exist and `partial` when none exist. Sort list results by page/slide, locator, field, and id.

- [ ] **Step 5: Run repository and regression tests**

Run: `npm test -- src/infrastructure/db/document-evidence-repository.test.ts src/infrastructure/files/file-vault.test.ts src/features/data-room/DataRoomPage.test.tsx`

Expected: PASS.

- [ ] **Step 6: Run validation**

Run: `npm run typecheck && npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/infrastructure/db/app-db.ts app/src/infrastructure/db/document-evidence-repository.ts app/src/infrastructure/db/document-evidence-repository.test.ts app/src/infrastructure/files/file-vault.ts app/src/infrastructure/files/file-vault.test.ts app/src/features/data-room/DataRoomPage.test.tsx
git commit -m "feat: persist document fragments and candidates"
```

---

### Task 3: Extend formal evidence provenance and add candidate review service

**Files:**
- Modify: `app/src/domain/evidence/evidence.ts`
- Modify: `app/src/domain/evidence/evidence.schema.ts`
- Modify: `app/src/infrastructure/db/evidence-repository.test.ts`
- Create: `app/src/infrastructure/db/candidate-review-service.ts`
- Create: `app/src/infrastructure/db/candidate-review-service.test.ts`

- [ ] **Step 1: Write failing provenance and review-service tests**

```ts
it('corrects a candidate without losing the extracted value', async () => {
  await documentRepository.saveExtraction('p1', 'd1', [fragment], [candidate]);
  await service.correct('p1', 'candidate:1', {
    normalizedValue: '110000000',
    reason: '按审计报表含税口径修正',
  });

  const [saved] = await evidenceRepository.listByProject('p1');
  expect(saved).toMatchObject({
    id: 'candidate-evidence:candidate%3A1',
    normalizedValue: '110000000',
    rawValue: '1.2 亿元',
    candidateId: 'candidate:1',
    sourceType: 'document_fact',
    reviewAudit: {
      originalCandidateValue: '120000000',
      reviewedValue: '110000000',
      reason: '按审计报表含税口径修正',
    },
  });
});
```

Also test: confirmation is retry-safe and produces one evidence item; rejection creates no evidence; a project mismatch is rejected; confirming a rejected candidate is rejected; source locator contains the PDF page or PPT slide; an existing conflicting evidence item is marked unresolved by `EvidenceRepository`.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- src/infrastructure/db/candidate-review-service.test.ts src/infrastructure/db/evidence-repository.test.ts`

Expected: FAIL because provenance fields and the service do not exist.

- [ ] **Step 3: Extend `EvidenceItem` without breaking Excel imports**

```ts
export type EvidenceSourceType =
  | 'document_fact'
  | 'management_forecast'
  | 'investor_assumption'
  | 'interview';

export interface EvidenceReviewAudit {
  readonly originalCandidateValue: string;
  readonly reviewedValue: string;
  readonly reason?: string;
  readonly reviewedAt: string;
}

// Add to EvidenceItem:
readonly sourceFragmentIds?: readonly string[];
readonly sourceType?: EvidenceSourceType;
readonly candidateId?: string;
readonly reviewAudit?: EvidenceReviewAudit;
```

Update `parseEvidenceItem` so older Excel evidence remains valid with optional provenance, while any supplied source fragment list must contain unique non-empty ids and review audit timestamps must be ISO datetimes.

- [ ] **Step 4: Implement retry-safe review promotion**

Expose:

```ts
class CandidateReviewService {
  constructor(
    private readonly documentRepository: DocumentEvidenceRepository,
    private readonly evidenceRepository: EvidenceRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}
  confirm(projectId: string, candidateId: string): Promise<void>;
  correct(
    projectId: string,
    candidateId: string,
    input: { readonly normalizedValue: string; readonly reason: string },
  ): Promise<void>;
  reject(projectId: string, candidateId: string, reason: string): Promise<void>;
}
```

Build formal evidence with deterministic id `candidate-evidence:${encodeURIComponent(candidate.id)}`, `importBatchId: document-candidate:${documentId}`, `sourceSheet: 'PDF'` or `'PPTX'`, `sourceRow` equal to page/slide number, and `sourceLocator` from `formatSourceLocator`. Call `EvidenceRepository.saveMany` before changing candidate status; because the evidence id is deterministic, a retry after a candidate-status write failure remains idempotent. Validate corrected values with the target-field definition before writing.

- [ ] **Step 5: Run the focused tests**

Run: `npm test -- src/infrastructure/db/candidate-review-service.test.ts src/infrastructure/db/evidence-repository.test.ts`

Expected: PASS.

- [ ] **Step 6: Run validation**

Run: `npm run typecheck && npm run lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/domain/evidence/evidence.ts app/src/domain/evidence/evidence.schema.ts app/src/infrastructure/db/evidence-repository.test.ts app/src/infrastructure/db/candidate-review-service.ts app/src/infrastructure/db/candidate-review-service.test.ts
git commit -m "feat: review and promote document candidates"
```

---

### Task 4: Add manual evidence fallback and quick-look text fields

**Files:**
- Modify: `app/src/domain/evidence/target-fields.ts`
- Modify: `app/src/domain/evidence/target-fields.test.ts`
- Create: `app/src/domain/evidence/create-manual-evidence.ts`
- Create: `app/src/domain/evidence/create-manual-evidence.test.ts`

- [ ] **Step 1: Write failing target-field and manual-evidence tests**

```ts
it.each([
  ['team_summary', '团队概览'],
  ['product_summary', '产品概览'],
  ['market_summary', '市场概览'],
])('registers %s as a text field', (id, label) => {
  expect(findTargetFieldDefinition(id)).toMatchObject({
    label, valueKind: 'text', unit: 'text', direction: 'neutral', importable: false,
  });
});

it('creates an investor assumption without pretending it is a document fact', () => {
  const item = createManualEvidence({
    projectId: 'p1', fieldId: 'market_summary', value: '未来三年行业增速预计 20%',
    sourceType: 'investor_assumption', sourceNote: '基于专家访谈与投资人判断',
  }, { createId: () => 'manual:1', now: () => new Date('2026-07-23T08:00:00Z') });
  expect(item).toMatchObject({
    sourceType: 'investor_assumption', sourceSheet: '人工录入', confidence: 0.5,
  });
});
```

Also test that `document_fact` requires `sourceDocumentId` and a source locator, `interview` requires a note, unknown fields fail, and numeric values use the existing canonical validators.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- src/domain/evidence/target-fields.test.ts src/domain/evidence/create-manual-evidence.test.ts`

Expected: FAIL because fields and factory do not exist.

- [ ] **Step 3: Register the three text fields**

Add definitions with ids `team_summary`, `product_summary`, and `market_summary`; set `importable: false`, `identityKind: 'measure'`, `valueKind: 'text'`, `unit: 'text'`, `locale: 'en-US'`, and `direction: 'neutral'`.

- [ ] **Step 4: Implement `createManualEvidence`**

```ts
export interface ManualEvidenceInput {
  readonly projectId: string;
  readonly fieldId: string;
  readonly value: string;
  readonly sourceType: EvidenceSourceType;
  readonly sourceDocumentId?: string;
  readonly sourceLocator?: string;
  readonly sourceNote?: string;
  readonly periodIdentity?: string;
  readonly dimensionIdentity?: string;
}
```

Use `validateNormalizedTargetValue`, default `periodIdentity` to `manual:undated`, default `dimensionIdentity` to `project:${encodeURIComponent(projectId)}:default`, set confidence to `0.8` for located document facts, `0.7` for interviews, and `0.5` for investor assumptions. Store the note in `rawValue` when no document text exists. Management forecasts must use a non-empty period identity.

- [ ] **Step 5: Run focused tests and validation**

Run: `npm test -- src/domain/evidence/target-fields.test.ts src/domain/evidence/create-manual-evidence.test.ts && npm run typecheck && npm run lint`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/domain/evidence/target-fields.ts app/src/domain/evidence/target-fields.test.ts app/src/domain/evidence/create-manual-evidence.ts app/src/domain/evidence/create-manual-evidence.test.ts
git commit -m "feat: add structured manual evidence fallback"
```

---

### Task 5: Extract and reuse bounded ZIP preflight

**Files:**
- Create: `app/src/infrastructure/archive/zip-preflight.ts`
- Create: `app/src/infrastructure/archive/zip-preflight.test.ts`
- Modify: `app/src/infrastructure/import/excel-importer.ts`
- Modify: `app/src/infrastructure/import/excel-importer.test.ts`

- [ ] **Step 1: Write failing shared ZIP tests**

Move the existing Excel malformed ZIP, entry count, per-entry expanded size, total expanded size, and compression-ratio cases into a generic test against:

```ts
const result = preflightZipArchive(bytes, {
  maxEntries: 2_000,
  maxEntryUncompressedBytes: 100 * 1024 * 1024,
  maxTotalUncompressedBytes: 200 * 1024 * 1024,
  maxCompressionRatio: 100,
});
expect(result.entries).toContainEqual(expect.objectContaining({ name: 'xl/workbook.xml' }));
```

Expected error codes: `malformed-zip`, `zip-entry-limit`, `zip-entry-too-large`, `zip-expanded-size-limit`, and `zip-compression-ratio`.

- [ ] **Step 2: Run the shared ZIP test and verify it fails**

Run: `npm test -- src/infrastructure/archive/zip-preflight.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement shared ZIP preflight**

Extract the central-directory reader from `excel-importer.ts` into a dependency-free module. Export:

```ts
export interface ZipEntryMetadata {
  readonly name: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
}

export function preflightZipArchive(
  data: ArrayBuffer | Uint8Array,
  limits: ZipPreflightLimits,
): { readonly entries: readonly ZipEntryMetadata[]; readonly totalUncompressedBytes: number };
```

Reject encrypted entries, ZIP64 markers, unsafe paths containing `..` or a leading slash, duplicate normalized entry names, unsupported multi-disk archives, data outside archive bounds, and compression ratios above the supplied limit. Preserve the existing Excel error codes by translating `ZipPreflightError` in `excel-importer.ts`.

- [ ] **Step 4: Run Excel and shared ZIP regression tests**

Run: `npm test -- src/infrastructure/archive/zip-preflight.test.ts src/infrastructure/import/excel-importer.test.ts src/infrastructure/import/excel-importer.worker.test.ts`

Expected: PASS with no change to Excel import behavior.

- [ ] **Step 5: Run validation and commit**

Run: `npm run typecheck && npm run lint`

```bash
git add app/src/infrastructure/archive app/src/infrastructure/import/excel-importer.ts app/src/infrastructure/import/excel-importer.test.ts
git commit -m "refactor: share bounded zip preflight"
```

---

### Task 6: Add deterministic candidate recognition

**Files:**
- Create: `app/src/domain/evidence/recognize-document-candidates.ts`
- Create: `app/src/domain/evidence/recognize-document-candidates.test.ts`

- [ ] **Step 1: Write failing recognition tests**

```ts
it('recognizes explicitly labeled financial values and keeps source ids', () => {
  const candidates = recognizeDocumentCandidates('p1', 'd1', [
    fragment('公司名称：星云科技', 'fragment:company'),
    fragment('2025 年营业收入：1.2 亿元', 'fragment:revenue'),
    fragment('毛利率：48%', 'fragment:margin'),
  ], fixedOptions);

  expect(candidates.map(({ fieldId, normalizedValue, sourceFragmentIds }) => ({
    fieldId, normalizedValue, sourceFragmentIds,
  }))).toEqual([
    { fieldId: 'company_name', normalizedValue: '星云科技', sourceFragmentIds: ['fragment:company'] },
    { fieldId: 'gross_margin', normalizedValue: '0.48', sourceFragmentIds: ['fragment:margin'] },
    { fieldId: 'revenue', normalizedValue: '120000000', sourceFragmentIds: ['fragment:revenue'] },
  ]);
});

it.each([
  '我们的目标是收入快速增长',
  '市场毛利通常较高',
  '预计未来规模可观',
])('does not invent a candidate from unlabeled prose: %s', (text) => {
  expect(recognizeDocumentCandidates('p1', 'd1', [fragment(text)], fixedOptions)).toEqual([]);
});
```

Also test Chinese/English labels, full-width punctuation, management-forecast phrases, deterministic fingerprints, duplicate fragment collapse, and invalid numeric text rejection.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- src/domain/evidence/recognize-document-candidates.test.ts`

Expected: FAIL because the recognizer does not exist.

- [ ] **Step 3: Implement conservative rules**

Use an explicit ordered rule registry:

```ts
const rules = [
  textRule('company_name', /^(?:公司名称|项目名称|company(?: name)?)\s*[：:]\s*(.+)$/iu, 0.9),
  textRule('business_description', /^(?:业务简介|公司简介|business description)\s*[：:]\s*(.+)$/iu, 0.82),
  textRule('team_summary', /^(?:核心团队|团队概览|team)\s*[：:]\s*(.+)$/iu, 0.78),
  textRule('product_summary', /^(?:核心产品|产品概览|product)\s*[：:]\s*(.+)$/iu, 0.78),
  textRule('market_summary', /^(?:目标市场|市场概览|market)\s*[：:]\s*(.+)$/iu, 0.75),
  numberRule('revenue', /^(?:(\d{4})\s*年)?(?:营业收入|营收|revenue)\s*[：:]\s*(.+)$/iu, 'currency', 0.82),
  numberRule('gross_margin', /^(?:(\d{4})\s*年)?(?:毛利率|gross margin)\s*[：:]\s*(.+)$/iu, 'percent', 0.82),
  numberRule('arr', /^(?:(\d{4})\s*年)?(?:ARR|年度经常性收入)\s*[：:]\s*(.+)$/iu, 'currency', 0.82),
] as const;
```

Split fragments into trimmed lines and apply only full-line labeled rules. Convert Chinese currency suffixes `万` and `亿` before calling `canonicalizeEnUsNumber`; convert percentages to canonical decimals; convert a captured year to `YYYY-12-31`; otherwise use `source-document:${documentId}:undated`. Mark lines containing `预计`, `预测`, `目标`, `forecast`, or `projection` for `management_forecast` during promotion. Produce ids and fingerprints from a stable hash of project, document, field, period, dimension, normalized value, and sorted source fragment ids.

- [ ] **Step 4: Run tests and validation**

Run: `npm test -- src/domain/evidence/recognize-document-candidates.test.ts && npm run typecheck && npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/domain/evidence/recognize-document-candidates.ts app/src/domain/evidence/recognize-document-candidates.test.ts
git commit -m "feat: recognize conservative document candidates"
```

---

### Task 7: Add bounded PDF text extraction

**Files:**
- Modify: `app/package.json`
- Modify: `app/package-lock.json`
- Create: `app/src/infrastructure/import/document-extractor.ts`
- Create: `app/src/infrastructure/import/pdf-extractor.ts`
- Create: `app/src/infrastructure/import/pdf-extractor.test.ts`

- [ ] **Step 1: Install the Node-compatible pdf.js version**

Run: `npm install pdfjs-dist@5.6.205`

Expected: package-lock records `pdfjs-dist` 5.6.205, whose Node requirement matches the project engine floor `>=20.19.0`.

- [ ] **Step 2: Write failing adapter-driven PDF tests**

```ts
it('extracts one ordered fragment per non-empty page text block', async () => {
  const fragments = await extractPdfFragments(request, {
    load: async () => fakePdf([
      [{ str: '公司名称：星云科技', transform: [1, 0, 0, 1, 10, 20] }],
      [{ str: '2025 年营业收入：1.2 亿元', transform: [1, 0, 0, 1, 10, 40] }],
    ]),
    now: () => new Date('2026-07-23T08:00:00Z'),
  });
  expect(fragments.map((item) => [item.locator.pageNumber, item.rawText])).toEqual([
    [1, '公司名称：星云科技'],
    [2, '2025 年营业收入：1.2 亿元'],
  ]);
});
```

Also test 500-page enforcement, 4 MiB aggregate text budget, 65,536 characters per fragment, empty scanned pages returning `needsOcrPageNumbers`, password errors mapped to `password-protected`, and cancellation checks between pages.

- [ ] **Step 3: Run the test and verify it fails**

Run: `npm test -- src/infrastructure/import/pdf-extractor.test.ts`

Expected: FAIL because extractor files do not exist.

- [ ] **Step 4: Define shared extraction contracts**

```ts
export interface DocumentExtractionRequest {
  readonly projectId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly fileName: string;
  readonly kind: 'pdf' | 'pptx';
  readonly data: Uint8Array;
}

export interface DocumentExtractionResult {
  readonly fragments: readonly SourceFragment[];
  readonly needsOcrPageNumbers: readonly number[];
  readonly warnings: readonly string[];
}
```

Define `DocumentExtractorErrorCode` for `empty-input`, `input-too-large`, `password-protected`, `malformed-document`, `page-limit`, `slide-limit`, `text-limit`, `archive-limit`, `unsupported-format`, `cancelled`, `worker-timeout`, and `worker-failed`.

- [ ] **Step 5: Implement pdf.js extraction**

Import `getDocument` and `GlobalWorkerOptions` from `pdfjs-dist/legacy/build/pdf.mjs`, and set `GlobalWorkerOptions.workerSrc` from `pdfjs-dist/legacy/build/pdf.worker.min.mjs?url`. Call `getDocument({ data, isEvalSupported: false, useWorkerFetch: false })`; reject documents over 500 pages before iterating; join adjacent text items by line while preserving page order; normalize whitespace without changing numeric punctuation; create deterministic fragment ids and content hashes; call `loadingTask.destroy()` in `finally`.

- [ ] **Step 6: Run PDF tests, typecheck, lint, and audit**

Run: `npm test -- src/infrastructure/import/pdf-extractor.test.ts && npm run typecheck && npm run lint && npm audit --offline --audit-level=high`

Expected: PASS and 0 high/critical vulnerabilities.

- [ ] **Step 7: Commit**

```bash
git add app/package.json app/package-lock.json app/src/infrastructure/import/document-extractor.ts app/src/infrastructure/import/pdf-extractor.ts app/src/infrastructure/import/pdf-extractor.test.ts
git commit -m "feat: extract bounded PDF text locally"
```

---

### Task 8: Add bounded PPTX visible text, table, and notes extraction

**Files:**
- Modify: `app/package.json`
- Modify: `app/package-lock.json`
- Create: `app/src/infrastructure/import/pptx-extractor.ts`
- Create: `app/src/infrastructure/import/pptx-extractor.test.ts`
- Create: `app/src/test/fixtures/minimal-due-diligence.pptx`

- [ ] **Step 1: Install maintained low-level OOXML dependencies**

Run: `npm install jszip@3.10.1 fast-xml-parser@5.10.1`

Expected: both packages are pinned in package-lock. Do not add `pptx-parser` because its published dependency stack is stale and browser-heavy; do not add `pptx2json` because the bounded source-locator behavior still requires a project-specific wrapper.

- [ ] **Step 2: Add a minimal synthetic PPTX fixture**

Create a two-slide fixture containing:

- Slide 1 title shape: `公司名称：星云科技`
- Slide 1 table cell: `2025 年营业收入：1.2 亿元`
- Slide 2 text shape: `核心团队：创始人拥有十年行业经验`
- Slide 2 speaker note: `管理层预测，2026 年 ARR 为 2 亿元`

The fixture must contain no confidential or third-party content and remain below 50 KiB.

- [ ] **Step 3: Write failing PPTX tests**

```ts
it('extracts slide shapes, table cells, and notes with stable locators', async () => {
  const result = await extractPptxFragments(requestFromFixture());
  expect(result.fragments.map((item) => ({
    kind: item.sourceKind,
    slide: item.locator.slideNumber,
    object: item.locator.objectName,
    text: item.rawText,
  }))).toEqual([
    { kind: 'ppt_text', slide: 1, object: 'Title 1', text: '公司名称：星云科技' },
    { kind: 'ppt_table', slide: 1, object: 'Table 1', text: '2025 年营业收入：1.2 亿元' },
    { kind: 'ppt_text', slide: 2, object: 'TextBox 2', text: '核心团队：创始人拥有十年行业经验' },
    { kind: 'ppt_notes', slide: 2, object: 'Speaker notes', text: '管理层预测，2026 年 ARR 为 2 亿元' },
  ]);
});
```

Also test 500-slide enforcement, shared ZIP limits before decompression, missing presentation relationships, duplicate slide targets, path traversal entries, aggregate text budget, and no numeric inference from image-only chart shapes.

- [ ] **Step 4: Run the test and verify it fails**

Run: `npm test -- src/infrastructure/import/pptx-extractor.test.ts`

Expected: FAIL because the extractor does not exist.

- [ ] **Step 5: Implement OOXML extraction**

Call `preflightZipArchive` before `JSZip.loadAsync`. Parse `[Content_Types].xml`, `ppt/presentation.xml`, and `ppt/_rels/presentation.xml.rels` with `XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true })`. Resolve slide targets only inside `ppt/`; reject duplicate or escaping targets. For each slide in presentation order:

- read shape names and ids from `cNvPr`;
- concatenate ordered `a:t` runs within each shape;
- emit one `ppt_table` fragment per non-empty table cell with 1-based row/column;
- resolve the slide relationship file and its notes-slide target, then emit `ppt_notes` fragments excluding placeholder headers/footers;
- ignore binary media and chart geometry in this phase;
- bound total extracted text to 4 MiB and individual fragments to 65,536 characters.

- [ ] **Step 6: Run PPTX tests, typecheck, lint, and audit**

Run: `npm test -- src/infrastructure/import/pptx-extractor.test.ts && npm run typecheck && npm run lint && npm audit --offline --audit-level=high`

Expected: PASS and 0 high/critical vulnerabilities.

- [ ] **Step 7: Commit**

```bash
git add app/package.json app/package-lock.json app/src/infrastructure/import/pptx-extractor.ts app/src/infrastructure/import/pptx-extractor.test.ts app/src/test/fixtures/minimal-due-diligence.pptx
git commit -m "feat: extract bounded PPTX evidence sources"
```

---

### Task 9: Add one strict document extraction worker

**Files:**
- Create: `app/src/infrastructure/import/document-candidate.worker.ts`
- Create: `app/src/infrastructure/import/document-importer.ts`
- Create: `app/src/infrastructure/import/document-importer.test.ts`
- Create: `app/src/infrastructure/import/document-importer.worker.test.ts`

- [ ] **Step 1: Write failing orchestration tests**

```ts
it('transfers a copied buffer, rebuilds validated fragments, and terminates', async () => {
  const worker = fakeWorker({ ok: true, result });
  const output = await inspectDocumentInWorker(request, {
    workerFactory: () => worker,
    timeoutMs: 5_000,
  });
  expect(output).toEqual(result);
  expect(worker.transferred).toHaveLength(1);
  expect(worker.terminate).toHaveBeenCalledOnce();
});
```

Also test timeout, `onerror`, malformed fragment ids, cross-project worker responses, too many fragments, oversized returned text, duplicate fragment ids, invalid candidate values, synchronous `postMessage` failure, and late worker responses after timeout.

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- src/infrastructure/import/document-importer.test.ts src/infrastructure/import/document-importer.worker.test.ts`

Expected: FAIL because the worker modules do not exist.

- [ ] **Step 3: Implement the worker**

```ts
workerScope.onmessage = async (event) => {
  try {
    const extracted = event.data.request.kind === 'pdf'
      ? await extractPdfFragments(event.data.request)
      : await extractPptxFragments(event.data.request);
    const candidates = recognizeDocumentCandidates(
      event.data.request.projectId,
      event.data.request.documentId,
      extracted.fragments,
    );
    workerScope.postMessage({ ok: true, result: { ...extracted, candidates } });
  } catch (error) {
    workerScope.postMessage({ ok: false, error: serializeDocumentExtractorError(error) });
  }
};
```

- [ ] **Step 4: Implement strict main-thread orchestration**

Use the Excel importer pattern: preflight non-empty input and 100 MiB maximum; copy into a transferable buffer; create a module worker from `document-candidate.worker?worker&url`; default timeout 15 seconds; always terminate exactly once. Rebuild every fragment and candidate through their Zod parsers. Limit worker output to 10,000 fragments, 10,000 candidates, 4 MiB aggregate text, and matching request project/document ids.

- [ ] **Step 5: Run worker tests and validation**

Run: `npm test -- src/infrastructure/import/document-importer.test.ts src/infrastructure/import/document-importer.worker.test.ts && npm run typecheck && npm run lint`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/infrastructure/import/document-candidate.worker.ts app/src/infrastructure/import/document-importer.ts app/src/infrastructure/import/document-importer.test.ts app/src/infrastructure/import/document-importer.worker.test.ts
git commit -m "feat: orchestrate document extraction worker"
```

---

### Task 10: Build Data Room extraction, review, and manual-entry UI

**Files:**
- Create: `app/src/features/data-room/DocumentExtractionWorkspace.tsx`
- Create: `app/src/features/data-room/DocumentExtractionWorkspace.test.tsx`
- Create: `app/src/features/data-room/CandidateReviewWorkspace.tsx`
- Create: `app/src/features/data-room/CandidateReviewWorkspace.test.tsx`
- Create: `app/src/features/data-room/ManualEvidenceForm.tsx`
- Create: `app/src/features/data-room/ManualEvidenceForm.test.tsx`
- Modify: `app/src/features/data-room/DataRoomPage.tsx`
- Modify: `app/src/features/data-room/DataRoomPage.test.tsx`
- Modify: `app/src/features/data-room/ProjectDataRoomRoute.tsx`
- Modify: `app/src/app/router.tsx`
- Modify: `app/src/index.css`

- [ ] **Step 1: Produce and approve the complete review-workspace visual concept**

Use the installed Image Gen workflow to create the full desktop Data Room state: file list, page/slide source list, central extracted-text preview, candidate inspector, manual-entry drawer, loading, empty, error, and narrow-screen stacking behavior. Preserve the current restrained investment-terminal visual language, typography, and navigation. Do not implement UI code until the concept is approved.

- [ ] **Step 2: Write failing extraction-workspace tests**

Test these exact behaviors:

- PDF and PPTX rows show `解析资料`; `.ppt` shows `请另存为 PPTX` and `手动录入`; Excel retains its existing action.
- clicking parse marks the document `parsing`, reads the Blob, calls the injected inspector, persists fragments/candidates, and shows `待审核`;
- a zero-candidate result shows `未识别到结构化字段，可手动录入` and keeps fragments;
- retry after failure calls only the selected document again;
- switching project/document ignores a late prior result;
- parse and manual actions remain offline (`fetch` is not called).

- [ ] **Step 3: Implement `DocumentExtractionWorkspace`**

Use a state union:

```ts
type ExtractionState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly requestId: number }
  | { readonly status: 'ready'; readonly requestId: number }
  | { readonly status: 'error'; readonly requestId: number; readonly message: string };
```

Call `documentRepository.markParsing`, then `document.blob.arrayBuffer()`, `inspectDocumentInWorker`, and `documentRepository.saveExtraction`. On failure call `markFailed` with the serialized error code. Guard every state update by project id, document id, repository identity, and monotonically increasing request id.

- [ ] **Step 4: Write failing review and manual-form tests**

Test candidate selection, source locator display, fragment text highlight, confidence and machine-generated labels, confirmation, correction with mandatory reason, rejection with mandatory reason, deterministic retry behavior, and formal evidence appearance after confirmation. Test manual document facts, interviews, investor assumptions, management forecasts, numeric validation, and source requirements.

- [ ] **Step 5: Implement `CandidateReviewWorkspace` and `ManualEvidenceForm`**

The review workspace must render three semantic regions:

```tsx
<nav aria-label="文件页码与幻灯片">...</nav>
<section aria-label="来源原文预览">...</section>
<aside aria-label="候选证据审核">...</aside>
```

Only one candidate may be edited at a time. Disable action buttons while a review request is pending. After success, keep the user on the same page/slide and advance to the next pending candidate. The manual form must always be reachable from the document row and from the empty-candidate state; submit through `createManualEvidence` and `EvidenceRepository.saveMany`.

- [ ] **Step 6: Wire services in route and router**

Construct one `DocumentEvidenceRepository` and one `CandidateReviewService` beside existing repositories in `router.tsx`. Extend `ProjectDataRoomRoute` props with these services. `DataRoomPage` receives a `documentInspector` dependency for tests and production defaults to `inspectDocumentInWorker`.

- [ ] **Step 7: Implement accepted responsive styling**

Use CSS grid for the approved desktop layout and stack regions below 900 px. Reuse existing color, spacing, focus, button, form, and status-badge tokens. Keep visible focus outlines, minimum 44 px action targets, scrollable independent source/review columns, and no horizontal page overflow.

- [ ] **Step 8: Run focused UI tests and validation**

Run: `npm test -- src/features/data-room/DocumentExtractionWorkspace.test.tsx src/features/data-room/CandidateReviewWorkspace.test.tsx src/features/data-room/ManualEvidenceForm.test.tsx src/features/data-room/DataRoomPage.test.tsx src/features/data-room/ProjectDataRoomRoute.test.tsx && npm run typecheck && npm run lint`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app/src/features/data-room app/src/app/router.tsx app/src/index.css
git commit -m "feat: review PDF and PPT evidence in data room"
```

---

### Task 11: Add quick-look/formal readiness and full offline integration coverage

**Files:**
- Create: `app/src/domain/readiness/calculate-report-readiness.ts`
- Create: `app/src/domain/readiness/calculate-report-readiness.test.ts`
- Modify: `app/src/features/dashboard/ProjectDashboardRoute.tsx`
- Modify: `app/src/features/dashboard/ProjectDashboardRoute.test.tsx`
- Modify: `app/src/features/dashboard/ProjectDashboardPage.tsx`
- Modify: `app/src/features/dashboard/ProjectDashboardPage.test.tsx`
- Create: `app/src/integration/pdf-ppt-only-flow.test.tsx`

- [ ] **Step 1: Write failing report-readiness tests**

```ts
it('allows a quick-look without Excel after confirming core document evidence', () => {
  const readiness = calculateReportReadiness({
    projectId: 'p1',
    documentCount: 1,
    pendingCandidateCount: 2,
    evidence: [
      evidence('company_name', '星云科技'),
      evidence('business_description', '企业级数据平台'),
      evidence('team_summary', '创始团队拥有十年经验'),
    ],
    formalRequiredFieldIds: ['company_name', 'business_description', 'revenue', 'gross_margin'],
  });
  expect(readiness.quickLook.canExport).toBe(true);
  expect(readiness.formal.canExport).toBe(false);
  expect(readiness.decisionState).toBe('insufficient-data');
});
```

Also test: no source document blocks quick-look; missing company or business blocks quick-look; any one of team/product/market satisfies the third quick-look fact; pending candidates do not count as evidence; unresolved conflicts block formal but not quick-look; complete formal fields with no conflicts allow formal; investor assumptions do not satisfy historical formal requirements.

- [ ] **Step 2: Run the readiness test and verify it fails**

Run: `npm test -- src/domain/readiness/calculate-report-readiness.test.ts`

Expected: FAIL because report readiness does not exist.

- [ ] **Step 3: Implement report readiness**

```ts
export interface ReportGate {
  readonly canExport: boolean;
  readonly missingFieldIds: readonly string[];
  readonly blockingReasons: readonly string[];
}

export interface ReportReadiness {
  readonly quickLook: ReportGate;
  readonly formal: ReportGate;
  readonly pendingCandidateCount: number;
  readonly unresolvedConflictCount: number;
  readonly decisionState: 'ready' | 'insufficient-data' | 'conflicted';
}
```

Quick-look requires at least one stored document, formal `company_name`, formal `business_description`, and at least one formal field among `team_summary`, `product_summary`, or `market_summary`. Formal readiness delegates field presence/conflict validation to existing readiness logic and adds source-type checks so `investor_assumption` cannot satisfy historical required fields.

- [ ] **Step 4: Update Dashboard route and page**

Query document count and pending candidate count from local repositories. Replace the single export card with two cards: `项目速览报告` and `正式投资备忘录`. Show pending candidate count, unresolved conflict count, missing formal fields, and the distinct label `资料不足，暂缓决策` when appropriate. Do not add a working Word button in this plan; expose disabled gates that the DOCX plan will consume.

- [ ] **Step 5: Add the PDF/PPT-only integration test**

The test must create a project, upload a real synthetic `File`, inject a fake document worker result containing source fragments and candidates, parse it, confirm company/business/team candidates, reload the route, assert persisted evidence and no duplicate candidates, then assert quick-look readiness true and formal readiness false. Spy on `fetch` for the whole flow and expect zero calls.

- [ ] **Step 6: Run the complete suite**

Run: `npm run check`

Expected: all tests, typecheck, and lint PASS.

- [ ] **Step 7: Build and audit**

Run: `npm run build && npm audit --offline --audit-level=high`

Expected: production build PASS; audit reports 0 high/critical vulnerabilities. Record any non-blocking Vite chunk warning without hiding it.

- [ ] **Step 8: Commit**

```bash
git add app/src/domain/readiness app/src/features/dashboard app/src/integration/pdf-ppt-only-flow.test.tsx
git commit -m "feat: add PDF and PPT report readiness"
```

---

### Task 12: Real-browser verification and phase handoff

**Files:**
- Create: `docs/superpowers/verification/2026-07-23-pdf-ppt-evidence-browser-smoke.md`

- [ ] **Step 1: Start the production-equivalent local app**

Run: `npm run dev -- --host 127.0.0.1`

Expected: Vite serves the app on a local URL and does not bind a public interface.

- [ ] **Step 2: Verify a real text PDF path in Chrome**

Use a synthetic, non-confidential PDF containing company name, business description, and team summary. Verify upload, local save, production Worker extraction, three candidates, source page locators, confirmation, browser refresh persistence, and quick-look readiness. Check browser console for warnings/errors and network logs for unintended document-content requests.

- [ ] **Step 3: Verify a real PPTX path in Chrome**

Use `app/src/test/fixtures/minimal-due-diligence.pptx`. Verify slide text/table/notes extraction, slide locator display, correction with a reason, rejection audit, refresh persistence, and no duplicate candidates after reparse.

- [ ] **Step 4: Verify failure and fallback paths**

Upload a `.ppt` placeholder and confirm conversion guidance plus manual entry. Trigger an injected parse failure and confirm the original file remains listed, manual entry remains available, and existing evidence is unchanged.

- [ ] **Step 5: Compare implementation to the approved UI concept**

Capture the latest browser screenshot and inspect it beside the approved concept with `view_image`. Fix any spacing, typography, hierarchy, focus, responsive, or interaction mismatch before recording the result.

- [ ] **Step 6: Run final verification**

Run: `git diff --check && npm run check && npm run build && npm audit --offline --audit-level=high`

Expected: clean diff check; all automated checks PASS; 0 high/critical vulnerabilities.

- [ ] **Step 7: Write and commit the smoke record**

Record exact files, project id, observed candidates, locators, readiness states, console result, network result, and any known non-blocking warning.

```bash
git add docs/superpowers/verification/2026-07-23-pdf-ppt-evidence-browser-smoke.md
git commit -m "docs: verify PDF and PPT evidence workflow"
```

---

## Plan self-review checklist

- Every approved first-slice requirement maps to a task: local storage, source fragments, candidates, human confirmation, manual fallback, PDF/PPTX parsing, provenance, conflict handling, idempotency, readiness, offline behavior, and browser validation.
- OCR is explicitly isolated into a second plan because language assets, cancellation, and image rendering are an independent performance/security subsystem.
- DOCX generation is explicitly isolated into a third plan because report rendering and golden-file verification are independent from ingestion correctness.
- All new stored records pass Zod parsing at repository or worker boundaries.
- All worker outputs are bounded and revalidated on the main thread.
- Excel behavior is regression-tested after shared ZIP refactoring.
- No candidate reaches formal analysis without explicit confirmation or correction.
- No task requires a cloud account or API key.
