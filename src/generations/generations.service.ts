import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DetectedSchema } from '../sql-imports/types/detected-schema.type';
import { CreateGenerationDto } from './dto/create-generation.dto';
import { SyntheticDataGeneratorService } from './synthetic-data-generator.service';
import { GenerationValidationService } from './generation-validation.service';

@Injectable()
export class GenerationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syntheticDataGenerator: SyntheticDataGeneratorService,
    private readonly generationValidationService: GenerationValidationService,
  ) {}

  async create(
    projectId: string,
    userId: string,
    createGenerationDto: CreateGenerationDto,
  ) {
    await this.ensureProjectBelongsToUser(projectId, userId);

    const sqlImport = await this.prisma.sqlImport.findFirst({
      where: {
        id: createGenerationDto.sqlImportId,
        projectId,
      },
    });

    if (!sqlImport) {
      throw new NotFoundException('Importación SQL no encontrada');
    }

    if (sqlImport.status !== 'VALID') {
      throw new BadRequestException(
        'Solo se puede generar datos desde una importación SQL válida',
      );
    }

    if (!sqlImport.schemaJson) {
      throw new BadRequestException(
        'La importación SQL no tiene un esquema detectado',
      );
    }

    const schema = sqlImport.schemaJson as unknown as DetectedSchema;
    const rowConfig = this.validateRowConfig(
      schema,
      createGenerationDto.rowConfig,
    );

    const generationPlan = await this.prisma.generationPlan.findUnique({
      where: {
        sqlImportId: sqlImport.id,
      },
    });

    const plan = generationPlan?.planJson as unknown as
      | import('../generation-plans/schemas/generation-plan.schema').GenerationPlanJson
      | undefined;

    const result = this.syntheticDataGenerator.generate(
      schema,
      rowConfig,
      plan,
    );
    const validationReport = this.generationValidationService.validate(
      schema,
      result.rowsByTable,
      plan,
    );

    const generation = await this.prisma.generation.create({
      data: {
        projectId,
        sqlImportId: sqlImport.id,
        rowConfig: rowConfig as unknown as Prisma.InputJsonValue,
        previewJson: result.preview as unknown as Prisma.InputJsonValue,
        validationJson: validationReport as unknown as Prisma.InputJsonValue,
        outputSql: result.outputSql,
      },
    });

    return {
      id: generation.id,
      projectId: generation.projectId,
      sqlImportId: generation.sqlImportId,
      rowConfig: generation.rowConfig,
      previewJson: generation.previewJson,
      validationJson: generation.validationJson,
      orderedTables: result.orderedTables,
      createdAt: generation.createdAt,
      updatedAt: generation.updatedAt,
    };
  }

  async findAllByProject(projectId: string, userId: string) {
    await this.ensureProjectBelongsToUser(projectId, userId);

    return this.prisma.generation.findMany({
      where: {
        projectId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        projectId: true,
        sqlImportId: true,
        rowConfig: true,
        previewJson: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(projectId: string, generationId: string, userId: string) {
    await this.ensureProjectBelongsToUser(projectId, userId);

    const generation = await this.prisma.generation.findFirst({
      where: {
        id: generationId,
        projectId,
      },
    });

    if (!generation) {
      throw new NotFoundException('Generación no encontrada');
    }

    return generation;
  }

  async getOutputSql(projectId: string, generationId: string, userId: string) {
    const generation = await this.findOne(projectId, generationId, userId);

    return generation.outputSql;
  }

  private validateRowConfig(
    schema: DetectedSchema,
    rowConfig: Record<string, number>,
  ): Record<string, number> {
    const normalizedConfig: Record<string, number> = {};

    for (const table of schema.tables) {
      const rawValue = rowConfig[table.name];
      const value = Number(rawValue);

      if (!Number.isInteger(value) || value < 1) {
        throw new BadRequestException(
          `Debes indicar una cantidad entera mayor a 0 para la tabla "${table.name}"`,
        );
      }

      if (value > 1000) {
        throw new BadRequestException(
          `Por ahora el máximo permitido es 1000 filas por tabla. Tabla: "${table.name}"`,
        );
      }

      normalizedConfig[table.name] = value;
    }

    return normalizedConfig;
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
