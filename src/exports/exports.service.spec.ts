import ExcelJS from 'exceljs';
import { ExportsService } from './exports.service';
import { GenerationsService } from '../generations/generations.service';

describe('ExportsService', () => {
  const rowsByTable = {
    clientes: [
      { id: 1, nombre: 'Ana "La" Pérez, García', email: 'ana@example.com' },
      { id: 2, nombre: 'Luis Gómez', email: 'luis@example.com' },
    ],
    productos: [
      { id: 1, nombre: 'Mouse', precio: 45.5 },
      { id: 2, nombre: 'Laptop', precio: 899.99 },
    ],
  };

  const fakeGenerationsService = {
    getOutputSql: jest
      .fn()
      .mockResolvedValue('-- fake sql\nINSERT INTO "clientes" VALUES (1);'),
    getFullData: jest.fn().mockResolvedValue({
      orderedTables: ['clientes', 'productos'],
      rowsByTable,
    }),
  } as unknown as GenerationsService;

  const service = new ExportsService(fakeGenerationsService);

  it('exporta SQL reutilizando el archivo ya generado', async () => {
    const result = await service.export('p1', 'g1', 'u1', 'sql');
    expect(result.filename).toBe('syndata-g1.sql');
    expect(result.contentType).toContain('text/plain');
    expect(result.body).toContain('INSERT INTO');
  });

  it('rechaza SQL + filtro de tabla (no tiene sentido para un dump relacional)', async () => {
    await expect(
      service.export('p1', 'g1', 'u1', 'sql', 'clientes'),
    ).rejects.toThrow();
  });

  it('exporta JSON con todas las tablas cuando no se filtra', async () => {
    const result = await service.export('p1', 'g1', 'u1', 'json');
    expect(result.filename).toBe('syndata-g1.json');
    const parsed = JSON.parse(result.body as string);
    expect(parsed.clientes).toHaveLength(2);
    expect(parsed.productos).toHaveLength(2);
  });

  it('exporta JSON de una sola tabla como array plano', async () => {
    const result = await service.export('p1', 'g1', 'u1', 'json', 'clientes');
    expect(result.filename).toBe('syndata-g1-clientes.json');
    const parsed = JSON.parse(result.body as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  it('exporta CSV de una sola tabla escapando comillas y comas (RFC 4180)', async () => {
    const result = await service.export('p1', 'g1', 'u1', 'csv', 'clientes');
    const csv = result.body as string;
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM para Excel
    expect(csv).toContain('"Ana ""La"" Pérez, García"');
    expect(csv.split('\r\n')).toHaveLength(3); // header + 2 filas
  });

  it('exporta CSV de varias tablas como un .zip con un .csv por tabla', async () => {
    const result = await service.export('p1', 'g1', 'u1', 'csv');
    expect(result.filename).toBe('syndata-g1-csv.zip');
    expect(result.contentType).toBe('application/zip');
    const buffer = result.body as Buffer;
    // Firma estándar de un archivo ZIP (PK\x03\x04)
    expect(buffer.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('exporta XLSX con una hoja por tabla y los datos correctos', async () => {
    const result = await service.export('p1', 'g1', 'u1', 'xlsx');
    expect(result.filename).toBe('syndata-g1.xlsx');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.body as any);

    const sheetNames = workbook.worksheets.map((s) => s.name);
    expect(sheetNames).toEqual(['clientes', 'productos']);

    const clientesSheet = workbook.getWorksheet('clientes')!;
    expect(clientesSheet.rowCount).toBe(3); // header + 2 filas
    expect(clientesSheet.getRow(1).getCell(2).value).toBe('nombre');
  });

  it('rechaza una tabla que no existe en la generación', async () => {
    await expect(
      service.export('p1', 'g1', 'u1', 'csv', 'tabla_inexistente'),
    ).rejects.toThrow();
  });
});
