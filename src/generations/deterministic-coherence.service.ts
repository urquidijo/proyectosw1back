import { Injectable } from '@nestjs/common';
import {
  DetectedColumn,
  DetectedSchema,
  DetectedTable,
} from '../sql-imports/types/detected-schema.type';
import { PlanRule } from '../generation-plans/schemas/generation-plan.schema';

/**
 * Sintetizador de reglas de coherencia DETERMINISTAS.
 *
 * El motor ya sabe APLICAR reglas (ejecutor de plan), pero la detección
 * heurística solo cubría COPY/REFERENCE_DATE/REFERENCE_BOUND; la aritmética,
 * los totales agregados y el orden de fechas dependían 100% de la IA y se
 * perdían con modelos económicos.
 *
 * Este servicio detecta esos patrones UNIVERSALES por estructura + nombre y
 * emite reglas formales con alta confianza. Funciona para cualquier base,
 * sin depender del proveedor de IA ni del idioma de las descripciones.
 */
@Injectable()
export class DeterministicCoherenceService {
  private readonly QTY_NAMES = [
    'cantidad', 'cant', 'qty', 'unidades', 'quantity', 'num_unidades',
    'nro_unidades', 'dias', 'noches', 'horas', 'meses', 'semanas',
    'num_dias', 'nro_dias',
  ];
  private readonly UNIT_PRICE_NAMES = [
    'precio_unitario', 'precio_unit', 'preciounitario', 'costo_unitario',
    'valor_unitario', 'precio', 'price', 'costo', 'tarifa', 'tarifa_hora',
    'precio_dia', 'precio_noche', 'precio_hora', 'tarifa_dia', 'tarifa_diaria',
    'precio_mes',
  ];
  private readonly LINE_TOTAL_NAMES = [
    'subtotal', 'sub_total', 'importe_linea', 'total_linea', 'total_detalle',
    'monto_linea', 'importe',
  ];
  private readonly GRAND_TOTAL_NAMES = [
    'total', 'monto_total', 'importe_total', 'total_general', 'total_pedido',
    'total_factura', 'total_venta',
  ];
  // Solo nombres de LÍNEA (no 'monto'/'importe' a secas, que suelen ser pagos).
  private readonly CHILD_SUM_NAMES = [
    'subtotal', 'sub_total', 'importe_linea', 'total_linea', 'monto_linea',
  ];
  private readonly DATE_PAIRS: { start: string[]; end: string[] }[] = [
    {
      start: ['fecha_inicio', 'fecha_desde', 'inicio', 'desde', 'start_date', 'fecha_emision'],
      end: ['fecha_fin', 'fecha_hasta', 'fin', 'hasta', 'end_date', 'fecha_vencimiento'],
    },
    {
      start: ['fecha_nacimiento', 'nacimiento', 'fecha_nac', 'birth_date'],
      end: ['fecha_contratacion', 'contratacion', 'fecha_ingreso', 'ingreso', 'hire_date', 'fecha_alta'],
    },
  ];
  private readonly PARENT_DATE_NAMES = [
    'fecha', 'fecha_pedido', 'fecha_emision', 'fecha_creacion', 'fecha_registro',
    'fecha_orden', 'created_at', 'fecha_compra', 'fecha_venta', 'fecha_inicio',
    'fecha_alta', 'fecha_apertura', 'fecha_contrato', 'fecha_reserva',
  ];
  private readonly CHILD_FOLLOWING_DATE_NAMES = [
    'fecha_pago', 'fecha_entrega', 'fecha_envio', 'fecha', 'fecha_transaccion',
    'fecha_movimiento', 'fecha_cobro',
  ];

  /** Sintetiza todas las reglas deterministas detectables en el esquema. */
  synthesize(schema: DetectedSchema): PlanRule[] {
    const rules: PlanRule[] = [];

    for (const table of schema.tables) {
      rules.push(...this.detectLineTotal(table));
      rules.push(...this.detectSameRowDateOrder(table));
    }

    rules.push(...this.detectCopyFromReference(schema));
    rules.push(...this.detectAggregateTotals(schema));
    rules.push(...this.detectChildAfterParentDate(schema));

    return rules;
  }

