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
    await userEvent.click(screen.getByRole('button', { name: '重试解析' }));

    await waitFor(() => expect(firstInspector).toHaveBeenCalledTimes(2));
    expect(secondInspector).not.toHaveBeenCalled();
  });

  it('ignores a late result after the project, document, or repository changes', async () => {
    const late = deferred<DocumentCandidateResult>();
    const oldRepository = repository();
    const newRepository = repository();
    const view = render(
      <DocumentExtractionWorkspace
        projectId="project-1"
        document={storedDocument('old.pdf')}
        documentRepository={oldRepository}
        documentInspector={() => late.promise}
        onOpenManual={vi.fn()}
        onOpenReview={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '解析资料' }));

    view.rerender(
      <DocumentExtractionWorkspace
        projectId="project-2"
        document={{ ...storedDocument('new.pdf'), projectId: 'project-2' }}
        documentRepository={newRepository}
        documentInspector={vi.fn()}
        onOpenManual={vi.fn()}
        onOpenReview={vi.fn()}
      />,
    );
    await act(async () => {
      late.resolve(result({ documentId: 'old.pdf' }));
      await late.promise;
    });

    expect(oldRepository.saveExtraction).not.toHaveBeenCalled();
    expect(oldRepository.markFailed).not.toHaveBeenCalled();
    expect(newRepository.saveExtraction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '解析资料' })).toBeInTheDocument();
  });
});
