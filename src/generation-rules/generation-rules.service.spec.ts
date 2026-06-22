import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GenerationRulesService } from './generation-rules.service';
import { PrismaService } from '../prisma/prisma.service';
import { DetectedSchema } from '../sql-imports/types/detected-schema.type';

describe('GenerationRulesService (CP-09 Configurar Reglas)', () => {
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
          {
            name: 'email',
            rawType: 'VARCHAR',
            normalizedType: 'STRING',
            isPrimaryKey: false,
            isNullable: false,
            isUnique: true,
          },
          {
            name: 'estado',
            rawType: 'VARCHAR',
            normalizedType: 'STRING',
            isPrimaryKey: false,
            isNullable: false,
            isUnique: false,
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
  };

  let prisma: {
    project: { findFirst: jest.Mock };
    sqlImport: { findFirst: jest.Mock };
    generationRuleSet: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
    };
  };
  let service: GenerationRulesService;

  beforeEach(() => {
    prisma = {
      project: { findFirst: jest.fn().mockResolvedValue(project) },
      sqlImport: { findFirst: jest.fn().mockResolvedValue(sqlImport) },
      generationRuleSet: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'rs1',
          ...data,
        })),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn(),
      },
    };

    service = new GenerationRulesService(prisma as unknown as PrismaService);
  });

  const baseDto = (rulesJson: Record<string, unknown>) => ({
    sqlImportId: 'sql1',
    name: 'Reglas por defecto',
    rulesJson,
  });

  it('configura tipo de dato, formato y valores permitidos para una columna y guarda la asociación tabla/columna', async () => {
    const dto = baseDto({
      tables: {
        clientes: {
          rowCount: 50,
          columns: {
            email: { type: 'EMAIL', unique: true },
            estado: { type: 'ENUM', values: ['ACTIVO', 'INACTIVO'] },
          },
        },
      },
    });

    const result = await service.create('p1', 'u1', dto as any);

    expect(prisma.generationRuleSet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: 'p1',
          sqlImportId: 'sql1',
          rulesJson: dto.rulesJson,
        }),
      }),
    );
    expect(result.rulesJson).toEqual(dto.rulesJson);
  });

  it('rechaza una tabla que no existe en el esquema detectado', async () => {
    const dto = baseDto({ tables: { tabla_fantasma: { rowCount: 10 } } });

    await expect(service.create('p1', 'u1', dto as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rechaza una columna que no existe en la tabla', async () => {
    const dto = baseDto({
      tables: { clientes: { columns: { columna_fantasma: { type: 'STRING' } } } },
    });

    await expect(service.create('p1', 'u1', dto as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rechaza una longitud/cantidad de filas inválida (no entera o menor a 1)', async () => {
    const dto = baseDto({ tables: { clientes: { rowCount: 0 } } });

    await expect(service.create('p1', 'u1', dto as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rechaza una cantidad de filas por encima del máximo permitido', async () => {
    const dto = baseDto({ tables: { clientes: { rowCount: 1001 } } });

    await expect(service.create('p1', 'u1', dto as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rechaza configurar reglas sobre una importación SQL que no está validada', async () => {
    prisma.sqlImport.findFirst.mockResolvedValue({ ...sqlImport, status: 'INVALID' });
    const dto = baseDto({ tables: { clientes: { rowCount: 10 } } });

    await expect(service.create('p1', 'u1', dto as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rechaza si el proyecto no le pertenece al usuario', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    const dto = baseDto({ tables: { clientes: { rowCount: 10 } } });

    await expect(service.create('p1', 'u1', dto as any)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('al marcar isDefault=true, limpia los demás conjuntos de reglas por defecto de esa importación', async () => {
    const dto = {
      ...baseDto({ tables: { clientes: { rowCount: 10 } } }),
      isDefault: true,
    };

    await service.create('p1', 'u1', dto as any);

    expect(prisma.generationRuleSet.updateMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', sqlImportId: 'sql1', isDefault: true },
      data: { isDefault: false },
    });
  });

  it('queda asociada a la tabla y columna seleccionadas para aplicarse en la generación de datos', async () => {
    const dto = baseDto({
      tables: {
        clientes: {
          rowCount: 25,
          columns: { estado: { type: 'ENUM', values: ['ACTIVO', 'INACTIVO'] } },
        },
      },
    });

    const result = await service.create('p1', 'u1', dto as any);

    const stored = result.rulesJson as any;
    expect(stored.tables.clientes.rowCount).toBe(25);
    expect(stored.tables.clientes.columns.estado.values).toEqual([
      'ACTIVO',
      'INACTIVO',
    ]);
  });
});
