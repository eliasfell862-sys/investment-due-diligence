import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { StoredDocument } from '../../infrastructure/db/app-db';
import type { DocumentCandidateResult } from '../../infrastructure/import/document-importer';
import { DocumentExtractionWorkspace } from './DocumentExtractionWorkspace';

function storedDocument(name: string, id = name): StoredDocument {
  return {
    id,
    projectId: 'project-1',
    name,
    mimeType: name.endsWith('.pptx')
      ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      : 'application/pdf',
    size: 8,
    uploadedAt: '2026-07-24T00:00:00.000Z',
    parseStatus: 'unparsed',
    blob: new Blob(['document']),
  };
}

function result(overrides: Partial<DocumentCandidateResult> = {}): DocumentCandidateResult {
  return {
    projectId: 'project-1',
    documentId: 'deck.pdf',
    fragments: [],
    candidates: [],
    needsOcrPageNumbers: [],
    warnings: [],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function repository() {
  return {
    markParsing: vi.fn().mockResolvedValue(undefined),
    saveExtraction: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  };
}

describe('DocumentExtractionWorkspace', () => {
  it.each(['memo.pdf', 'deck.pptx'])('offers document parsing for %s', (name) => {
    render(
      <DocumentExtractionWorkspace
        projectId="project-1"
        document={storedDocument(name)}
        documentRepository={repository()}
        documentInspector={vi.fn()}
        onOpenManual={vi.fn()}
        onOpenReview={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '解析资料' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '手动录入' })).toBeInTheDocument();
  });

  it('asks legacy PowerPoint users to save as PPTX and keeps manual entry available', () => {
    render(
      <DocumentExtractionWorkspace
        projectId="project-1"
        document={storedDocument('legacy.ppt')}
        documentRepository={repository()}
        documentInspector={vi.fn()}
        onOpenManual={vi.fn()}
        onOpenReview={vi.fn()}
      />,
    );

    expect(screen.getByText('请另存为 PPTX')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '手动录入' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '解析资料' })).not.toBeInTheDocument();
  });

  it('marks, reads, inspects, persists, and exposes pending review without networking', async () => {
    const document = storedDocument('deck.pdf');
    const arrayBuffer = vi.spyOn(document.blob, 'arrayBuffer');
    const documentRepository = repository();
    const documentInspector = vi.fn().mockResolvedValue(result({
      candidates: [{ id: 'candidate-1' } as DocumentCandidateResult['candidates'][number]],
    }));
    const fetch = vi.spyOn(globalThis, 'fetch');

    render(
      <DocumentExtractionWorkspace
        projectId="project-1"
        document={document}
        documentRepository={documentRepository}
        documentInspector={documentInspector}
        onOpenManual={vi.fn()}
        onOpenReview={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '解析资料' }));

    expect(await screen.findByText('待审核')).toBeInTheDocument();
    expect(documentRepository.markParsing).toHaveBeenCalledWith('project-1', 'deck.pdf');
    expect(arrayBuffer).toHaveBeenCalledOnce();
    expect(documentInspector).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      documentId: 'deck.pdf',
      kind: 'pdf',
      fileName: 'deck.pdf',
    }));
    expect(documentRepository.saveExtraction).toHaveBeenCalledWith(
      'project-1',
      'deck.pdf',
      [],
      expect.any(Array),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps manual entry enabled while document parsing is pending', async () => {
    const pending = deferred<DocumentCandidateResult>();
    const onOpenManual = vi.fn();
    const document = storedDocument('pending.pdf');

    render(
      <DocumentExtractionWorkspace
        projectId="project-1"
        document={document}
        documentRepository={repository()}
        documentInspector={() => pending.promise}
        onOpenManual={onOpenManual}
        onOpenReview={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '解析资料' }));

    expect(screen.getByRole('button', { name: '正在解析…' })).toBeDisabled();
    const manual = screen.getByRole('button', { name: '手动录入' });
    expect(manual).toBeEnabled();
    await userEvent.click(manual);
    expect(onOpenManual).toHaveBeenCalledWith(document);
  });

  it('preserves fragments and offers manual entry when no structured candidates are found', async () => {
    const documentRepository = repository();
    const fragment = { id: 'fragment-1' } as DocumentCandidateResult['fragments'][number];

    render(
      <DocumentExtractionWorkspace
        projectId="project-1"
        document={storedDocument('deck.pdf')}
        documentRepository={documentRepository}
        documentInspector={vi.fn().mockResolvedValue(result({ fragments: [fragment] }))}
        onOpenManual={vi.fn()}
        onOpenReview={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '解析资料' }));

    expect(await screen.findByText('未识别到结构化字段，可手动录入')).toBeInTheDocument();
    expect(documentRepository.saveExtraction).toHaveBeenCalledWith(
      'project-1',
      'deck.pdf',
      [fragment],
      [],
    );
  });

  it('retries only the selected failed document', async () => {
    const firstRepository = repository();
    const secondRepository = repository();
    const firstInspector = vi.fn().mockRejectedValue(new Error('broken PDF'));
    const secondInspector = vi.fn();

    render(
      <>
        <DocumentExtractionWorkspace projectId="project-1" document={storedDocument('broken.pdf')} documentRepository={firstRepository} documentInspector={firstInspector} onOpenManual={vi.fn()} onOpenReview={vi.fn()} />
        <DocumentExtractionWorkspace projectId="project-1" document={storedDocument('other.pdf')} documentRepository={secondRepository} documentInspector={secondInspector} onOpenManual={vi.fn()} onOpenReview={vi.fn()} />
      </>,
    );

    await userEvent.click(screen.getAllByRole('button', { name: '解析资料' })[0]!);
    await screen.findByRole('alert');
    expect(firstRepository.markFailed).toHaveBeenCalledWith(
      'project-1',
      'broken.pdf',
      'worker-failed',
    );
    await userEvent.click(screen.getByRole('button', { name: '重试解析' }));

    await waitFor(() => expect(firstInspector).toHaveBeenCalledTimes(2));
    expect(secondInspector).not.toHaveBeenCalled();
  });

  it.each([
    'project id',
    'document id',
    'repository identity',
    'inspector identity',
  ] as const)('ignores a late result after only the %s changes', async (change) => {
    const late = deferred<DocumentCandidateResult>();
    const originalRepository = repository();
    const replacementRepository = repository();
    const originalInspector = vi.fn(() => late.promise);
    const replacementInspector = vi.fn();
    const originalDocument = storedDocument('old.pdf');
    const view = render(
      <DocumentExtractionWorkspace
        projectId="project-1"
        document={originalDocument}
        documentRepository={originalRepository}
        documentInspector={originalInspector}
        onOpenManual={vi.fn()}
        onOpenReview={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '解析资料' }));

    const nextProjectId = change === 'project id' ? 'project-2' : 'project-1';
    const nextDocument = change === 'document id'
      ? storedDocument('new.pdf')
      : change === 'project id'
        ? { ...originalDocument, projectId: 'project-2' }
        : originalDocument;
    view.rerender(
      <DocumentExtractionWorkspace
        projectId={nextProjectId}
        document={nextDocument}
        documentRepository={
          change === 'repository identity' ? replacementRepository : originalRepository
        }
        documentInspector={
          change === 'inspector identity' ? replacementInspector : originalInspector
        }
        onOpenManual={vi.fn()}
        onOpenReview={vi.fn()}
      />,
    );
    await act(async () => {
      late.resolve(result({ documentId: 'old.pdf' }));
      await late.promise;
    });

    expect(originalRepository.saveExtraction).not.toHaveBeenCalled();
    expect(originalRepository.markFailed).not.toHaveBeenCalled();
    expect(replacementRepository.saveExtraction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '解析资料' })).toBeInTheDocument();
  });

  it('uses a monotonic request id when context returns to the original identities', async () => {
    const late = deferred<DocumentCandidateResult>();
    const documentRepository = repository();
    const document = storedDocument('old.pdf');
    const inspector = vi.fn()
      .mockImplementationOnce(() => late.promise)
      .mockResolvedValue(result({ documentId: 'old.pdf' }));
    const view = render(
      <DocumentExtractionWorkspace projectId="project-1" document={document} documentRepository={documentRepository} documentInspector={inspector} onOpenManual={vi.fn()} onOpenReview={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: '解析资料' }));

    view.rerender(
      <DocumentExtractionWorkspace projectId="project-2" document={{ ...document, projectId: 'project-2' }} documentRepository={documentRepository} documentInspector={inspector} onOpenManual={vi.fn()} onOpenReview={vi.fn()} />,
    );
    view.rerender(
      <DocumentExtractionWorkspace projectId="project-1" document={document} documentRepository={documentRepository} documentInspector={inspector} onOpenManual={vi.fn()} onOpenReview={vi.fn()} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: '解析资料' }));
    expect(await screen.findByText('未识别到结构化字段，可手动录入')).toBeInTheDocument();
    expect(documentRepository.saveExtraction).toHaveBeenCalledTimes(1);

    await act(async () => {
      late.resolve(result({ documentId: 'old.pdf' }));
      await late.promise;
    });

    expect(documentRepository.saveExtraction).toHaveBeenCalledTimes(1);
  });
});
