import { NotFoundException } from '@nestjs/common';
import { SqlImportsService } from './sql-imports.service';
import { PrismaService } from '../prisma/prisma.service';
import { SqlSchemaAnalyzerService } from './sql-schema-analyzer.service';

describe('SqlImportsService (motor de generación elegido al analizar el SQL)', () => {
  const project = { id: 'p1', ownerId: 'u1' };

  let prisma: {
    project: { findFirst: jest.Mock };
    sqlImport: { create: jest.Mock };
  };
  let analyzer: { analyze: jest.Mock };
  let service: SqlImportsService;

  beforeEach(() => {
    prisma = {
      project: { findFirst: jest.fn().mockResolvedValue(project) },
      sqlImport: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'sql1',
          ...data,
        })),
      },
    };
    analyzer = {
      analyze: jest.fn().mockReturnValue({
        valid: true,
        schema: { dialect: 'postgresql', tables: [] },
        errors: [],
      }),
    };

    service = new SqlImportsService(
      prisma as unknown as PrismaService,
      analyzer as unknown as SqlSchemaAnalyzerService,
    );
  });

  it('por defecto persiste el motor POSTGRESQL cuando no se especifica', async () => {
    const result = await service.createFromText('p1', 'u1', {
      sql: 'CREATE TABLE clientes (id INT PRIMARY KEY);',
    } as any);

    expect(result.engine).toBe('POSTGRESQL');
    expect(prisma.sqlImport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ engine: 'POSTGRESQL' }),
      }),
    );
  });

  it('persiste MongoDB como motor cuando el usuario lo elige al analizar el SQL', async () => {
    const result = await service.createFromText('p1', 'u1', {
      sql: 'CREATE TABLE clientes (id INT PRIMARY KEY);',
      engine: 'MONGODB',
    } as any);

    expect(result.engine).toBe('MONGODB');
  });

  it('rechaza si el proyecto no le pertenece al usuario', async () => {
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(
      service.createFromText('p1', 'u1', {
        sql: 'CREATE TABLE clientes (id INT PRIMARY KEY);',
      } as any),
    ).rejects.toThrow(NotFoundException);
  });
});
