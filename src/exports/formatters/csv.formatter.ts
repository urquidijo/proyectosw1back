type Row = Record<string, unknown>;

const UTF8_BOM = String.fromCharCode(0xfeff);

/**
 * Convierte filas a CSV (RFC 4180): separador coma, CRLF, comillas dobles
 * escapadas. Incluye BOM UTF-8 para que Excel detecte tildes/ñ correctamente
 * al abrir el archivo directamente.
 */
export function rowsToCsv(rows: Row[]): string {
  if (rows.length === 0) return '';

  const columns = Object.keys(rows[0]);
  const header = columns.map(escapeCsvField).join(',');
  const lines = rows.map((row) =>
    columns.map((column) => escapeCsvField(formatCsvValue(row[column]))).join(','),
  );

  return UTF8_BOM + [header, ...lines].join('\r\n');
}

function formatCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function escapeCsvField(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}
