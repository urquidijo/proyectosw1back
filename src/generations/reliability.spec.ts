import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import { SyntheticDataGeneratorService } from './synthetic-data-generator.service';
import { GenerationPlanExecutorService } from './generation-plan-executor.service';
import { GenerationsService } from './generations.service';
import { PrismaService } from '../prisma/prisma.service';
import { GenerationValidationService } from './generation-validation.service';
import { DeterministicCoherenceService } from './deterministic-coherence.service';
import { DetectedSchema } from '../sql-imports/types/detected-schema.type';

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
}));

/**
 * Pruebas de Fiabilidad (NFR 3.2.2)
 *
 * En SynData la operación crítica equivalente a una transacción financiera es
 * garantizar que ningún registro sintético se genere, o se marque como
 * "completado", si la integridad relacional entre tablas padre/hijo no pudo
 * resolverse correctamente. Estas tres pruebas cubren los escenarios que
 * describe el requisito:
 *
 *  1) Integridad referencial: ninguna fila hija debe quedar huérfana.
 *  2) Consistencia de estado ante fallo parcial: si el worker en segundo
 *     plano falla en cualquier punto del pipeline (incluso después de haber
 *     generado los datos en memoria), la generación debe terminar en
 *     "FAILED" y JAMÁS en "COMPLETED" con datos parciales o corruptos.
 *  3) Aislamiento bajo concurrencia: como no hay un sistema de colas (Redis/
 *     BullMQ) separando los workers, varios trabajos de generación corren en
 *     el mismo proceso Node a la vez; un job que falla no debe contaminar el
 *     resultado de otro job que se ejecuta en paralelo.
 */
