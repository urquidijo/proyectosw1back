import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SqlImportStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSqlImportDto } from './dto/create-sql-import.dto';
import { SqlSchemaAnalyzerService } from './sql-schema-analyzer.service';

@Injectable()
export class SqlImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sqlSchemaAnalyzer: SqlSchemaAnalyzerService,
  ) {}

  async createFromText(
    projectId: string,
    userId: string,
    createSqlImportDto: CreateSqlImportDto,
  ) {
    await this.ensureProjectBelongsToUser(projectId, userId);

    const analysis = this.sqlSchemaAnalyzer.analyze(createSqlImportDto.sql);

    return this.prisma.sqlImport.create({
      data: {
        projectId,
        originalSql: createSqlImportDto.sql,
        status: analysis.valid
          ? SqlImportStatus.VALID
          : SqlImportStatus.INVALID,
        schemaJson: analysis.schema as unknown as Prisma.InputJsonValue,
        errors: analysis.errors as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async findAllByProject(projectId: string, userId: string) {
    await this.ensureProjectBelongsToUser(projectId, userId);

    return this.prisma.sqlImport.findMany({
      where: {
        projectId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        projectId: true,
        status: true,
        schemaJson: true,
        errors: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(projectId: string, importId: string, userId: string) {
    await this.ensureProjectBelongsToUser(projectId, userId);

    const sqlImport = await this.prisma.sqlImport.findFirst({
      where: {
        id: importId,
        projectId,
      },
    });

    if (!sqlImport) {
      throw new NotFoundException('Importación SQL no encontrada');
    }

    return sqlImport;
  }

  async remove(projectId: string, importId: string, userId: string) {
    await this.ensureProjectBelongsToUser(projectId, userId);

    const sqlImport = await this.prisma.sqlImport.findFirst({
      where: {
        id: importId,
        projectId,
      },
    });

    if (!sqlImport) {
      throw new NotFoundException('Importación SQL no encontrada');
    }

    await this.prisma.sqlImport.delete({
      where: {
        id: importId,
      },
    });

    return {
      message: 'Importación SQL eliminada correctamente',
    };
  }

  private async ensureProjectBelongsToUser(projectId: string, userId: string) {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        ownerId: userId,
      },
    });

    if (!project) {
      throw new NotFoundException('Proyecto no encontrado');
    }

    return project;
  }
}