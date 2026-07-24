import { recognizeDocumentCandidates } from '../../domain/evidence/recognize-document-candidates';
import { extractPdfFragments } from './pdf-extractor';
import { extractPptxFragments } from './pptx-extractor';
import {
  serializeDocumentExtractorError,
  type DocumentCandidateWorkerRequest,
  type DocumentCandidateWorkerResponse,
} from './document-importer';

interface DocumentCandidateWorkerScope {
  onmessage: ((event: MessageEvent<DocumentCandidateWorkerRequest>) => void) | null;
  postMessage(message: DocumentCandidateWorkerResponse): void;
}

export async function handleDocumentCandidateWorkerRequest(
  message: DocumentCandidateWorkerRequest,
): Promise<DocumentCandidateWorkerResponse> {
  try {
    const request = message.request;
    const extracted = request.kind === 'pdf'
      ? await extractPdfFragments(request)
      : await extractPptxFragments(request);
    const candidates = recognizeDocumentCandidates(
      request.projectId,
      request.documentId,
      extracted.fragments,
    );
    return {
      ok: true,
      result: {
        projectId: request.projectId,
        documentId: request.documentId,
        ...extracted,
        candidates,
      },
    };
  } catch (error) {
    return { ok: false, error: serializeDocumentExtractorError(error) };
  }
}

if (typeof self !== 'undefined' && typeof document === 'undefined') {
  const workerScope = self as unknown as DocumentCandidateWorkerScope;
  workerScope.onmessage = async (event) => {
    workerScope.postMessage(await handleDocumentCandidateWorkerRequest(event.data));
  };
}
