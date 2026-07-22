# Task 8 Excel Import Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Task 8 ZIP-output, worker-boundary, normalization, preview, idempotency, and text-limit security gaps without starting Task 9.

**Architecture:** ZIP structural parsing and actual-output validation run asynchronously before SheetJS, with UI callers routed through the worker boundary. Canonical target metadata drives normalization, while inspected-cell provenance drives preview and evidence output. Security limits are enforced both inside workbook inspection and again when rebuilding worker results.

**Tech Stack:** TypeScript 6, Vite 8, Vitest 4, React 19, SheetJS, browser `DecompressionStream('deflate-raw')`, Web Workers.

---

### Task 1: Validate ZIP local records and actual decompressed output

**Files:**
- Modify: `app/src/infrastructure/import/excel-importer.ts`
- Modify: `app/src/infrastructure/import/excel-importer.test.ts`
- Modify: `app/src/infrastructure/import/excel-import.worker.ts`

- [ ] **Step 1: Write failing ZIP fixture tests**

Add fixtures that build central and local records independently. Assert typed rejection for a missing local signature, mismatched local filename/method/flags/sizes, encrypted flags, data-descriptor flags, and a deflate stream whose actual output exceeds its declared/capped size.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/infrastructure/import/excel-importer.test.ts -t "local header|actual output|encrypted|descriptor"`

Expected: the current central-directory-only preflight accepts at least the local mismatch and actual-output fixtures.

- [ ] **Step 3: Implement central/local entry parsing**

Represent each central entry with name bytes, flags, method, CRC, compressed size, uncompressed size, and local-header offset. Parse the local record at that offset and require signature `0x04034b50`, identical name bytes, flags, method, CRC, and sizes. Reject encryption bit `0`, data-descriptor bit `3`, methods other than store `0` and deflate `8`, truncated local data, overlapping/central-directory data ranges, ZIP64, and multi-disk archives.

- [ ] **Step 4: Implement asynchronous actual-output validation**

For store entries, count the compressed slice directly. For deflate entries, stream the compressed slice through `new DecompressionStream('deflate-raw')`, read chunks, and cancel immediately when the per-entry or cumulative actual-output cap is exceeded. Require actual output to equal the declared uncompressed size before calling SheetJS.

- [ ] **Step 5: Remove the public unsafe synchronous path**

Change `inspectWorkbook` to return `Promise<InspectedWorkbook>`, await ZIP output validation, and keep the synchronous SheetJS parse behind that validated async boundary. Update the worker handler to `async`/`await` and preserve serialized typed errors.

- [ ] **Step 6: Verify GREEN and commit**

Run: `npx vitest run src/infrastructure/import/excel-importer.test.ts src/infrastructure/import/excel-importer.worker.test.ts`

Commit: `fix: validate actual excel zip output`

### Task 2: Harden main-thread worker submission

**Files:**
- Modify: `app/src/infrastructure/import/excel-importer.ts`
- Modify: `app/src/infrastructure/import/excel-importer.worker.test.ts`

- [ ] **Step 1: Write failing worker-input tests**

Assert that `inspectWorkbookInWorker` rejects empty input, input above 25 MiB, and malformed ZIP structure before constructing/posting to a worker. Assert that posting uses a transfer list containing an internal copy and that the caller's original `ArrayBuffer` or `Uint8Array` remains attached and byte-identical.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/infrastructure/import/excel-importer.worker.test.ts -t "preflight|transfer|caller"`

Expected: current code constructs the worker first, posts without a transfer list, and does not define copy semantics.

- [ ] **Step 3: Implement low-cost preflight and copy-transfer semantics**

