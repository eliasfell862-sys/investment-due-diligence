import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentExtractorError } from './document-extractor';

const { extractPdfFragments, extractPptxFragments, recognizeDocumentCandidates } = vi.hoisted(() => ({
  extractPdfFragments: vi.fn(),
  extractPptxFragments: vi.fn(),
  recognizeDocumentCandidates: vi.fn(),
}));

vi.mock('./pdf-extractor', () => ({ extractPdfFragments }));
vi.mock('./pptx-extractor', () => ({ extractPptxFragments }));
vi.mock('../../domain/evidence/recognize-document-candidates', () => ({
  recognizeDocumentCandidates,
}));

import { handleDocumentCandidateWorkerRequest } from './document-candidate.worker';

function request(kind: 'pdf' | 'pptx') {
  return { request: {
    projectId: 'project-1', documentId: 'document-1', documentVersionId: 'version-1',
    fileName: kind === 'pdf' ? 'memo.pdf' : 'deck.pptx', kind, data: new Uint8Array([1]),
  } };
}

describe('document candidate worker boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it.each([
    ['pdf', extractPdfFragments, extractPptxFragments],
    ['pptx', extractPptxFragments, extractPdfFragments],
  ] as const)('dispatches %s extraction and recognizes candidates', async (kind, selected, unused) => {
    const extracted = {
      fragments: [{ id: 'fragment-1' }], needsOcrPageNumbers: [], warnings: [],
    };
    const candidates = [{ id: 'candidate-1' }];
    selected.mockResolvedValue(extracted);
    recognizeDocumentCandidates.mockReturnValue(candidates);

    await expect(handleDocumentCandidateWorkerRequest(request(kind))).resolves.toEqual({
      ok: true,
      result: {
        projectId: 'project-1', documentId: 'document-1', ...extracted, candidates,
      },
    });
    expect(selected).toHaveBeenCalledWith(request(kind).request);
    expect(unused).not.toHaveBeenCalled();
    expect(recognizeDocumentCandidates).toHaveBeenCalledWith(
      'project-1', 'document-1', extracted.fragments,
    );
  });

  it('serializes structured extractor failures', async () => {
    extractPdfFragments.mockRejectedValue(
      new DocumentExtractorError('password-protected', 'Password required.'),
    );
    await expect(handleDocumentCandidateWorkerRequest(request('pdf'))).resolves.toEqual({
      ok: false,
      error: {
        name: 'DocumentExtractorError', code: 'password-protected', message: 'Password required.',
      },
    });
  });

  it('maps unknown worker failures to worker-failed', async () => {
    extractPptxFragments.mockRejectedValue(new Error('unexpected'));
    await expect(handleDocumentCandidateWorkerRequest(request('pptx'))).resolves.toEqual({
      ok: false,
      error: {
        name: 'DocumentExtractorError', code: 'worker-failed', message: 'unexpected',
      },
    });
  });
});
