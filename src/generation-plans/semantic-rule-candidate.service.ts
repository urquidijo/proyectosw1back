import { Injectable } from '@nestjs/common';
import {
  DetectedColumn,
  DetectedSchema,
  DetectedTable,
} from '../sql-imports/types/detected-schema.type';
import { SemanticRuleCandidate } from './types/semantic-rule-candidate.type';

@Injectable()
export class SemanticRuleCandidateService {
  generate(schema: DetectedSchema): SemanticRuleCandidate[] {
    const candidates: SemanticRuleCandidate[] = [];

    for (const targetTable of schema.tables) {
      for (const foreignKey of targetTable.foreignKeys) {
        const sourceTable = schema.tables.find(
          (table) => table.name === foreignKey.referencesTable,
        );

        if (!sourceTable) continue;

        candidates.push(
          ...this.generateCopyCandidates(
            targetTable,
            sourceTable,
            foreignKey.column,
          ),
        );

        candidates.push(
          ...this.generateReferenceDateCandidates(
            targetTable,
            sourceTable,
            foreignKey.column,
          ),
        );

        candidates.push(
          ...this.generateReferenceBoundCandidates(
            targetTable,
            sourceTable,
            foreignKey.column,
          ),
        );
      }
    }

    return this.removeDuplicates(candidates)
      .sort((a, b) => b.heuristicScore - a.heuristicScore)
      .slice(0, 30);
  }
  private isUnsafeAggregateCopyCandidate(
    targetTableName: string,
    targetColumnName: string,
    sourceColumnName: string,
  ): boolean {
    const table = targetTableName.toLowerCase();
    const target = targetColumnName.toLowerCase();
    const source = sourceColumnName.toLowerCase();

    const targetLooksLikeDetail =
      table.includes('detalle') ||
      table.includes('detail') ||
      table.includes('linea') ||
      table.includes('line');

    const sourceLooksAggregated =
      source.startsWith('total_') ||
      source.includes('monto_total') ||
      source.includes('importe_total') ||
      source.includes('saldo_total') ||
      source.includes('total');

    const targetLooksLikePaymentAmount =
      target.includes('monto_pagado') ||
      target.includes('importe_pagado') ||
      target.includes('total_pago') ||
      target.includes('amount_paid');

    if (
      targetLooksLikeDetail &&
      sourceLooksAggregated &&
      !targetLooksLikePaymentAmount
    ) {
      return true;
    }

    return false;
  }

  private generateCopyCandidates(
    targetTable: DetectedTable,
    sourceTable: DetectedTable,
    viaForeignKey: string,
  ): SemanticRuleCandidate[] {
    const candidates: SemanticRuleCandidate[] = [];

    for (const targetColumn of targetTable.columns) {
      if (targetColumn.isPrimaryKey || targetColumn.references) continue;

      for (const sourceColumn of sourceTable.columns) {
        if (
          this.isUnsafeAggregateCopyCandidate(
            targetTable.name,
            targetColumn.name,
            sourceColumn.name,
          )
        ) {
          continue;
        }
        if (sourceColumn.isPrimaryKey) continue;
        if (!this.areColumnsTypeCompatible(targetColumn, sourceColumn)) {
          continue;
        }

        const directSimilarity = this.calculateNameSimilarity(
          targetColumn.name,
          sourceColumn.name,
        );

        if (directSimilarity >= 0.75) {
          candidates.push({
            type: 'COPY_FROM_REFERENCE',
            targetTable: targetTable.name,
            targetColumn: targetColumn.name,
            sourceTable: sourceTable.name,
            sourceColumn: sourceColumn.name,
            viaForeignKey,
            dateRelation: null,
            boundOperator: null,
            heuristicScore: directSimilarity,
            reason: `Las columnas "${targetColumn.name}" y "${sourceColumn.name}" tienen nombres muy similares y están conectadas por una FK directa.`,
          });
        }

        if (this.isAppliedValuePattern(targetColumn.name, sourceColumn.name)) {
          candidates.push({
            type: 'COPY_FROM_REFERENCE',
            targetTable: targetTable.name,
            targetColumn: targetColumn.name,
            sourceTable: sourceTable.name,
            sourceColumn: sourceColumn.name,
            viaForeignKey,
            dateRelation: null,
            boundOperator: null,
            heuristicScore: 0.95,
            reason: `La columna hija "${targetColumn.name}" parece una copia aplicada o histórica de "${sourceColumn.name}" en la tabla referenciada.`,
          });
        }

        if (
          this.isPaymentAmountPattern(
            targetTable.name,
            targetColumn.name,
            sourceColumn.name,
          )
        ) {
          candidates.push({
            type: 'COPY_FROM_REFERENCE',
            targetTable: targetTable.name,
            targetColumn: targetColumn.name,
            sourceTable: sourceTable.name,
            sourceColumn: sourceColumn.name,
            viaForeignKey,
            dateRelation: null,
            boundOperator: null,
            heuristicScore: 0.84,
            reason: `La tabla hija parece registrar pagos y "${targetColumn.name}" podría tomar el importe principal "${sourceColumn.name}" de la cabecera referenciada.`,
          });
        }
      }
    }

    return candidates;
  }