  /**
   * child.col = parent.col cuando comparten EXACTAMENTE el mismo nombre y hay una
   * FK directa (ej. alquileres.precio_dia = vehiculos.precio_dia). Hereda tarifas,
   * salarios base, etc., en vez de inventarlos.
   */
  private detectCopyFromReference(schema: DetectedSchema): PlanRule[] {
    const rules: PlanRule[] = [];
    const tableMap = new Map(schema.tables.map((t) => [t.name, t]));

    for (const child of schema.tables) {
      for (const fk of child.foreignKeys) {
        const parent = tableMap.get(fk.referencesTable);
        if (!parent || parent.name === child.name) continue;

        for (const col of child.columns) {
          if (col.isPrimaryKey || col.references) continue;

          const parentCol = parent.columns.find(
            (pc) =>
              pc.name.toLowerCase() === col.name.toLowerCase() &&
              !pc.isPrimaryKey,
          );
          if (!parentCol) continue;
          if (!this.areTypesCompatible(col, parentCol)) continue;

          rules.push(
            this.rule({
              type: 'COPY_FROM_REFERENCE',
              targetTable: child.name,
              targetColumn: col.name,
              sourceTable: parent.name,
              sourceColumn: parentCol.name,
              viaForeignKey: fk.column,
              confidence: 0.9,
              description: `${child.name}.${col.name} = ${parent.name}.${parentCol.name} (vía ${fk.column})`,
            }),
          );
        }
      }
    }

    return rules;
  }

  // ---- Detectores -------------------------------------------------------

  /** subtotal = cantidad × precio_unitario (BINARY_OPERATION, MULTIPLY). */
  private detectLineTotal(table: DetectedTable): PlanRule[] {
    const target = this.findColumn(table, this.LINE_TOTAL_NAMES, this.isNumeric);
    const qty = this.findColumn(table, this.QTY_NAMES, this.isNumeric);
    const price = this.findColumn(table, this.UNIT_PRICE_NAMES, this.isNumeric);

    if (!target || !qty || !price) return [];
    if (target === qty || target === price || qty === price) return [];

    return [
      this.rule({
        type: 'BINARY_OPERATION',
        targetTable: table.name,
        targetColumn: target,
        leftColumn: qty,
        rightColumn: price,
        operator: 'MULTIPLY',
        confidence: 0.95,
        description: `${table.name}.${target} = ${qty} × ${price}`,
      }),
    ];
  }

