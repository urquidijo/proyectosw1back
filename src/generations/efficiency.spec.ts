import { Test, TestingModule } from '@nestjs/testing';
import { SyntheticDataGeneratorService } from './synthetic-data-generator.service';
import { GenerationPlanExecutorService } from './generation-plan-executor.service';
import { DetectedSchema } from '../sql-imports/types/detected-schema.type';

/**
 * Pruebas de Eficiencia (NFR 3.2.5)
 *
 * El riesgo de eficiencia más crítico en SynData es la generación de
 * volúmenes grandes de datos sintéticos manteniendo integridad relacional
 * (motivo por el cual HU12 introdujo procesamiento asíncrono en vez de
 * bloquear el hilo principal con la generación completa). Esta prueba mide
 * el tiempo real del motor de generación al tope que el sistema permite hoy
 * (10 000 filas por tabla, validado en generations.service.ts) repartido en
 * varias tablas relacionadas, y exige que termine dentro de un presupuesto
 * de tiempo razonable sin sacrificar la integridad referencial.
 */
describe('Eficiencia (NFR 3.2.5)', () => {
  let generator: SyntheticDataGeneratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SyntheticDataGeneratorService, GenerationPlanExecutorService],
    }).compile();

    generator = module.get(SyntheticDataGeneratorService);
  });

  it('genera 27 050 filas en 5 tablas relacionadas (al tope de 10 000 filas/tabla permitido) en menos de 3s y sin perder integridad referencial', () => {
    const schema: DetectedSchema = {
      dialect: 'postgresql',
      tables: [
        {
          name: 'categorias',
          primaryKeys: ['id'],
          foreignKeys: [],
          columns: [
            { name: 'id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: true },
            { name: 'nombre', rawType: 'VARCHAR', normalizedType: 'STRING', isPrimaryKey: false, isNullable: false, isUnique: false },
          ],
        },
        {
          name: 'productos',
          primaryKeys: ['id'],
          foreignKeys: [
            { column: 'categoria_id', referencesTable: 'categorias', referencesColumn: 'id' },
          ],
          columns: [
            { name: 'id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: true },
            { name: 'categoria_id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: false, isNullable: false, isUnique: false, references: { table: 'categorias', column: 'id' } },
            { name: 'precio', rawType: 'DECIMAL', normalizedType: 'DECIMAL', isPrimaryKey: false, isNullable: false, isUnique: false },
          ],
        },
        {
          name: 'clientes',
          primaryKeys: ['id'],
          foreignKeys: [],
          columns: [
            { name: 'id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: true },
            { name: 'nombre', rawType: 'VARCHAR', normalizedType: 'STRING', isPrimaryKey: false, isNullable: false, isUnique: false },
          ],
        },
        {
          name: 'ventas',
          primaryKeys: ['id'],
          foreignKeys: [
            { column: 'cliente_id', referencesTable: 'clientes', referencesColumn: 'id' },
          ],
          columns: [
            { name: 'id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: true },
            { name: 'cliente_id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: false, isNullable: false, isUnique: false, references: { table: 'clientes', column: 'id' } },
            { name: 'fecha', rawType: 'DATE', normalizedType: 'DATE', isPrimaryKey: false, isNullable: false, isUnique: false },
          ],
        },
        {
          name: 'detalle_ventas',
          primaryKeys: ['id'],
          foreignKeys: [
            { column: 'venta_id', referencesTable: 'ventas', referencesColumn: 'id' },
            { column: 'producto_id', referencesTable: 'productos', referencesColumn: 'id' },
          ],
          columns: [
            { name: 'id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: true },
            { name: 'venta_id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: false, isNullable: false, isUnique: false, references: { table: 'ventas', column: 'id' } },
            { name: 'producto_id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: false, isNullable: false, isUnique: false, references: { table: 'productos', column: 'id' } },
            { name: 'cantidad', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: false, isNullable: false, isUnique: false },
          ],
        },
      ],
    };

    const rowConfig = {
      categorias: 50,
      productos: 2000,
      clientes: 5000,
      ventas: 10000,
      detalle_ventas: 10000,
    };
    const totalRows = Object.values(rowConfig).reduce((a, b) => a + b, 0);

    const start = Date.now();
    const result = generator.generate(schema, rowConfig, null, 'GENERIC');
    const elapsedMs = Date.now() - start;

    // --- Volumen completo generado ---
    expect(result.rowsByTable.categorias).toHaveLength(50);
    expect(result.rowsByTable.productos).toHaveLength(2000);
    expect(result.rowsByTable.clientes).toHaveLength(5000);
    expect(result.rowsByTable.ventas).toHaveLength(10000);
    expect(result.rowsByTable.detalle_ventas).toHaveLength(10000);
    expect(totalRows).toBe(27050);

    // --- Presupuesto de tiempo: no debe bloquear el hilo por mucho tiempo ---
    // Medido en una máquina de desarrollo da ~350ms; se deja margen amplio
    // (3s) para no volver el test flaky en CI/máquinas más lentas.
    console.log(`[Eficiencia] ${totalRows} filas generadas en ${elapsedMs}ms`);
    expect(elapsedMs).toBeLessThan(3000);

    // --- La velocidad no sacrifica integridad: cero huérfanos a esta escala ---
    const categoriaIds = new Set(result.rowsByTable.categorias.map((c) => c.id));
    const productoIds = new Set(result.rowsByTable.productos.map((p) => p.id));
    const clienteIds = new Set(result.rowsByTable.clientes.map((c) => c.id));
    const ventaIds = new Set(result.rowsByTable.ventas.map((v) => v.id));

    expect(
      result.rowsByTable.productos.every((p) => categoriaIds.has(p.categoria_id)),
    ).toBe(true);
    expect(
      result.rowsByTable.ventas.every((v) => clienteIds.has(v.cliente_id)),
    ).toBe(true);
    expect(
      result.rowsByTable.detalle_ventas.every(
        (d) => ventaIds.has(d.venta_id) && productoIds.has(d.producto_id),
      ),
    ).toBe(true);
  });
});
