import * as fs from 'fs';
import { BadRequestException } from '@nestjs/common';
import { GenerationsService } from './generations.service';
import { PrismaService } from '../prisma/prisma.service';
import { SyntheticDataGeneratorService } from './synthetic-data-generator.service';
import { GenerationValidationService } from './generation-validation.service';
import { DeterministicCoherenceService } from './deterministic-coherence.service';
import { DetectedSchema } from '../sql-imports/types/detected-schema.type';

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
}));

describe('GenerationsService (CP-12 Generación Masiva SQL)', () => {
  const schema: DetectedSchema = {
    dialect: 'postgresql',
    tables: [
      {
        name: 'clientes',
        primaryKeys: ['id'],
        foreignKeys: [],
        columns: [
          {
            name: 'id',
            rawType: 'INT',
            normalizedType: 'INTEGER',
            isPrimaryKey: true,
            isNullable: false,
            isUnique: true,
          },
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
  let syntheticDataGenerator: { generate: jest.Mock };
  let validationService: { validate: jest.Mock };
  let coherenceService: { synthesize: jest.Mock };
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
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'g1',
            projectId: 'p1',
            sqlImportId: 'sql1',
            generationRuleSetId: null,
            rowConfig: { clientes: 5000 },
            previewJson: {},
            status: 'PENDING',
            progress: 0,
            region: 'GENERIC',
            engine: data.engine ?? 'POSTGRESQL',
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    syntheticDataGenerator = {
      generate: jest.fn().mockReturnValue({
        orderedTables: ['clientes'],
        rowsByTable: { clientes: [{ id: 1 }] },
        preview: { clientes: [{ id: 1 }] },
        outputSql: '-- sql generado',
      }),
    };
    validationService = { validate: jest.fn().mockReturnValue({ ok: true }) };
    coherenceService = { synthesize: jest.fn().mockReturnValue([]) };

    service = new GenerationsService(
      prisma as unknown as PrismaService,
      syntheticDataGenerator as unknown as SyntheticDataGeneratorService,
      validationService as unknown as GenerationValidationService,
      coherenceService as unknown as DeterministicCoherenceService,
    );

    (fs.existsSync as jest.Mock).mockReturnValue(true);
  });

  it('ejecuta la generación masiva en segundo plano sin bloquear: responde de inmediato con PENDING', async () => {
    const result = await service.create('p1', 'u1', {
      sqlImportId: 'sql1',
      rowConfig: { clientes: 5000 },
    } as any);

    // La respuesta llega antes de que el trabajo en segundo plano corra
    expect(result.status).toBe('PENDING');
    expect(prisma.generation.update).not.toHaveBeenCalled();
    expect(syntheticDataGenerator.generate).not.toHaveBeenCalled();

    await flushBackgroundWork();

    // Tras liberar el event loop, el proceso en segundo plano completó la generación
    expect(syntheticDataGenerator.generate).toHaveBeenCalledTimes(1);
    const updateCalls = prisma.generation.update.mock.calls.map((c) => c[0]);
    const finalUpdate = updateCalls[updateCalls.length - 1];
    expect(finalUpdate.data.status).toBe('COMPLETED');
    expect(finalUpdate.data.progress).toBe(100);
  });

  it('respeta las relaciones entre tablas al pasar el esquema completo (con FKs) al motor de generación', async () => {
    await service.create('p1', 'u1', {
      sqlImportId: 'sql1',
      rowConfig: { clientes: 5000 },
    } as any);

    await flushBackgroundWork();

    expect(syntheticDataGenerator.generate).toHaveBeenCalledWith(
      schema,
      { clientes: 5000 },
      expect.anything(),
      undefined,
      undefined,
      'POSTGRESQL',
    );
  });

  it('hereda el motor MongoDB definido al analizar el SQL: lo persiste, lo pasa al generador y usa extensión .js', async () => {
    prisma.sqlImport.findFirst.mockResolvedValue({ ...sqlImport, engine: 'MONGODB' });

    const result = await service.create('p1', 'u1', {
      sqlImportId: 'sql1',
      rowConfig: { clientes: 5000 },
    } as any);

    // El motor de la importación se refleja de inmediato en la respuesta (antes del trabajo en segundo plano)
    expect(result.engine).toBe('MONGODB');
    expect(prisma.generation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ engine: 'MONGODB' }) }),
    );

    await flushBackgroundWork();

    expect(syntheticDataGenerator.generate).toHaveBeenCalledWith(
      schema,
      { clientes: 5000 },
      expect.anything(),
      undefined,
      undefined,
      'MONGODB',
    );

    const writeCalls = (fs.writeFileSync as jest.Mock).mock.calls;
    const scriptWrite = writeCalls.find(([path]) => String(path).endsWith('.js'));
    expect(scriptWrite).toBeDefined();
  });

  it('rechaza cantidades de filas por encima del máximo permitido (10000) antes de iniciar la generación', async () => {
    await expect(
      service.create('p1', 'u1', {
        sqlImportId: 'sql1',
        rowConfig: { clientes: 10001 },
      } as any),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.generation.create).not.toHaveBeenCalled();
  });

  it('marca la generación como FAILED si el proceso en segundo plano falla, sin afectar la respuesta inicial', async () => {
    syntheticDataGenerator.generate.mockImplementation(() => {
      throw new Error('fallo simulado del motor de generación');
    });

    const result = await service.create('p1', 'u1', {
      sqlImportId: 'sql1',
      rowConfig: { clientes: 5000 },
    } as any);

    expect(result.status).toBe('PENDING');

    await flushBackgroundWork();

    const updateCalls = prisma.generation.update.mock.calls.map((c) => c[0]);
    const finalUpdate = updateCalls[updateCalls.length - 1];
    expect(finalUpdate.data.status).toBe('FAILED');
    expect(finalUpdate.data.error).toContain('fallo simulado');
  });
});
