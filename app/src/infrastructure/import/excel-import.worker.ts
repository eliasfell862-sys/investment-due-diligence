import {
  inspectWorkbook,
  serializeExcelImporterError,
  type ExcelWorkerRequest,
  type ExcelWorkerResponse,
} from './excel-importer';

interface ExcelWorkerScope {
  onmessage: ((event: MessageEvent<ExcelWorkerRequest>) => void) | null;
  postMessage(message: ExcelWorkerResponse): void;
}

const workerScope = self as unknown as ExcelWorkerScope;

workerScope.onmessage = (event) => {
  try {
    const workbook = inspectWorkbook(event.data.data, event.data.options);
    workerScope.postMessage({ ok: true, workbook });
  } catch (error) {
    workerScope.postMessage({ ok: false, error: serializeExcelImporterError(error) });
  }
};