  private generateReferenceDateCandidates(
    targetTable: DetectedTable,
    sourceTable: DetectedTable,
    viaForeignKey: string,
  ): SemanticRuleCandidate[] {
    const candidates: SemanticRuleCandidate[] = [];

    const targetDateColumns = targetTable.columns.filter((column) =>
      this.isDateColumn(column),
    );

    const sourceDateColumns = sourceTable.columns.filter((column) =>
      this.isDateColumn(column),
    );

    for (const targetColumn of targetDateColumns) {
      for (const sourceColumn of sourceDateColumns) {
        const score = this.scoreReferenceDateCandidate(
          targetTable.name,
          targetColumn.name,
          sourceColumn.name,
        );

        if (score === null) continue;

        candidates.push({
          type: 'REFERENCE_DATE_RELATION',
          targetTable: targetTable.name,
          targetColumn: targetColumn.name,
          sourceTable: sourceTable.name,
          sourceColumn: sourceColumn.name,
          viaForeignKey,
          dateRelation: 'ON_OR_AFTER',
          boundOperator: null,
          heuristicScore: score,
          reason: `La fecha hija "${targetColumn.name}" parece ocurrir después de "${sourceColumn.name}" de la tabla referenciada.`,
        });
      }
    }

    return candidates;
  }

  private generateReferenceBoundCandidates(
    targetTable: DetectedTable,
    sourceTable: DetectedTable,
    viaForeignKey: string,
  ): SemanticRuleCandidate[] {
    const candidates: SemanticRuleCandidate[] = [];

    for (const targetColumn of targetTable.columns) {
      if (!this.isQuantityLikeColumn(targetColumn)) continue;

      for (const sourceColumn of sourceTable.columns) {
        if (!this.isQuantityLikeColumn(sourceColumn)) continue;

        if (this.isLikelyUpperBoundPair(targetColumn.name, sourceColumn.name)) {
          candidates.push({
            type: 'REFERENCE_BOUND',
            targetTable: targetTable.name,
            targetColumn: targetColumn.name,
            sourceTable: sourceTable.name,
            sourceColumn: sourceColumn.name,
            viaForeignKey,
            dateRelation: null,
            boundOperator: 'LTE',
            heuristicScore: 0.88,
            reason: `La columna "${targetColumn.name}" parece una cantidad consumida y "${sourceColumn.name}" un máximo o límite disponible.`,
          });
        }
      }
    }

    return candidates;
  }

  private calculateNameSimilarity(a: string, b: string): number {
    const normalizedA = this.normalizeBusinessName(a);
    const normalizedB = this.normalizeBusinessName(b);

    if (normalizedA === normalizedB) return 1;

    if (
      normalizedA.includes(normalizedB) ||
      normalizedB.includes(normalizedA)
    ) {
      return 0.82;
    }

    const tokensA = new Set(normalizedA.split('_').filter(Boolean));
    const tokensB = new Set(normalizedB.split('_').filter(Boolean));

    const intersection = [...tokensA].filter((token) => tokensB.has(token));
    const union = new Set([...tokensA, ...tokensB]);

    if (union.size === 0) return 0;

    return intersection.length / union.size;
  }

  private normalizeBusinessName(value: string): string {
    return value
      .toLowerCase()
      .replace(/^(id_|fk_)/, '')
      .replace(/_(id|fk)$/, '')
      .replace(
        /_(aplicada|aplicado|registrada|registrado|actual|unitaria|unitario)$/g,
        '',
      )
      .replace(/__+/g, '_')
      .trim();
  }

  private isAppliedValuePattern(
    targetColumnName: string,
    sourceColumnName: string,
  ): boolean {
    const target = targetColumnName.toLowerCase();
    const source = sourceColumnName.toLowerCase();

    const appliedSuffixes = [
      '_aplicada',
      '_aplicado',
      '_registrada',
      '_registrado',
      '_actual',
      '_unitaria',
      '_unitario',
    ];

    return appliedSuffixes.some(
      (suffix) =>
        target.endsWith(suffix) &&
        this.normalizeBusinessName(target) ===
          this.normalizeBusinessName(source),
    );
  }

