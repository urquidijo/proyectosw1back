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

@Injectable()
export class GenerationPlanExecutorService {
  applyPlan(
    schema: DetectedSchema,
    rowsByTable: Map<string, GeneratedRow[]>,
    plan?: GenerationPlanJson | null,
  ): void {
    if (!plan || plan.rules.length === 0) return;

    const tableMap = new Map(schema.tables.map((table) => [table.name, table]));
    const orderedRules = this.sortRulesByDependencies(plan.rules);

    const maxIterations = 12;
    let previousSnapshot = this.snapshotRows(rowsByTable);

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      for (const rule of orderedRules) {
        this.applyRule(rule, tableMap, rowsByTable);
      }

      const currentSnapshot = this.snapshotRows(rowsByTable);

      if (currentSnapshot === previousSnapshot) {
        return;
      }

      previousSnapshot = currentSnapshot;
    }
  }

  private snapshotRows(rowsByTable: Map<string, GeneratedRow[]>): string {
    return JSON.stringify(Object.fromEntries(rowsByTable.entries()));
  }

  private applyRule(
    rule: PlanRule,
    tableMap: Map<string, DetectedTable>,
    rowsByTable: Map<string, GeneratedRow[]>,
  ): void {
    switch (rule.type) {
      case 'COPY_FROM_REFERENCE':
        this.applyCopyFromReference(rule, tableMap, rowsByTable);
        break;

      case 'REFERENCE_BOUND':
        this.applyReferenceBound(rule, tableMap, rowsByTable);
        break;

      case 'BINARY_OPERATION':
        this.applyBinaryOperation(rule, rowsByTable);
        break;

      case 'AGGREGATE_CHILDREN':
        this.applyAggregateChildren(rule, tableMap, rowsByTable);
        break;

      case 'DATE_RELATION':
        this.applyDateRelation(rule, rowsByTable);
        break;

      case 'REFERENCE_DATE_RELATION':
        this.applyReferenceDateRelation(rule, tableMap, rowsByTable);
        break;
    }
  }

  private sortRulesByDependencies(rules: PlanRule[]): PlanRule[] {
    const nodes = rules.map((rule, index) => ({
      index,
      rule,
      reads: this.getReadKeys(rule),
      writes: this.getWriteKeys(rule),
    }));

    const adjacency = new Map<number, Set<number>>();
    const indegree = new Map<number, number>();

    for (const node of nodes) {
      adjacency.set(node.index, new Set<number>());
      indegree.set(node.index, 0);
    }

    for (const writer of nodes) {
      for (const reader of nodes) {
        if (writer.index === reader.index) continue;

        const createsDependency = writer.writes.some((writtenKey) =>
          reader.reads.includes(writtenKey),
        );

        if (createsDependency) {
          const edges = adjacency.get(writer.index)!;

          if (!edges.has(reader.index)) {
            edges.add(reader.index);
            indegree.set(reader.index, (indegree.get(reader.index) ?? 0) + 1);
          }
        }
      }
    }

    const queue = nodes
      .filter((node) => (indegree.get(node.index) ?? 0) === 0)
      .sort((a, b) => a.index - b.index);

    const ordered: PlanRule[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      ordered.push(current.rule);

      const edges = adjacency.get(current.index) ?? new Set<number>();

      for (const neighborIndex of edges) {
        const nextIndegree = (indegree.get(neighborIndex) ?? 0) - 1;
        indegree.set(neighborIndex, nextIndegree);

        if (nextIndegree === 0) {
          const neighbor = nodes.find((node) => node.index === neighborIndex);

          if (neighbor) {
            queue.push(neighbor);
            queue.sort((a, b) => a.index - b.index);
          }
        }
      }
    }

    if (ordered.length !== rules.length) {
      return rules;
    }

    return ordered;
  }

  private getReadKeys(rule: PlanRule): string[] {
    switch (rule.type) {
      case 'COPY_FROM_REFERENCE':
      case 'REFERENCE_BOUND':
      case 'REFERENCE_DATE_RELATION':
        return rule.sourceTable && rule.sourceColumn
          ? [`${rule.sourceTable}.${rule.sourceColumn}`]
          : [];

      case 'BINARY_OPERATION':
        return [
          `${rule.targetTable}.${rule.leftColumn}`,
          `${rule.targetTable}.${rule.rightColumn}`,
        ].filter((item) => !item.endsWith('.null'));

      case 'AGGREGATE_CHILDREN':
        return rule.childTable && rule.childColumn
          ? [`${rule.childTable}.${rule.childColumn}`]
          : [];

      case 'DATE_RELATION':
        return rule.referenceColumn
          ? [`${rule.targetTable}.${rule.referenceColumn}`]
          : [];

      default:
        return [];
    }
  }

  private getWriteKeys(rule: PlanRule): string[] {
    return [`${rule.targetTable}.${rule.targetColumn}`];
  }

  private applyCopyFromReference(
    rule: PlanRule,
    tableMap: Map<string, DetectedTable>,
    rowsByTable: Map<string, GeneratedRow[]>,
  ): void {
    if (!rule.sourceTable || !rule.sourceColumn || !rule.viaForeignKey) {
      return;
    }

    const targetRows = rowsByTable.get(rule.targetTable) ?? [];
    const sourceRows = rowsByTable.get(rule.sourceTable) ?? [];
    const targetTable = tableMap.get(rule.targetTable);

    const fk = targetTable?.foreignKeys.find(
      (item) =>
        item.column === rule.viaForeignKey &&
        item.referencesTable === rule.sourceTable,
    );

    if (!fk) return;

    for (const targetRow of targetRows) {
      const fkValue = targetRow[rule.viaForeignKey];

      const sourceRow = sourceRows.find(
        (row) => row[fk.referencesColumn] === fkValue,
      );

      if (!sourceRow) continue;

      targetRow[rule.targetColumn] = sourceRow[rule.sourceColumn] ?? null;
    }
  }

  private applyReferenceBound(
    rule: PlanRule,
    tableMap: Map<string, DetectedTable>,
    rowsByTable: Map<string, GeneratedRow[]>,
  ): void {
    if (
      !rule.sourceTable ||
      !rule.sourceColumn ||
      !rule.viaForeignKey ||
      !rule.boundOperator
    ) {
      return;
    }

    const targetRows = rowsByTable.get(rule.targetTable) ?? [];
    const sourceRows = rowsByTable.get(rule.sourceTable) ?? [];
    const targetTable = tableMap.get(rule.targetTable);

    const fk = targetTable?.foreignKeys.find(
      (item) =>
        item.column === rule.viaForeignKey &&
        item.referencesTable === rule.sourceTable,
    );

    if (!fk) return;

    for (const targetRow of targetRows) {
      const fkValue = targetRow[rule.viaForeignKey];

      const sourceRow = sourceRows.find(
        (row) => row[fk.referencesColumn] === fkValue,
      );

      if (!sourceRow) continue;

      const targetValue = Number(targetRow[rule.targetColumn]);
      const sourceValue = Number(sourceRow[rule.sourceColumn]);

      if (!Number.isFinite(targetValue) || !Number.isFinite(sourceValue)) {
        continue;
      }

      if (rule.boundOperator === 'LTE' && targetValue > sourceValue) {
        targetRow[rule.targetColumn] = Math.max(1, Math.floor(sourceValue));
      }

      if (rule.boundOperator === 'GTE' && targetValue < sourceValue) {
        targetRow[rule.targetColumn] = Math.ceil(sourceValue);
      }
    }
  }

  private applyBinaryOperation(
    rule: PlanRule,
    rowsByTable: Map<string, GeneratedRow[]>,
  ): void {
    if (!rule.leftColumn || !rule.rightColumn || !rule.operator) {
      return;
    }

    const rows = rowsByTable.get(rule.targetTable) ?? [];

    for (const row of rows) {
      const left = Number(row[rule.leftColumn]);
      const right = Number(row[rule.rightColumn]);

      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        continue;
      }

      let result: number;

      switch (rule.operator) {
        case 'ADD':
          result = left + right;
          break;
        case 'SUBTRACT':
          result = left - right;
          break;
        case 'MULTIPLY':
          result = left * right;
          break;
        case 'DIVIDE':
          result = right === 0 ? 0 : left / right;
          break;
      }

      row[rule.targetColumn] = this.roundMoney(result);
    }
  }

  private applyAggregateChildren(
    rule: PlanRule,
    tableMap: Map<string, DetectedTable>,
    rowsByTable: Map<string, GeneratedRow[]>,
  ): void {
    if (
      !rule.childTable ||
      !rule.childForeignKey ||
      !rule.childColumn ||
      !rule.aggregate
    ) {
      return;
    }

    const parentTable = tableMap.get(rule.targetTable);
    const childTable = tableMap.get(rule.childTable);

    if (!parentTable || !childTable) return;

    const fk = childTable.foreignKeys.find(
      (item) =>
        item.column === rule.childForeignKey &&
        item.referencesTable === rule.targetTable,
    );

    if (!fk) return;

    const parentRows = rowsByTable.get(rule.targetTable) ?? [];
    const childRows = rowsByTable.get(rule.childTable) ?? [];

    for (const parentRow of parentRows) {
      const parentId = parentRow[fk.referencesColumn];

      const children = childRows.filter(
        (childRow) => childRow[rule.childForeignKey!] === parentId,
      );

      let result: number;

      switch (rule.aggregate) {
        case 'COUNT':
          result = children.length;
          break;

        case 'AVG': {
          const values = children
            .map((child) => Number(child[rule.childColumn!]))
            .filter((value) => Number.isFinite(value));

          result =
            values.length === 0
              ? 0
              : values.reduce((sum, value) => sum + value, 0) / values.length;
          break;
        }

        case 'SUM':
        default:
          result = children.reduce((sum, child) => {
            const value = Number(child[rule.childColumn!]);
            return Number.isFinite(value) ? sum + value : sum;
          }, 0);
          break;
      }

      parentRow[rule.targetColumn] = this.roundMoney(result);
    }
  }

  private applyDateRelation(
    rule: PlanRule,
    rowsByTable: Map<string, GeneratedRow[]>,
  ): void {
    if (!rule.referenceColumn || !rule.dateRelation) {
      return;
    }

    const rows = rowsByTable.get(rule.targetTable) ?? [];

    for (const row of rows) {
      const referenceValue = row[rule.referenceColumn];

      if (typeof referenceValue !== 'string') continue;

      const referenceDate = new Date(referenceValue);

      if (Number.isNaN(referenceDate.getTime())) continue;

      const currentTargetValue = row[rule.targetColumn];
      const currentTargetDate =
        typeof currentTargetValue === 'string'
          ? new Date(currentTargetValue)
          : null;

      if (
        currentTargetDate &&
        !Number.isNaN(currentTargetDate.getTime()) &&
        this.isDateRelationValid(
          currentTargetDate,
          referenceDate,
          rule.dateRelation,
        )
      ) {
        continue;
      }

      row[rule.targetColumn] = this.createRelatedDate(
        referenceDate,
        rule.dateRelation,
      );
    }
  }

  private applyReferenceDateRelation(
    rule: PlanRule,
    tableMap: Map<string, DetectedTable>,
    rowsByTable: Map<string, GeneratedRow[]>,
  ): void {
    if (
      !rule.sourceTable ||
      !rule.sourceColumn ||
      !rule.viaForeignKey ||
      !rule.dateRelation
    ) {
      return;
    }

    const targetRows = rowsByTable.get(rule.targetTable) ?? [];
    const sourceRows = rowsByTable.get(rule.sourceTable) ?? [];
    const targetTable = tableMap.get(rule.targetTable);

    const fk = targetTable?.foreignKeys.find(
      (item) =>
        item.column === rule.viaForeignKey &&
        item.referencesTable === rule.sourceTable,
    );

    if (!fk) return;

    for (const targetRow of targetRows) {
      const fkValue = targetRow[rule.viaForeignKey];

      const sourceRow = sourceRows.find(
        (row) => row[fk.referencesColumn] === fkValue,
      );

      if (!sourceRow) continue;

      const sourceValue = sourceRow[rule.sourceColumn];

      if (typeof sourceValue !== 'string') continue;

      const sourceDate = new Date(sourceValue);

      if (Number.isNaN(sourceDate.getTime())) continue;

      const currentTargetValue = targetRow[rule.targetColumn];
      const currentTargetDate =
        typeof currentTargetValue === 'string'
          ? new Date(currentTargetValue)
          : null;

      if (
        currentTargetDate &&
        !Number.isNaN(currentTargetDate.getTime()) &&
        this.isDateRelationValid(
          currentTargetDate,
          sourceDate,
          rule.dateRelation,
        )
      ) {
        continue;
      }

      targetRow[rule.targetColumn] = this.createRelatedDate(
        sourceDate,
        rule.dateRelation,
      );
    }
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
  private createRelatedDate(
    referenceDate: Date,
    relation: 'AFTER' | 'BEFORE' | 'ON_OR_AFTER' | 'ON_OR_BEFORE',
  ): string {
    const days = this.randomInteger(1, 30);
    const targetDate = new Date(referenceDate);

    switch (relation) {
      case 'AFTER':
        targetDate.setDate(targetDate.getDate() + days);
        break;

      case 'ON_OR_AFTER':
        targetDate.setDate(targetDate.getDate() + this.randomInteger(0, 30));
        break;

      case 'BEFORE':
        targetDate.setDate(targetDate.getDate() - days);
        break;

      case 'ON_OR_BEFORE':
        targetDate.setDate(targetDate.getDate() - this.randomInteger(0, 30));
        break;
    }

    return targetDate.toISOString().slice(0, 10);
  }

  private randomInteger(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private roundMoney(value: number): number {
    return Number(value.toFixed(2));
  }
}
