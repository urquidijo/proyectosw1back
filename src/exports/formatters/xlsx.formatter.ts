import ExcelJS from 'exceljs';

type Row = Record<string, unknown>;

/** Un workbook con una hoja por tabla, encabezados en negrita y columnas autoanchas. */
export async function buildXlsxWorkbook(
  rowsByTable: Record<string, Row[]>,
  tables: string[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SynData';
  workbook.created = new Date();

  for (const tableName of tables) {
    const rows = rowsByTable[tableName] ?? [];
    const sheet = workbook.addWorksheet(sanitizeSheetName(tableName));

    if (rows.length === 0) continue;

    const columns = Object.keys(rows[0]);
    sheet.columns = columns.map((column) => ({
      header: column,
      key: column,
      width: Math.max(12, column.length + 2),
    }));
    sheet.getRow(1).font = { bold: true };

    for (const row of rows) {
      sheet.addRow(row);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** Excel: máx. 31 caracteres y prohíbe : \ / ? * [ ] en el nombre de hoja. */
function sanitizeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, '_').slice(0, 31);
}
