import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DetectedSchema } from '../sql-imports/types/detected-schema.type';
import { CreateGenerationDto } from './dto/create-generation.dto';
import {
  ColumnRulesInput,
  GenerationTargetEngine,
  SyntheticDataGeneratorService,
} from './synthetic-data-generator.service';
import { GenerationValidationService } from './generation-validation.service';
import { DeterministicCoherenceService } from './deterministic-coherence.service';
import { enrichSchemaWithImplicitFks } from '../sql-imports/utils/schema-enricher';
import type {
  GenerationPlanJson,
  PlanRule,
} from '../generation-plans/schemas/generation-plan.schema';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class GenerationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syntheticDataGenerator: SyntheticDataGeneratorService,
    private readonly generationValidationService: GenerationValidationService,
    private readonly deterministicCoherence: DeterministicCoherenceService,
  ) { }

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

    const generationRuleSet = createGenerationDto.ruleSetId
      ? await this.prisma.generationRuleSet.findFirst({
        where: {
          id: createGenerationDto.ruleSetId,
          projectId,
          sqlImportId: sqlImport.id,
        },
      })
      : null;

    if (createGenerationDto.ruleSetId && !generationRuleSet) {
      throw new NotFoundException('Configuración de reglas no encontrada');
    }

    const rulesJson =
      createGenerationDto.rules ??
      (generationRuleSet?.rulesJson as Record<string, unknown> | undefined);

    const rowConfig = this.buildRowConfigFromRules(
      schema,
      createGenerationDto.rowConfig,
      rulesJson,
    );

    const generationPlan = await this.prisma.generationPlan.findUnique({
      where: {
        sqlImportId: sqlImport.id,
      },
    });

    const plan = generationPlan?.planJson as unknown as
      | import('../generation-plans/schemas/generation-plan.schema').GenerationPlanJson
      | undefined;

    // El motor (PostgreSQL/MongoDB) es una decisión estructural tomada al
    // analizar el SQL, no algo que se re-elija en cada generación: toda
    // generación hereda el motor de su importación.
    const engine = sqlImport.engine;

    const generation = await this.prisma.generation.create({
      data: {
        projectId,
        sqlImportId: sqlImport.id,
        generationRuleSetId: generationRuleSet?.id,
        rowConfig: rowConfig as unknown as Prisma.InputJsonValue,
        previewJson: {} as unknown as Prisma.InputJsonValue,
        validationJson: null as unknown as Prisma.InputJsonValue,
        status: 'PENDING',
        progress: 0,
        region: createGenerationDto.region ?? 'GENERIC',
        engine,
      },
    });

    // Iniciar generación en segundo plano
    this.runBackgroundGeneration(
      generation.id,
      projectId,
      schema,
      rowConfig,
      plan,
      createGenerationDto.region,
      rulesJson as unknown as ColumnRulesInput | undefined,
      engine,
    );

    return {
      id: generation.id,
      projectId: generation.projectId,
      sqlImportId: generation.sqlImportId,
      generationRuleSetId: generation.generationRuleSetId,
      rowConfig: generation.rowConfig,
      previewJson: generation.previewJson,
      status: generation.status,
      progress: generation.progress,
      region: generation.region,
      engine: generation.engine,
      orderedTables: schema.tables.map((t) => t.name),
      createdAt: generation.createdAt,
      updatedAt: generation.updatedAt,
    };
  }

  private buildRowConfigFromRules(
    schema: DetectedSchema,
    rowConfig?: Record<string, number>,
    rulesJson?: Record<string, unknown>,
  ): Record<string, number> {
    const normalizedConfig: Record<string, number> = {};

    const rules = rulesJson as
      | {
        tables?: Record<
          string,
          {
            rowCount?: number;
          }
        >;
      }
      | undefined;

    for (const table of schema.tables) {
      const rawValue =
        rowConfig?.[table.name] ?? rules?.tables?.[table.name]?.rowCount;

      const value = Number(rawValue);

      if (!Number.isInteger(value) || value < 1) {
        throw new BadRequestException(
          `Debes indicar una cantidad entera mayor a 0 para la tabla "${table.name}"`,
        );
      }

      if (value > 10000) {
        throw new BadRequestException(
          `El máximo permitido es 10000 filas por tabla. Tabla: "${table.name}"`,
        );
      }

      normalizedConfig[table.name] = value;
    }

    return normalizedConfig;
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
        status: true,
        progress: true,
        error: true,
        region: true,
        engine: true,
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

  async getOutputSql(projectId: string, generationId: string, userId: string): Promise<string> {
    const generation = await this.findOne(projectId, generationId, userId);

    if (generation.outputFile && fs.existsSync(generation.outputFile)) {
      return fs.readFileSync(generation.outputFile, 'utf8');
    }

    return generation.outputSql || '';
  }

  /** Datos completos (todas las filas) de una generación, para exportarlos en otros formatos. */
  async getFullData(
    projectId: string,
    generationId: string,
    userId: string,
  ): Promise<{
    orderedTables: string[];
    rowsByTable: Record<string, Record<string, unknown>[]>;
  }> {
    const generation = await this.findOne(projectId, generationId, userId);

    if (generation.status !== 'COMPLETED') {
      throw new BadRequestException(
        'La generación todavía no terminó o falló; no hay datos para exportar',
      );
    }

    if (!generation.outputDataFile || !fs.existsSync(generation.outputDataFile)) {
      throw new NotFoundException(
        'No se encontraron los datos completos de esta generación',
      );
    }

    const raw = fs.readFileSync(generation.outputDataFile, 'utf8');
    return JSON.parse(raw);
  }

  async getStatus(projectId: string, generationId: string, userId: string) {
    await this.ensureProjectBelongsToUser(projectId, userId);

    const generation = await this.prisma.generation.findFirst({
      where: {
        id: generationId,
        projectId,
      },
      select: {
        status: true,
        progress: true,
        error: true,
      },
    });

    if (!generation) {
      throw new NotFoundException('Generación no encontrada');
    }

    return generation;
  }

  private async runBackgroundGeneration(
    generationId: string,
    projectId: string,
    schema: DetectedSchema,
    rowConfig: Record<string, number>,
    plan: any,
    region?: string,
    columnRules?: ColumnRulesInput,
    engine?: GenerationTargetEngine,
  ): Promise<void> {
    setImmediate(async () => {
      try {
        await this.prisma.generation.update({
          where: { id: generationId },
          data: { status: 'PROCESSING', progress: 10 },
        });

        // 0. Fusionar el plan (si existe) con reglas de coherencia DETERMINISTAS
        //    (aritmética, totales, orden de fechas). Garantiza coherencia para
        //    cualquier base, con o sin análisis de IA y con cualquier modelo.
        const effectivePlan = this.mergeWithDeterministicRules(schema, plan);

        // 1. Generación de datos sintéticos. Las reglas manuales por columna
        //    (rulesJson.tables[t].columns) tienen prioridad sobre el plan de IA.
        //    El motor destino (PostgreSQL/MongoDB) solo cambia el formato del
        //    dump final; las filas y sus relaciones se generan igual para ambos.
        const result = this.syntheticDataGenerator.generate(
          schema,
          rowConfig,
          effectivePlan,
          region,
          columnRules,
          engine,
        );

        await this.prisma.generation.update({
          where: { id: generationId },
          data: { progress: 50 },
        });

        // 2. Validación
        const validationReport = this.generationValidationService.validate(
          schema,
          result.rowsByTable,
          plan,
        );

        await this.prisma.generation.update({
          where: { id: generationId },
          data: { progress: 85 },
        });

        // 3. Escribir archivos de salida en disco
        const uploadDir = path.join(process.cwd(), 'uploads', 'generations');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        const extension = engine === 'MONGODB' ? 'js' : 'sql';
        const filePath = path.join(uploadDir, `${generationId}.${extension}`);
        fs.writeFileSync(filePath, result.outputSql, 'utf8');

        // Datos completos (todas las filas, no solo el preview) para poder
        // exportar a CSV/Excel/JSON desde el módulo de exportaciones sin
        // tener que volver a generar ni parsear el .sql.
        const dataFilePath = path.join(uploadDir, `${generationId}.data.json`);
        fs.writeFileSync(
          dataFilePath,
          JSON.stringify({
            orderedTables: result.orderedTables,
            rowsByTable: result.rowsByTable,
          }),
          'utf8',
        );

        // 4. Guardar resultado completado
        await this.prisma.generation.update({
          where: { id: generationId },
          data: {
            status: 'COMPLETED',
            progress: 100,
            previewJson: result.preview as any,
            validationJson: validationReport as any,
            outputFile: filePath,
            outputDataFile: dataFilePath,
            outputSql: '',
          },
        });
      } catch (error) {
        console.error('Error en generación en segundo plano:', error);
        await this.prisma.generation.update({
          where: { id: generationId },
          data: {
            status: 'FAILED',
            progress: 100,
            error: error instanceof Error ? error.message : 'Error desconocido',
          },
        });
      }
    });
  }

  /**
   * Combina el plan de IA (si existe) con las reglas de coherencia deterministas.
   * Deduplica por columna destino, conservando la regla de mayor confianza, de modo
   * que una regla determinista correcta gana a una posible regla floja del modelo.
   */
  private mergeWithDeterministicRules(
    schema: DetectedSchema,
    plan: GenerationPlanJson | null | undefined,
  ): GenerationPlanJson {
    const enriched = enrichSchemaWithImplicitFks(schema);
    const deterministicRules = this.deterministicCoherence.synthesize(enriched);

    const basePlan: GenerationPlanJson = plan ?? {
      domainSummary: '',
      tables: [],
      columns: [],
      rules: [],
      warnings: [],
    };

    const byTarget = new Map<string, PlanRule>();
    for (const rule of [...basePlan.rules, ...deterministicRules]) {
      const key = `${rule.targetTable}.${rule.targetColumn}`;
      const current = byTarget.get(key);
      if (!current || rule.confidence > current.confidence) {
        byTarget.set(key, rule);
      }
    }

    return { ...basePlan, rules: Array.from(byTarget.values()) };
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

      if (value > 10000) {
        throw new BadRequestException(
          `El máximo permitido es 10000 filas por tabla. Tabla: "${table.name}"`,
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