describe('Fiabilidad (NFR 3.2.2)', () => {
  describe('1) Integridad referencial: cero filas huérfanas en una generación masiva', () => {
    let generator: SyntheticDataGeneratorService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [SyntheticDataGeneratorService, GenerationPlanExecutorService],
      }).compile();

      generator = module.get(SyntheticDataGeneratorService);
    });

    it('genera 3 niveles de tablas relacionadas (clientes → pedidos → detalle_pedido) sin un solo registro huérfano y con cobertura total de los padres', () => {
      const schema: DetectedSchema = {
        dialect: 'postgresql',
        tables: [
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
            name: 'pedidos',
            primaryKeys: ['id'],
            foreignKeys: [
              { column: 'cliente_id', referencesTable: 'clientes', referencesColumn: 'id' },
            ],
            columns: [
              { name: 'id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: true },
              { name: 'cliente_id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: false, isNullable: false, isUnique: false, references: { table: 'clientes', column: 'id' } },
            ],
          },
          {
            name: 'detalle_pedido',
            primaryKeys: ['id'],
            foreignKeys: [
              { column: 'pedido_id', referencesTable: 'pedidos', referencesColumn: 'id' },
            ],
            columns: [
              { name: 'id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: true },
              { name: 'pedido_id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: false, isNullable: false, isUnique: false, references: { table: 'pedidos', column: 'id' } },
              { name: 'cantidad', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: false, isNullable: false, isUnique: false },
            ],
          },
        ],
      };

      // Más hijos que padres en cada nivel, a propósito: así se puede exigir
      // que CADA padre sea referenciado al menos una vez (cobertura total),
      // no solo que las FKs sean válidas.
      const rowConfig = { clientes: 30, pedidos: 80, detalle_pedido: 200 };

      const result = generator.generate(schema, rowConfig, null, 'GENERIC');

      const clienteIds = new Set(result.rowsByTable.clientes.map((c) => c.id));
      const pedidoIds = new Set(result.rowsByTable.pedidos.map((p) => p.id));

      // --- Sin huérfanos: toda FK debe apuntar a una fila que realmente existe ---
      const pedidosHuerfanos = result.rowsByTable.pedidos.filter(
        (pedido) => !clienteIds.has(pedido.cliente_id),
      );
      expect(pedidosHuerfanos).toHaveLength(0);

      const detallesHuerfanos = result.rowsByTable.detalle_pedido.filter(
        (detalle) => !pedidoIds.has(detalle.pedido_id),
      );
      expect(detallesHuerfanos).toHaveLength(0);

      // --- Cobertura total: ningún cliente ni pedido queda "sin uso" ---
      const clientesReferenciados = new Set(
        result.rowsByTable.pedidos.map((p) => p.cliente_id),
      );
      expect(clientesReferenciados.size).toBe(clienteIds.size);

      const pedidosReferenciados = new Set(
        result.rowsByTable.detalle_pedido.map((d) => d.pedido_id),
      );
      expect(pedidosReferenciados.size).toBe(pedidoIds.size);
    });
  });

  describe('2) Consistencia de estado: un fallo parcial del worker nunca debe entregarse como "completado"', () => {
    const schema: DetectedSchema = {
      dialect: 'postgresql',
      tables: [
        {
          name: 'clientes',
          primaryKeys: ['id'],
          foreignKeys: [],
          columns: [
            { name: 'id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: true },
          ],
        },
      ],
    };

    const project = { id: 'p1', ownerId: 'u1' };
    const sqlImport = {
      id: 'sql1',
      projectId: 'p1',
      status: 'VALID',
      schemaJson: schema,
      engine: 'POSTGRESQL',
    };

    let prisma: {
      project: { findFirst: jest.Mock };
      sqlImport: { findFirst: jest.Mock };
      generationRuleSet: { findFirst: jest.Mock };
      generationPlan: { findUnique: jest.Mock };
      generation: { create: jest.Mock; update: jest.Mock };
    };
    let service: GenerationsService;

    const flushBackgroundWork = async () => {
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    };

    beforeEach(() => {
      prisma = {
        project: { findFirst: jest.fn().mockResolvedValue(project) },
        sqlImport: { findFirst: jest.fn().mockResolvedValue(sqlImport) },
        generationRuleSet: { findFirst: jest.fn().mockResolvedValue(null) },
        generationPlan: { findUnique: jest.fn().mockResolvedValue(null) },
        generation: {
          create: jest.fn().mockResolvedValue({
            id: 'g1',
            projectId: 'p1',
            sqlImportId: 'sql1',
            generationRuleSetId: null,
            rowConfig: { clientes: 500 },
            previewJson: {},
            status: 'PENDING',
            progress: 0,
            region: 'GENERIC',
            engine: 'POSTGRESQL',
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      };

      const syntheticDataGenerator = {
        generate: jest.fn().mockReturnValue({
          orderedTables: ['clientes'],
          rowsByTable: { clientes: [{ id: 1 }] },
          preview: { clientes: [{ id: 1 }] },
          outputSql: '-- sql generado correctamente',
        }),
      };
      const validationService = { validate: jest.fn().mockReturnValue({ ok: true }) };
      const coherenceService = { synthesize: jest.fn().mockReturnValue([]) };

      service = new GenerationsService(
        prisma as unknown as PrismaService,
        syntheticDataGenerator as unknown as SyntheticDataGeneratorService,
        validationService as unknown as GenerationValidationService,
        coherenceService as unknown as DeterministicCoherenceService,
      );

      // El motor ya generó los datos en memoria y la validación pasó: el
      // único punto que falta es persistir el resultado en disco. Simulamos
      // justo ahí una caída (disco lleno / proceso interrumpido), que es el
      // escenario más peligroso: si no se maneja, el usuario podría recibir
      // un archivo a medio escribir sin ninguna advertencia.
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device');
      });
    });

    it('si la escritura a disco falla DESPUÉS de generar y validar los datos, la generación termina en FAILED (nunca en COMPLETED) y el error queda registrado', async () => {
      const result = await service.create('p1', 'u1', {
        sqlImportId: 'sql1',
        rowConfig: { clientes: 500 },
      } as any);

      // La respuesta inmediata al usuario sigue siendo no bloqueante
      expect(result.status).toBe('PENDING');

      await flushBackgroundWork();

      const updateCalls = prisma.generation.update.mock.calls.map((c) => c[0]);

      // Invariante de fiabilidad: en TODA la secuencia de updates de este job,
      // jamás debe aparecer un estado "COMPLETED". Si el disco falla, el dato
      // nunca se marca como entregado.
      const seCompletoAlgunaVez = updateCalls.some(
        (call) => call.data.status === 'COMPLETED',
      );
      expect(seCompletoAlgunaVez).toBe(false);

      const finalUpdate = updateCalls[updateCalls.length - 1];
      expect(finalUpdate.data.status).toBe('FAILED');
      expect(finalUpdate.data.error).toContain('ENOSPC');

      // El usuario debe quedarse con un mensaje de error explícito, no con
      // un archivo de salida corrupto o vacío.
      expect(finalUpdate.data.outputFile).toBeUndefined();
    });
  });

  describe('3) Aislamiento bajo concurrencia: dos generaciones simultáneas no contaminan su estado entre sí', () => {
    const schema: DetectedSchema = {
      dialect: 'postgresql',
      tables: [
        {
          name: 'clientes',
          primaryKeys: ['id'],
          foreignKeys: [],
          columns: [
            { name: 'id', rawType: 'INT', normalizedType: 'INTEGER', isPrimaryKey: true, isNullable: false, isUnique: true },
          ],
        },
      ],
    };

    const project = { id: 'p1', ownerId: 'u1' };
    const sqlImport = {
      id: 'sql1',
      projectId: 'p1',
      status: 'VALID',
      schemaJson: schema,
      engine: 'POSTGRESQL',
    };

    let prisma: {
      project: { findFirst: jest.Mock };
      sqlImport: { findFirst: jest.Mock };
      generationRuleSet: { findFirst: jest.Mock };
      generationPlan: { findUnique: jest.Mock };
      generation: { create: jest.Mock; update: jest.Mock };
    };
    let service: GenerationsService;

    const flushBackgroundWork = async () => {
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    };

    beforeEach(() => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.writeFileSync as jest.Mock).mockImplementation(() => undefined);

      prisma = {
        project: { findFirst: jest.fn().mockResolvedValue(project) },
        sqlImport: { findFirst: jest.fn().mockResolvedValue(sqlImport) },
        generationRuleSet: { findFirst: jest.fn().mockResolvedValue(null) },
        generationPlan: { findUnique: jest.fn().mockResolvedValue(null) },
        generation: {
          // El id de cada generación se deriva de su propio rowConfig, no del
          // orden de llamada: así la prueba no depende de cómo el event loop
          // intercala las dos generaciones concurrentes.
          create: jest.fn().mockImplementation(({ data }: any) =>
            Promise.resolve({
              id: data.rowConfig.clientes === 999 ? 'gB-defectuosa' : 'gA-correcta',
              ...data,
              status: 'PENDING',
              progress: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
          ),
          update: jest.fn().mockResolvedValue({}),
        },
      };

      // El motor de generación se comporta distinto según el job: la
      // generación "B" representa un job vecino que falla (ej. un esquema
      // mal formado), mientras "A" se completa con normalidad. Ambos corren
      // en el mismo proceso Node al mismo tiempo, sin aislamiento de colas.
      const syntheticDataGenerator = {
        generate: jest.fn().mockImplementation((_schema: any, rowConfig: any) => {
          if (rowConfig.clientes === 999) {
            throw new Error('fallo en generación B (esquema incompatible)');
          }
          return {
            orderedTables: ['clientes'],
            rowsByTable: { clientes: [{ id: 1 }] },
            preview: { clientes: [{ id: 1 }] },
            outputSql: '-- sql generado correctamente',
          };
        }),
      };
      const validationService = { validate: jest.fn().mockReturnValue({ ok: true }) };
      const coherenceService = { synthesize: jest.fn().mockReturnValue([]) };

      service = new GenerationsService(
        prisma as unknown as PrismaService,
        syntheticDataGenerator as unknown as SyntheticDataGeneratorService,
        validationService as unknown as GenerationValidationService,
        coherenceService as unknown as DeterministicCoherenceService,
      );
    });

    it('si una generación falla mientras otra corre en paralelo, cada una termina con su propio estado correcto (sin mezclar resultados)', async () => {
      const [resultA, resultB] = await Promise.all([
        service.create('p1', 'u1', {
          sqlImportId: 'sql1',
          rowConfig: { clientes: 500 },
        } as any),
        service.create('p1', 'u1', {
          sqlImportId: 'sql1',
          rowConfig: { clientes: 999 },
        } as any),
      ]);

      // Ambas respuestas inmediatas llegan como PENDING, sin bloquearse entre sí
      expect(resultA.status).toBe('PENDING');
      expect(resultB.status).toBe('PENDING');

      await flushBackgroundWork();

      const updatesFor = (generationId: string) =>
        prisma.generation.update.mock.calls
          .map((c) => c[0])
          .filter((call) => call.where.id === generationId);

      const updatesA = updatesFor('gA-correcta');
      const updatesB = updatesFor('gB-defectuosa');

      // El job exitoso (A) nunca queda marcado como FAILED...
      expect(updatesA.some((u) => u.data.status === 'FAILED')).toBe(false);
      expect(updatesA[updatesA.length - 1].data.status).toBe('COMPLETED');

      // ...y el job que falló (B) nunca queda marcado como COMPLETED, ni
      // "hereda" por error el resultado exitoso del job A.
      expect(updatesB.some((u) => u.data.status === 'COMPLETED')).toBe(false);
      expect(updatesB[updatesB.length - 1].data.status).toBe('FAILED');
      expect(updatesB[updatesB.length - 1].data.error).toContain('fallo en generación B');

      // Ningún update de B terminó escribiéndose sobre el registro de A, y viceversa
      expect(updatesA.every((u) => u.where.id === 'gA-correcta')).toBe(true);
      expect(updatesB.every((u) => u.where.id === 'gB-defectuosa')).toBe(true);
    });
  });
});