  /** parent.total = SUM(child.subtotal) (AGGREGATE_CHILDREN, SUM). */
  private detectAggregateTotals(schema: DetectedSchema): PlanRule[] {
    const rules: PlanRule[] = [];

    for (const parent of schema.tables) {
      const totalCol = this.findColumn(parent, this.GRAND_TOTAL_NAMES, this.isNumeric);
      if (!totalCol) continue;

      // Tablas hijas que referencian a este padre y tienen una columna sumable.
      const candidates = schema.tables
        .filter((child) => child.name !== parent.name)
        .map((child) => {
          const fk = child.foreignKeys.find(
            (f) => f.referencesTable === parent.name,
          );
          if (!fk) return null;

          const sumCol = this.findColumn(child, this.CHILD_SUM_NAMES, this.isNumeric);
          if (!sumCol) return null;

          return { child, fkColumn: fk.column, sumCol };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      // Solo emitimos si hay exactamente una hija sumable (evita ambigüedad).
      if (candidates.length !== 1) continue;

      const { child, fkColumn, sumCol } = candidates[0];

      rules.push(
        this.rule({
          type: 'AGGREGATE_CHILDREN',
          targetTable: parent.name,
          targetColumn: totalCol,
          childTable: child.name,
          childForeignKey: fkColumn,
          childColumn: sumCol,
          aggregate: 'SUM',
          confidence: 0.9,
          description: `${parent.name}.${totalCol} = SUM(${child.name}.${sumCol})`,
        }),
      );
    }

    return rules;
  }

  /** fecha_fin ≥ fecha_inicio en la misma fila (DATE_RELATION). */
  private detectSameRowDateOrder(table: DetectedTable): PlanRule[] {
    const rules: PlanRule[] = [];

    for (const pair of this.DATE_PAIRS) {
      const startCol = this.findColumn(table, pair.start, this.isDate);
      const endCol = this.findColumn(table, pair.end, this.isDate);

      if (startCol && endCol && startCol !== endCol) {
        rules.push(
          this.rule({
            type: 'DATE_RELATION',
            targetTable: table.name,
            targetColumn: endCol,
            referenceColumn: startCol,
            dateRelation: 'ON_OR_AFTER',
            confidence: 0.92,
            description: `${table.name}.${endCol} ≥ ${startCol}`,
          }),
        );
      }
    }

    return rules;
  }

  /** child.fecha ≥ parent.fecha (REFERENCE_DATE_RELATION) — ej. pago tras pedido. */
  private detectChildAfterParentDate(schema: DetectedSchema): PlanRule[] {
    const rules: PlanRule[] = [];
    const tableMap = new Map(schema.tables.map((t) => [t.name, t]));

    for (const child of schema.tables) {
      const childDate = this.findColumn(
        child,
        this.CHILD_FOLLOWING_DATE_NAMES,
        this.isDate,
      );
      if (!childDate) continue;

      for (const fk of child.foreignKeys) {
        const parent = tableMap.get(fk.referencesTable);
        if (!parent || parent.name === child.name) continue;

        const parentDate = this.findColumn(
          parent,
          this.PARENT_DATE_NAMES,
          this.isDate,
        );
        if (!parentDate) continue;

        rules.push(
          this.rule({
            type: 'REFERENCE_DATE_RELATION',
            targetTable: child.name,
            targetColumn: childDate,
            sourceTable: parent.name,
            sourceColumn: parentDate,
            viaForeignKey: fk.column,
            dateRelation: 'ON_OR_AFTER',
            confidence: 0.85,
            description: `${child.name}.${childDate} ≥ ${parent.name}.${parentDate}`,
          }),
        );
        break; // una relación de fecha por columna hija basta
      }
    }

    return rules;
  }

  // ---- Utilidades -------------------------------------------------------

  private findColumn(
    table: DetectedTable,
    names: string[],
    typeCheck: (column: DetectedColumn) => boolean,
  ): string | null {
    // Coincidencia exacta primero, luego por inclusión, respetando el tipo.
    for (const column of table.columns) {
      const lower = column.name.toLowerCase();
      if (names.includes(lower) && typeCheck(column) && !column.isPrimaryKey) {
        return column.name;
      }
    }
    for (const column of table.columns) {
      const lower = column.name.toLowerCase();
      if (
        names.some((n) => lower === n || lower.endsWith(`_${n}`)) &&
        typeCheck(column) &&
        !column.isPrimaryKey
      ) {
        return column.name;
      }
    }
    return null;
  }

  private isNumeric = (column: DetectedColumn): boolean =>
    column.normalizedType === 'INTEGER' ||
    column.normalizedType === 'DECIMAL' ||
    column.normalizedType === 'SERIAL';

  private isDate = (column: DetectedColumn): boolean =>
    column.normalizedType === 'DATE' || column.normalizedType === 'DATETIME';

  private areTypesCompatible(a: DetectedColumn, b: DetectedColumn): boolean {
    if (this.isNumeric(a) && this.isNumeric(b)) return true;
    return a.normalizedType === b.normalizedType;
  }

  /** Construye un PlanRule completo con los campos no usados en null. */
  private rule(
    partial: Pick<
      PlanRule,
      'type' | 'targetTable' | 'targetColumn' | 'description' | 'confidence'
    > &
      Partial<PlanRule>,
  ): PlanRule {
    return {
      sourceTable: null,
      sourceColumn: null,
      viaForeignKey: null,
      leftColumn: null,
      rightColumn: null,
      operator: null,
      childTable: null,
      childForeignKey: null,
      childColumn: null,
      aggregate: null,
      referenceColumn: null,
      dateRelation: null,
      boundOperator: null,
      ...partial,
    };
  }
}
