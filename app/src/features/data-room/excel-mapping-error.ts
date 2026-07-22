export class ExcelMappingSubmissionError extends Error {
  readonly code: 'no-importable-data';

  constructor(code: 'no-importable-data') {
    super(code);
    this.name = 'ExcelMappingSubmissionError';
    this.code = code;
  }
}