Before worker construction, enforce empty/25 MiB checks and central/local structural preflight without decompression. Copy only the caller-visible byte range into a new `Uint8Array`, post that copy with `[copy.buffer]`, and document that caller-owned data is never detached or mutated.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npx vitest run src/infrastructure/import/excel-importer.worker.test.ts`

Commit: `fix: preflight excel worker submissions`

### Task 3: Canonical target normalization

**Files:**
- Modify: `app/src/domain/evidence/target-fields.ts`
- Modify: `app/src/infrastructure/import/excel-importer.ts`
- Modify: `app/src/infrastructure/import/excel-importer.test.ts`

- [ ] **Step 1: Write failing normalization tests**

Assert every target definition exposes `valueKind`, `unit`, and `locale`. Assert strict numeric normalization accepts canonical numeric values and valid `en-US` grouping such as `1,234.50`, rejects malformed grouping such as `12,34`, canonicalizes period Date/string inputs, and applies trim plus Unicode NFC normalization to dimensions while preserving raw/display provenance.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/infrastructure/import/excel-importer.test.ts -t "en-US|period|Unicode|valueKind"`

Expected: arbitrary strings currently bypass target-specific normalization.

- [ ] **Step 3: Implement metadata-driven normalization**

Extend `TargetFieldDefinition` with `valueKind: 'number' | 'period' | 'dimension' | 'text'`, `unit`, and `locale`. Normalize mapped evidence through the selected definition: Decimal-backed strict numbers, explicit `en-US` grouping validation, ISO period canonicalization, and NFC-trimmed dimensions/text. Leave `rawValue` and `displayValue` sourced from inspected cell provenance.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npx vitest run src/infrastructure/import/excel-importer.test.ts src/features/data-room/ExcelMappingPanel.test.tsx`

Commit: `fix: normalize canonical excel targets`

### Task 4: Provenance-first preview and completed import state

**Files:**
- Modify: `app/src/features/data-room/ExcelMappingPanel.tsx`
- Modify: `app/src/features/data-room/ExcelMappingPanel.test.tsx`

- [ ] **Step 1: Write failing preview tests**

Assert preview cells prefer `sheet.cells[rowIndex][header].w` when defined, including `''`, and cover percent, date, and formula/cached-value displays.

- [ ] **Step 2: Write failing completed-state tests**

Assert a successful `onMap` call transitions the panel to a completed state, disables repeated submission, and does not call `onMap` again. Assert document or sheet identity changes remount/reset the form and allow a new import.

- [ ] **Step 3: Verify RED**

Run: `npx vitest run src/features/data-room/ExcelMappingPanel.test.tsx -t "preview|completed|idempotent"`

Expected: preview currently reads row values and success returns to an enabled submit button.

- [ ] **Step 4: Implement preview and completion state**

Use inspected cell `w` whenever `w !== undefined`, otherwise format the row value. Track `completed`; after successful `onMap`, keep submission locked and render a completed label. The existing keyed form resets completion when `documentId`, sheet name, or headers change.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npx vitest run src/features/data-room/ExcelMappingPanel.test.tsx`

Commit: `fix: preserve excel preview and completion state`

### Task 5: Enforce bounded text at worker and sanitizer layers

**Files:**
- Modify: `app/src/infrastructure/import/excel-importer.ts`
- Modify: `app/src/infrastructure/import/excel-importer.test.ts`
- Modify: `app/src/infrastructure/import/excel-importer.worker.test.ts`

- [ ] **Step 1: Write failing text-limit tests**

Cover maximum sheet name, header, string cell, formula, number format, and aggregate workbook text. Test both direct inspection and crafted successful worker payloads. Values at the limit pass; values one unit above fail with typed importer errors.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/infrastructure/import/excel-importer.test.ts src/infrastructure/import/excel-importer.worker.test.ts -t "text limit|formula limit|format limit|aggregate text"`

Expected: current code has no bounded text accounting.

- [ ] **Step 3: Implement shared limits**

Define constants for sheet/header/cell/formula/format and cumulative text units. Count UTF-16 code units consistently. Enforce limits while inspecting SheetJS cells and independently while rebuilding worker payloads, rejecting before allocating additional map content once the cumulative cap would be exceeded.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/infrastructure/import/excel-importer.test.ts src/infrastructure/import/excel-importer.worker.test.ts`

- [ ] **Step 5: Final verification**

Run: `npm run check`

Run: `npm run build`

Run: `npm audit --offline --audit-level=high`

Run: `git diff --check`

- [ ] **Step 6: Commit**

Commit: `fix: bound excel import text`
