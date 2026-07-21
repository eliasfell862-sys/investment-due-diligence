export function formatFileSize(bytes: number): string {
  const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safeBytes < 1024) {
    return `${Math.round(safeBytes)} B`;
  }

  const units = ['KiB', 'MiB', 'GiB'];
  const unitIndex = Math.min(Math.floor(Math.log(safeBytes) / Math.log(1024)), 3) - 1;
  const value = safeBytes / 1024 ** (unitIndex + 1);
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
}
