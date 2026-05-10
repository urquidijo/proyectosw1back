import { Injectable } from '@nestjs/common';
import {
  DetectedSchema,
  DetectedTable,
} from '../sql-imports/types/detected-schema.type';
import {
  GenerationPlanJson,
  PlanRule,
} from '../generation-plans/schemas/generation-plan.schema';

type GeneratedValue = string | number | boolean | null;
type GeneratedRow = Record<string, GeneratedValue>;

export type RuleValidationResult = {
  ruleType: PlanRule['type'];
  description: string;
  target: string;
  passed: boolean;
  checkedRows: number;
  failedRows: number;
  message: string;
};

export type GenerationValidationReport = {
  valid: boolean;
  totalRules: number;
  passedRules: number;
  failedRules: number;
  results: RuleValidationResult[];
};

@Injectable()
export class GenerationValidationService {
  validate(
    schema: DetectedSchema,
    rowsByTable: Record<string, GeneratedRow[]>,
    plan?: GenerationPlanJson | null,
  ): GenerationValidationReport {
    if (!plan || plan.rules.length === 0) {
      return {
        valid: true,
        totalRules: 0,
        passedRules: 0,
        failedRules: 0,
        results: [],
      };
    }

    const tableMap = new Map(schema.tables.map((table) => [table.name, table]));
    const results = plan.rules.map((rule) =>
      this.validateRule(rule, tableMap, rowsByTable),
    );

    const passedRules = results.filter((result) => result.passed).length;
    const failedRules = results.length - passedRules;

    return {
      valid: failedRules === 0,
      totalRules: results.length,
      passedRules,
      failedRules,
      results,
    };
  }

  private validateRule(
    rule: PlanRule,
    tableMap: Map<string, DetectedTable>,
    rowsByTable: Record<string, GeneratedRow[]>,
  ): RuleValidationResult {
    switch (rule.type) {
      case 'COPY_FROM_REFERENCE':
        return this.validateCopyFromReference(rule, tableMap, rowsByTable);

      case 'BINARY_OPERATION':
        return this.validateBinaryOperation(rule, rowsByTable);

      case 'AGGREGATE_CHILDREN':
        return this.validateAggregateChildren(rule, tableMap, rowsByTable);

      case 'DATE_RELATION':
        return this.validateDateRelation(rule, rowsByTable);

      case 'REFERENCE_DATE_RELATION':
        return this.validateReferenceDateRelation(rule, tableMap, rowsByTable);

      case 'REFERENCE_BOUND':
        return this.validateReferenceBound(rule, tableMap, rowsByTable);
    }
  }

  private validateCopyFromReference(
    rule: PlanRule,
    tableMap: Map<string, DetectedTable>,
    rowsByTable: Record<string, GeneratedRow[]>,
  ): RuleValidationResult {
    const targetRows = rowsByTable[rule.targetTable] ?? [];
    const sourceRows = rowsByTable[rule.sourceTable ?? ''] ?? [];
    const targetTable = tableMap.get(rule.targetTable);

    const fk = targetTable?.foreignKeys.find(
      (item) =>
        item.column === rule.viaForeignKey &&
        item.referencesTable === rule.sourceTable,
    );

    let failedRows = 0;

    if (fk && rule.sourceColumn && rule.viaForeignKey) {
      for (const targetRow of targetRows) {
        const sourceRow = sourceRows.find(
          (row) =>
            row[fk.referencesColumn] === targetRow[rule.viaForeignKey!],
        );

        const expected = sourceRow?.[rule.sourceColumn] ?? null;
        const actual = targetRow[rule.targetColumn];

        if (actual !== expected) {
          failedRows++;
        }
      }
    }

    return this.buildResult(rule, targetRows.length, failedRows);
  }

  private validateBinaryOperation(
    rule: PlanRule,
    rowsByTable: Record<string, GeneratedRow[]>,
  ): RuleValidationResult {
    const rows = rowsByTable[rule.targetTable] ?? [];
    let failedRows = 0;

    for (const row of rows) {
      if (!rule.leftColumn || !rule.rightColumn || !rule.operator) continue;

      const left = Number(row[rule.leftColumn]);
      const right = Number(row[rule.rightColumn]);
      const actual = Number(row[rule.targetColumn]);

      if (
        !Number.isFinite(left) ||
        !Number.isFinite(right) ||
        !Number.isFinite(actual)
      ) {
        failedRows++;
        continue;
      }

      let expected: number;

      switch (rule.operator) {
        case 'ADD':
          expected = left + right;
          break;
        case 'SUBTRACT':
          expected = left - right;
          break;
        case 'MULTIPLY':
          expected = left * right;
          break;
        case 'DIVIDE':
          expected = right === 0 ? 0 : left / right;
          break;
      }

      if (!this.numbersEqual(actual, expected)) {
        failedRows++;
      }
    }

    return this.buildResult(rule, rows.length, failedRows);
  }

