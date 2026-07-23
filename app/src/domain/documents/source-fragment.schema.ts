import { z } from 'zod';
import type { SourceFragment } from './source-fragment';

const trimmedNonEmptyString = z.string().trim().min(1);
const positiveInteger = z.number().int().positive();
const boundingBoxSchema = z.tuple([
  z.number().finite().nonnegative(),
  z.number().finite().nonnegative(),
  z.number().finite().nonnegative(),
  z.number().finite().nonnegative(),
]);

const sourceLocatorSchema = z
  .object({
    pageNumber: positiveInteger.optional(),
    slideNumber: positiveInteger.optional(),
    objectId: trimmedNonEmptyString.optional(),
    objectName: trimmedNonEmptyString.optional(),
    tableIndex: positiveInteger.optional(),
    tableRow: positiveInteger.optional(),
    tableColumn: positiveInteger.optional(),
    boundingBox: boundingBoxSchema.optional(),
  })
  .strict()
  .refine(
    ({ pageNumber, slideNumber }) =>
      (pageNumber === undefined) !== (slideNumber === undefined),
    { message: 'Exactly one of pageNumber or slideNumber is required' },
  );

const sourceFragmentInputSchema = z
  .object({
    id: trimmedNonEmptyString,
    projectId: trimmedNonEmptyString,
    documentId: trimmedNonEmptyString,
    documentVersionId: trimmedNonEmptyString,
    sourceKind: z.enum([
      'pdf_text',
      'pdf_table',
      'ppt_text',
      'ppt_table',
      'ppt_notes',
      'embedded_chart_data',
      'ocr',
    ]),
    locator: sourceLocatorSchema,
    rawText: z.string().min(1).max(65_536),
    normalizedText: z.string().min(1).max(65_536),
    extractionMethod: z.enum(['pdfjs', 'pptx_ooxml', 'tesseract']),
    extractionVersion: trimmedNonEmptyString,
    contentHash: trimmedNonEmptyString,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export function parseSourceFragment(input: unknown): SourceFragment {
  const parsed = sourceFragmentInputSchema.parse(input);

  return {
    ...parsed,
    createdAt: new Date(parsed.createdAt).toISOString(),
  };
}
