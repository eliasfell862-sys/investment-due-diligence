# PDF/PPT Evidence Vertical Slice Plan Addendum

This addendum is part of `2026-07-23-pdf-ppt-evidence-vertical-slice.md` and resolves the type-consistency check for management forecasts. Apply these instructions in the named tasks; all other plan steps remain unchanged.

## Task 1 amendment: candidate source-type hint

Add this property to `EvidenceCandidate` immediately after `recognitionMethod`:

```ts
readonly sourceTypeHint: 'document_fact' | 'management_forecast';
```

Update `parseEvidenceCandidate` to require exactly one of those two values. Update the pending-candidate fixture with:

```ts
sourceTypeHint: 'document_fact',
```

## Task 3 amendment: promotion source type

When `CandidateReviewService` constructs formal evidence, use the candidate hint directly:

```ts
const evidence: EvidenceItem = {
  // existing deterministic identity and source fields
  sourceType: candidate.sourceTypeHint,
  candidateId: candidate.id,
  sourceFragmentIds: candidate.sourceFragmentIds,
  // existing value, audit, confidence, and timestamps
};
```

Confirmation and correction must preserve the same `sourceTypeHint`; user correction changes the value, not whether the source was a management forecast.

## Task 6 amendment: deterministic forecast classification

Set the hint when a labeled rule matches:

```ts
const forecastPattern = /(?:预计|预测|目标|forecast|projection)/iu;
const sourceTypeHint = forecastPattern.test(line)
  ? 'management_forecast'
  : 'document_fact';
```

Include `sourceTypeHint` in both the deterministic candidate id seed and `candidateFingerprint` seed:

```ts
const identitySeed = JSON.stringify([
  projectId,
  documentId,
  fieldId,
  periodIdentity,
  dimensionIdentity,
  normalizedValue,
  sourceTypeHint,
  [...sourceFragmentIds].sort(),
]);
```

Add this test to `recognize-document-candidates.test.ts`:

```ts
it('keeps management projections separate from historical facts', () => {
  const [candidate] = recognizeDocumentCandidates(
    'p1',
    'd1',
    [fragment('管理层预测：2026 年 ARR：2 亿元', 'fragment:forecast')],
    fixedOptions,
  );
  expect(candidate).toMatchObject({
    fieldId: 'arr',
    periodIdentity: '2026-12-31',
    normalizedValue: '200000000',
    sourceTypeHint: 'management_forecast',
  });
});
```

The ARR recognition rule must allow one forecast prefix before the year/field label while still requiring the full labeled form. It must not recognize unlabeled prose containing only a future number.