  private isPaymentAmountPattern(
    targetTableName: string,
    targetColumnName: string,
    sourceColumnName: string,
  ): boolean {
    const table = targetTableName.toLowerCase();
    const target = targetColumnName.toLowerCase();
    const source = sourceColumnName.toLowerCase();

    const childLooksLikePayment =
      table.includes('pago') || table.includes('payment');

    const targetLooksLikePaidAmount =
      target.includes('monto_pagado') ||
      target.includes('importe_pagado') ||
      target.includes('total_pago') ||
      target.includes('amount_paid');

    const sourceLooksLikeMainTotal =
      source.includes('total_neto') ||
      source === 'total' ||
      source.includes('importe_total') ||
      source.includes('monto_total');

    return (
      childLooksLikePayment &&
      targetLooksLikePaidAmount &&
      sourceLooksLikeMainTotal
    );
  }

  private scoreReferenceDateCandidate(
    targetTableName: string,
    targetColumnName: string,
    sourceColumnName: string,
  ): number | null {
    const table = targetTableName.toLowerCase();
    const target = targetColumnName.toLowerCase();
    const source = sourceColumnName.toLowerCase();

    const childLooksLikePayment =
      table.includes('pago') || table.includes('payment');

    if (childLooksLikePayment && target.includes('pago')) {
      if (
        source.includes('cierre') ||
        source.includes('vencimiento') ||
        source.includes('due')
      ) {
        return 0.96;
      }

      if (
        source.includes('inicio') ||
        source.includes('emision') ||
        source.includes('desembolso') ||
        source.includes('start')
      ) {
        return 0.82;
      }
    }

    const targetLooksLikeDelivery =
      target.includes('entrega') || target.includes('delivery');

    if (
      targetLooksLikeDelivery &&
      (source.includes('pedido') ||
        source.includes('emision') ||
        source.includes('creacion'))
    ) {
      return 0.9;
    }

    return null;
  }

  private isLikelyUpperBoundPair(
    targetColumnName: string,
    sourceColumnName: string,
  ): boolean {
    const target = targetColumnName.toLowerCase();
    const source = sourceColumnName.toLowerCase();

    const targetLooksConsumed =
      target.includes('cantidad') ||
      target.includes('horas_trabajadas') ||
      target.includes('usado') ||
      target.includes('consumido');

    const sourceLooksLimit =
      source.includes('stock') ||
      source.includes('maximo') ||
      source.includes('máximo') ||
      source.includes('limite') ||
      source.includes('límite') ||
      source.includes('cupo') ||
      source.includes('horas_maximas');

    return targetLooksConsumed && sourceLooksLimit;
  }

  private areColumnsTypeCompatible(
    target: DetectedColumn,
    source: DetectedColumn,
  ): boolean {
    const numericTypes = new Set(['INTEGER', 'DECIMAL', 'SERIAL']);
    const textTypes = new Set([
      'STRING',
      'TEXT',
      'NAME',
      'EMAIL',
      'PHONE',
      'CITY',
    ]);

    if (
      numericTypes.has(target.normalizedType) &&
      numericTypes.has(source.normalizedType)
    ) {
      return true;
    }

    if (
      textTypes.has(target.normalizedType) &&
      textTypes.has(source.normalizedType)
    ) {
      return true;
    }

    return target.normalizedType === source.normalizedType;
  }

  private isDateColumn(column: DetectedColumn): boolean {
    return (
      column.normalizedType === 'DATE' || column.normalizedType === 'DATETIME'
    );
  }

  private isQuantityLikeColumn(column: DetectedColumn): boolean {
    const name = column.name.toLowerCase();

    return (
      column.normalizedType === 'INTEGER' &&
      (name.includes('cantidad') ||
        name.includes('stock') ||
        name.includes('hora') ||
        name.includes('maximo') ||
        name.includes('limite') ||
        name.includes('cupo'))
    );
  }

  private removeDuplicates(
    candidates: SemanticRuleCandidate[],
  ): SemanticRuleCandidate[] {
    const seen = new Set<string>();

    return candidates.filter((candidate) => {
      const key = [
        candidate.type,
        candidate.targetTable,
        candidate.targetColumn,
        candidate.sourceTable,
        candidate.sourceColumn,
        candidate.viaForeignKey,
        candidate.dateRelation,
        candidate.boundOperator,
      ].join('|');

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }
}
