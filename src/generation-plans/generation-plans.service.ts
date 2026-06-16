import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DetectedSchema } from '../sql-imports/types/detected-schema.type';
import {
  PlanLanguage,
  SemanticAnalyzerService,
} from './semantic-analyzer.service';
import { GenerationPlanJson, PlanRule } from './schemas/generation-plan.schema';

@Injectable()
export class GenerationPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly semanticAnalyzer: SemanticAnalyzerService,
  ) {}

  async analyze(
    projectId: string,
    importId: string,
    userId: string,
    language: PlanLanguage = 'es',
  ) {
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

    if (sqlImport.status !== 'VALID') {
      throw new BadRequestException(
        'Solo se puede analizar una importación SQL válida',
      );
    }

    if (!sqlImport.schemaJson) {
      throw new BadRequestException(
        'La importación SQL no tiene esquema detectado',
      );
    }

    const schema = sqlImport.schemaJson as unknown as DetectedSchema;

    const aiPlan = await this.semanticAnalyzer.analyzeSchema(schema, language);
    const sanitizedPlan = this.sanitizePlanForSchema(schema, aiPlan);

    return this.prisma.generationPlan.upsert({
      where: {
        sqlImportId: importId,
      },
      update: {
        planJson: sanitizedPlan as unknown as Prisma.InputJsonValue,
      },
      create: {
        projectId,
        sqlImportId: importId,
        planJson: sanitizedPlan as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async findOne(projectId: string, importId: string, userId: string) {
    await this.ensureProjectBelongsToUser(projectId, userId);

    const plan = await this.prisma.generationPlan.findFirst({
      where: {
        projectId,
        sqlImportId: importId,
      },
    });

    if (!plan) {
      throw new NotFoundException('Plan de generación no encontrado');
    }

    return plan;
  }

  private sanitizePlanForSchema(
    schema: DetectedSchema,
    plan: GenerationPlanJson,
  ): GenerationPlanJson {
    const tableMap = new Map(schema.tables.map((table) => [table.name, table]));
    const warnings = [...plan.warnings];

    const validColumns = plan.columns
      .filter((columnPlan) => {
        const table = tableMap.get(columnPlan.table);

        if (!table) {
          warnings.push(
            `Se descartó una interpretación de columna inválida: ${columnPlan.table}.${columnPlan.column}`,
          );
          return false;
        }

        const exists = table.columns.some(
          (column) => column.name === columnPlan.column,
        );

        if (!exists) {
          warnings.push(
            `Se descartó una interpretación de columna inválida: ${columnPlan.table}.${columnPlan.column}`,
          );
        }

        return exists;
      })
      .map((columnPlan) => {
        const uniqueSamples = Array.from(
          new Set(columnPlan.sampleValues.map((value) => value.trim())),
        ).filter(Boolean);

        let numericMin = columnPlan.numericMin;
        let numericMax = columnPlan.numericMax;

        if (
          numericMin !== null &&
          numericMax !== null &&
          numericMin > numericMax
        ) {
          warnings.push(
            `Se descartó el rango numérico inválido de ${columnPlan.table}.${columnPlan.column}`,
          );

          numericMin = null;
          numericMax = null;
        }

        return {
          ...columnPlan,
          sampleValues: uniqueSamples.slice(0, 15),
          numericMin,
          numericMax,
        };
      });

    const validRules = plan.rules.filter((rule) => {
      const valid = this.isValidRule(rule, tableMap);

      if (!valid) {
        warnings.push(
          `Se descartó una regla inválida propuesta por IA: ${rule.description}`,
        );
      }

      return valid;
    });

    const deduplicatedRules = this.keepBestRulePerTargetColumn(validRules);

    return {
      ...plan,
      columns: validColumns,
      rules: deduplicatedRules,
      warnings,
    };
  }
  private keepBestRulePerTargetColumn(rules: PlanRule[]): PlanRule[] {
    const bestRuleByTarget = new Map<string, PlanRule>();

    for (const rule of rules) {
      const key = `${rule.targetTable}.${rule.targetColumn}`;
      const current = bestRuleByTarget.get(key);

      if (!current) {
        bestRuleByTarget.set(key, rule);
        continue;
      }

      if (rule.confidence > current.confidence) {
        bestRuleByTarget.set(key, rule);
        continue;
      }

      if (
        rule.confidence === current.confidence &&
        this.getRulePriority(rule) > this.getRulePriority(current)
      ) {
        bestRuleByTarget.set(key, rule);
      }
    }

    return Array.from(bestRuleByTarget.values());
  }
  private getRulePriority(rule: PlanRule): number {
    switch (rule.type) {
      case 'BINARY_OPERATION':
        return 5;

      case 'AGGREGATE_CHILDREN':
        return 4;

      case 'COPY_FROM_REFERENCE':
        return 3;

      case 'REFERENCE_DATE_RELATION':
        return 2;

      case 'DATE_RELATION':
        return 2;

      case 'REFERENCE_BOUND':
        return 1;

      default:
        return 0;
    }
  }

  private isValidRule(
    rule: PlanRule,
    tableMap: Map<string, DetectedSchema['tables'][number]>,
  ): boolean {
    const targetTable = tableMap.get(rule.targetTable);

    if (!targetTable) return false;

    const targetColumnExists = targetTable.columns.some(
      (column) => column.name === rule.targetColumn,
    );

    if (!targetColumnExists) return false;

    if (rule.confidence < 0.7) {
      return false;
    }

    switch (rule.type) {
      case 'COPY_FROM_REFERENCE': {
        if (!rule.sourceTable || !rule.sourceColumn || !rule.viaForeignKey) {
          return false;
        }

        if (this.isUnsafeAggregateCopyRule(rule)) {
          return false;
        }

        const sourceTable = tableMap.get(rule.sourceTable);

        if (!sourceTable) return false;

        const sourceColumnExists = sourceTable.columns.some(
          (column) => column.name === rule.sourceColumn,
        );

        const hasDirectFk = targetTable.foreignKeys.some(
          (fk) =>
            fk.column === rule.viaForeignKey &&
            fk.referencesTable === rule.sourceTable,
        );

        return sourceColumnExists && hasDirectFk;
      }

      case 'BINARY_OPERATION': {
        if (!rule.leftColumn || !rule.rightColumn || !rule.operator) {
          return false;
        }

        return (
          targetTable.columns.some(
            (column) => column.name === rule.leftColumn,
          ) &&
          targetTable.columns.some((column) => column.name === rule.rightColumn)
        );
      }

      case 'AGGREGATE_CHILDREN': {
        if (
          !rule.childTable ||
          !rule.childForeignKey ||
          !rule.childColumn ||
          !rule.aggregate
        ) {
          return false;
        }

        const childTable = tableMap.get(rule.childTable);

        if (!childTable) return false;

        const childColumnExists = childTable.columns.some(
          (column) => column.name === rule.childColumn,
        );

        const hasFkToParent = childTable.foreignKeys.some(
          (fk) =>
            fk.column === rule.childForeignKey &&
            fk.referencesTable === rule.targetTable,
        );

        return childColumnExists && hasFkToParent;
      }

      case 'DATE_RELATION': {
        if (!rule.referenceColumn || !rule.dateRelation) {
          return false;
        }

        return targetTable.columns.some(
          (column) => column.name === rule.referenceColumn,
        );
      }
      case 'REFERENCE_BOUND': {
        if (
          !rule.sourceTable ||
          !rule.sourceColumn ||
          !rule.viaForeignKey ||
          !rule.boundOperator
        ) {
          return false;
        }

        const sourceTable = tableMap.get(rule.sourceTable);

        if (!sourceTable) return false;

        const sourceColumnExists = sourceTable.columns.some(
          (column) => column.name === rule.sourceColumn,
        );

        const hasDirectFk = targetTable.foreignKeys.some(
          (fk) =>
            fk.column === rule.viaForeignKey &&
            fk.referencesTable === rule.sourceTable,
        );

        return sourceColumnExists && hasDirectFk;
      }

      case 'REFERENCE_DATE_RELATION': {
        if (
          !rule.sourceTable ||
          !rule.sourceColumn ||
          !rule.viaForeignKey ||
          !rule.dateRelation
        ) {
          return false;
        }

        const sourceTable = tableMap.get(rule.sourceTable);

        if (!sourceTable) return false;

        const sourceColumnExists = sourceTable.columns.some(
          (column) => column.name === rule.sourceColumn,
        );

        const hasDirectFk = targetTable.foreignKeys.some(
          (fk) =>
            fk.column === rule.viaForeignKey &&
            fk.referencesTable === rule.sourceTable,
        );

        return sourceColumnExists && hasDirectFk;
      }

      default:
        return false;
    }
  }

  private isUnsafeAggregateCopyRule(rule: PlanRule): boolean {
    if (rule.type !== 'COPY_FROM_REFERENCE' || !rule.sourceColumn) {
      return false;
    }

    const targetTable = rule.targetTable.toLowerCase();
    const targetColumn = rule.targetColumn.toLowerCase();
    const sourceColumn = rule.sourceColumn.toLowerCase();

    const targetLooksLikeDetail =
      targetTable.includes('detalle') ||
      targetTable.includes('detail') ||
      targetTable.includes('linea') ||
      targetTable.includes('line');

    const sourceLooksAggregated =
      sourceColumn.startsWith('total_') ||
      sourceColumn.includes('monto_total') ||
      sourceColumn.includes('importe_total') ||
      sourceColumn.includes('saldo_total') ||
      sourceColumn.includes('total');

    const targetLooksLikePaymentAmount =
      targetColumn.includes('monto_pagado') ||
      targetColumn.includes('importe_pagado') ||
      targetColumn.includes('total_pago') ||
      targetColumn.includes('amount_paid');

    return (
      targetLooksLikeDetail &&
      sourceLooksAggregated &&
      !targetLooksLikePaymentAmount
    );
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
