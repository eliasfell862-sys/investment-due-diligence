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
  const { locator } = fragment;
  const parts = [
    `第 ${locator.pageNumber ?? locator.slideNumber} 页`,
  ];

  if (locator.objectName) {
    parts.push(`对象 ${locator.objectName}`);
  }
  if (locator.tableIndex !== undefined) {
    parts.push(`表格 ${locator.tableIndex}`);
  }
  if (locator.tableRow !== undefined && locator.tableColumn !== undefined) {
    parts.push(`第 ${locator.tableRow} 行第 ${locator.tableColumn} 列`);
  } else if (locator.tableRow !== undefined) {
    parts.push(`第 ${locator.tableRow} 行`);
  } else if (locator.tableColumn !== undefined) {
    parts.push(`第 ${locator.tableColumn} 列`);
  }

  return parts.join(' / ');
}