  private validateAggregateChildren(
    rule: PlanRule,
    tableMap: Map<string, DetectedTable>,
    rowsByTable: Record<string, GeneratedRow[]>,
  ): RuleValidationResult {
    const parentRows = rowsByTable[rule.targetTable] ?? [];
    const childRows = rowsByTable[rule.childTable ?? ''] ?? [];
    const childTable = tableMap.get(rule.childTable ?? '');

    const fk = childTable?.foreignKeys.find(
      (item) =>
        item.column === rule.childForeignKey &&
        item.referencesTable === rule.targetTable,
    );

    let failedRows = 0;

    if (fk && rule.childColumn && rule.childForeignKey && rule.aggregate) {
      for (const parentRow of parentRows) {
        const parentId = parentRow[fk.referencesColumn];

        const children = childRows.filter(
          (childRow) => childRow[rule.childForeignKey!] === parentId,
        );

        let expected: number;

        switch (rule.aggregate) {
          case 'COUNT':
            expected = children.length;
            break;

          case 'AVG': {
            const values = children
              .map((child) => Number(child[rule.childColumn!]))
              .filter((value) => Number.isFinite(value));

            expected =
              values.length === 0
                ? 0
                : values.reduce((sum, value) => sum + value, 0) /
                  values.length;
            break;
          }

          case 'SUM':
          default:
            expected = children.reduce((sum, child) => {
              const value = Number(child[rule.childColumn!]);
              return Number.isFinite(value) ? sum + value : sum;
            }, 0);
            break;
        }

        const actual = Number(parentRow[rule.targetColumn]);

        if (!Number.isFinite(actual) || !this.numbersEqual(actual, expected)) {
          failedRows++;
        }
      }
    }

    return this.buildResult(rule, parentRows.length, failedRows);
  }

  private validateDateRelation(
    rule: PlanRule,
    rowsByTable: Record<string, GeneratedRow[]>,
  ): RuleValidationResult {
    const rows = rowsByTable[rule.targetTable] ?? [];
    let failedRows = 0;

    for (const row of rows) {
      if (!rule.referenceColumn || !rule.dateRelation) continue;

      const target = this.toDate(row[rule.targetColumn]);
      const reference = this.toDate(row[rule.referenceColumn]);

      if (!target || !reference) {
        failedRows++;
        continue;
      }

      if (!this.isDateRelationValid(target, reference, rule.dateRelation)) {
        failedRows++;
      }
    }

    return this.buildResult(rule, rows.length, failedRows);
  }

  private validateReferenceDateRelation(
    rule: PlanRule,
    tableMap: Map<string, DetectedTable>,
    rowsByTable: Record<string, GeneratedRow[]>,
  ): RuleValidationResult {
    const targetRows = rowsByTable[rule.targetTable] ?? [];
    const sourceRows = rowsByTable[rule.sourceTable ?? ''] ?? [];
    const targetTable = tableMap.get(rule.targetTable);

    const fk = targetTable?.foreignKeys.find(
      (item) =>
        item.column === rule.viaForeignKey &&
        item.referencesTable === rule.sourceTable,
    );

    let failedRows = 0;

    if (fk && rule.sourceColumn && rule.viaForeignKey && rule.dateRelation) {
      for (const targetRow of targetRows) {
        const sourceRow = sourceRows.find(
          (row) =>
            row[fk.referencesColumn] === targetRow[rule.viaForeignKey!],
        );

        const target = this.toDate(targetRow[rule.targetColumn]);
        const reference = this.toDate(sourceRow?.[rule.sourceColumn] ?? null);

        if (!target || !reference) {
          failedRows++;
          continue;
        }

        if (!this.isDateRelationValid(target, reference, rule.dateRelation)) {
          failedRows++;
        }
      }
    }

    return this.buildResult(rule, targetRows.length, failedRows);
  }

  private validateReferenceBound(
    rule: PlanRule,
    tableMap: Map<string, DetectedTable>,
    rowsByTable: Record<string, GeneratedRow[]>,
  ): RuleValidationResult {
    const targetRows = rowsByTable[rule.targetTable] ?? [];
    const sourceRows = rowsByTable[rule.sourceTable ?? ''] ?? [];
    const targetTable = tableMap.get(rule.targetTable);

    const fk = targetTable?.foreignKeys.find(
      (item) =>
        item.column === rule.viaForeignKey &&
        item.referencesTable === rule.sourceTable,
    );

    let failedRows = 0;

    if (fk && rule.sourceColumn && rule.viaForeignKey && rule.boundOperator) {
      for (const targetRow of targetRows) {
        const sourceRow = sourceRows.find(
          (row) =>
            row[fk.referencesColumn] === targetRow[rule.viaForeignKey!],
        );

        const targetValue = Number(targetRow[rule.targetColumn]);
        const sourceValue = Number(sourceRow?.[rule.sourceColumn]);

        if (!Number.isFinite(targetValue) || !Number.isFinite(sourceValue)) {
          failedRows++;
          continue;
        }

        const valid =
          rule.boundOperator === 'LTE'
            ? targetValue <= sourceValue
            : targetValue >= sourceValue;

        if (!valid) {
          failedRows++;
        }
      }
    }

    return this.buildResult(rule, targetRows.length, failedRows);
  }

  private buildResult(
    rule: PlanRule,
    checkedRows: number,
    failedRows: number,
  ): RuleValidationResult {
    return {
      ruleType: rule.type,
      description: rule.description,
      target: `${rule.targetTable}.${rule.targetColumn}`,
      passed: failedRows === 0,
      checkedRows,
      failedRows,
      message:
        failedRows === 0
          ? 'Regla cumplida correctamente'
          : `La regla falló en ${failedRows} fila(s)`,
    };
  }

  private numbersEqual(a: number, b: number): boolean {
    return Math.abs(a - b) < 0.01;
  }

  private toDate(value: GeneratedValue): Date | null {
    if (typeof value !== 'string') return null;

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  private isDateRelationValid(
    target: Date,
    reference: Date,
    relation: 'AFTER' | 'BEFORE' | 'ON_OR_AFTER' | 'ON_OR_BEFORE',
  ): boolean {
    switch (relation) {
      case 'AFTER':
        return target > reference;

      case 'BEFORE':
        return target < reference;

      case 'ON_OR_AFTER':
        return target >= reference;

      case 'ON_OR_BEFORE':
        return target <= reference;
    }
  }
}