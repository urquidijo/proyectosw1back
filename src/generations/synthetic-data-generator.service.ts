import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DetectedColumn,
  DetectedSchema,
  DetectedTable,
} from '../sql-imports/types/detected-schema.type';
import { randomUUID } from 'crypto';
import { GenerationPlanExecutorService } from './generation-plan-executor.service';
import { GenerationPlanJson } from '../generation-plans/schemas/generation-plan.schema';

type GeneratedValue = string | number | boolean | null;
type GeneratedRow = Record<string, GeneratedValue>;

type GenerationEngineResult = {
  orderedTables: string[];
  rowsByTable: Record<string, GeneratedRow[]>;
  preview: Record<string, GeneratedRow[]>;
  outputSql: string;
};

type PersonContext = {
  firstName: string;
  lastName: string;
  fullName: string;
};

@Injectable()
export class SyntheticDataGeneratorService {
  constructor(
    private readonly generationPlanExecutor: GenerationPlanExecutorService,
  ) {}

  private readonly firstNames = [
    'Carlos',
    'María',
    'Luis',
    'Ana',
    'José',
    'Lucía',
    'Jorge',
    'Camila',
    'Diego',
    'Valeria',
    'Miguel',
    'Sofía',
  ];

  private readonly lastNames = [
    'Rojas',
    'Vargas',
    'Flores',
    'Mamani',
    'Pérez',
    'Gutiérrez',
    'Suárez',
    'Cruz',
    'Torres',
    'López',
    'Quispe',
    'Fernández',
  ];

  private readonly cities = [
    'Santa Cruz',
    'La Paz',
    'Cochabamba',
    'Sucre',
    'Tarija',
    'Oruro',
    'Potosí',
    'Trinidad',
  ];

  private readonly statuses = ['ACTIVO', 'INACTIVO', 'PENDIENTE', 'COMPLETADO'];

  generate(
    schema: DetectedSchema,
    rowConfig: Record<string, number>,
    plan?: GenerationPlanJson | null,
  ): GenerationEngineResult {
    const orderedTableObjects = this.sortTablesByDependencies(schema.tables);
    const rowsByTableMap = new Map<string, GeneratedRow[]>();

    for (const table of orderedTableObjects) {
      const count = rowConfig[table.name];
      const rows: GeneratedRow[] = [];

      for (let index = 1; index <= count; index++) {
        const row = this.generateRow(table, index, rowsByTableMap, rows, plan);

        rows.push(row);
      }

      rowsByTableMap.set(table.name, rows);
    }

    this.generationPlanExecutor.applyPlan(schema, rowsByTableMap, plan);

    const rowsByTable = Object.fromEntries(rowsByTableMap.entries());

    const preview = Object.fromEntries(
      Object.entries(rowsByTable).map(([tableName, rows]) => [
        tableName,
        rows.slice(0, 5),
      ]),
    );

    const outputSql = this.buildSqlFile(orderedTableObjects, rowsByTableMap);

    return {
      orderedTables: orderedTableObjects.map((table) => table.name),
      rowsByTable,
      preview,
      outputSql,
    };
  }

  private generateRow(
    table: DetectedTable,
    rowIndex: number,
    generatedRowsByTable: Map<string, GeneratedRow[]>,
    currentTableRows: GeneratedRow[],
    plan?: GenerationPlanJson | null,
  ): GeneratedRow {
    const row: GeneratedRow = {};
    const person = this.createPersonContext();

    for (const column of table.columns) {
      row[column.name] = this.generateColumnValue(
        table,
        column,
        rowIndex,
        person,
        generatedRowsByTable,
        currentTableRows,
        plan,
      );
    }

    return row;
  }

  private generateColumnValue(
    table: DetectedTable,
    column: DetectedColumn,
    rowIndex: number,
    person: PersonContext,
    generatedRowsByTable: Map<string, GeneratedRow[]>,
    currentTableRows: GeneratedRow[],
    plan?: GenerationPlanJson | null,
  ): GeneratedValue {
    if (column.references) {
      return this.generateForeignKeyValue(
        table.name,
        column,
        generatedRowsByTable,
        currentTableRows,
      );
    }

    if (column.isPrimaryKey) {
      return this.generatePrimaryKeyValue(table, column, rowIndex);
    }

    const semanticHint = plan?.columns.find(
      (item) =>
        item.table === table.name &&
        item.column === column.name &&
        item.confidence >= 0.7,
    );

    if (semanticHint) {
      if (semanticHint.sampleValues.length > 0) {
        return this.pick(semanticHint.sampleValues);
      }

      const hasNumericRange =
        semanticHint.numericMin !== null && semanticHint.numericMax !== null;

      switch (semanticHint.generatorHint) {
        case 'NAME':
          return person.fullName;

        case 'SAMPLE_VALUES':
          return semanticHint.sampleValues.length > 0
            ? this.pick(semanticHint.sampleValues)
            : `valor_${rowIndex}`;

        case 'EMAIL':
          return this.buildEmail(person, rowIndex);

        case 'PHONE':
          return this.buildBolivianPhone();

        case 'CITY':
          return this.pick(this.cities);

        case 'MONEY':
          return hasNumericRange
            ? this.randomDecimal(
                semanticHint.numericMin!,
                semanticHint.numericMax!,
              )
            : this.randomDecimal(10, 5000);

        case 'INTEGER':
          return hasNumericRange
            ? this.randomInteger(
                Math.ceil(semanticHint.numericMin!),
                Math.floor(semanticHint.numericMax!),
              )
            : this.randomInteger(1, 100);

        case 'DECIMAL':
          return hasNumericRange
            ? this.randomDecimal(
                semanticHint.numericMin!,
                semanticHint.numericMax!,
              )
            : this.randomDecimal(1, 9999);

        case 'STATUS':
          return semanticHint.sampleValues.length > 0
            ? this.pick(semanticHint.sampleValues)
            : this.pick(this.statuses);

        case 'DATE':
          return this.generateDateValue(column.name.toLowerCase());

        case 'DATETIME':
          return this.generateDateTimeValue();

        case 'BOOLEAN':
          return Math.random() >= 0.5;

        case 'TEXT':
          return semanticHint.sampleValues.length > 0
            ? this.pick(semanticHint.sampleValues)
            : 'Dato sintético generado por SynData';

        case 'STRING':
          return semanticHint.sampleValues.length > 0
            ? this.pick(semanticHint.sampleValues)
            : `valor_${rowIndex}`;
      }
    }

    const columnName = column.name.toLowerCase();

    if (columnName.includes('email') || columnName.includes('correo')) {
      return this.buildEmail(person, rowIndex);
    }

    if (
      columnName.includes('telefono') ||
      columnName.includes('celular') ||
      columnName.includes('phone')
    ) {
      return this.buildBolivianPhone();
    }

    if (columnName.includes('ciudad') || columnName.includes('city')) {
      return this.pick(this.cities);
    }

    if (columnName.includes('nombre') || columnName.includes('name')) {
      return person.fullName;
    }

    if (columnName.includes('estado') || columnName.includes('status')) {
      return this.pick(this.statuses);
    }

    if (
      columnName.includes('monto') ||
      columnName.includes('total') ||
      columnName.includes('precio') ||
      columnName.includes('saldo')
    ) {
      return this.randomDecimal(10, 5000);
    }

    if (columnName.includes('cantidad') || columnName.includes('stock')) {
      return this.randomInteger(1, 100);
    }

    switch (column.normalizedType) {
      case 'SERIAL':
      case 'INTEGER':
        return this.randomInteger(1, 1000);

      case 'DECIMAL':
        return this.randomDecimal(1, 9999);

      case 'BOOLEAN':
        return Math.random() >= 0.5;

      case 'DATE':
        return this.generateDateValue(columnName);

      case 'DATETIME':
        return this.generateDateTimeValue();

      case 'TIME':
        return this.generateTimeValue();

      case 'UUID':
        return randomUUID();

      case 'TEXT':
        return 'Dato sintético generado por SynData';

      case 'STRING':
      default:
        return `valor_${rowIndex}`;
    }
  }

  private generateForeignKeyValue(
    currentTableName: string,
    column: DetectedColumn,
    generatedRowsByTable: Map<string, GeneratedRow[]>,
    currentTableRows: GeneratedRow[],
  ): GeneratedValue {
    if (!column.references) {
      throw new BadRequestException(
        `La columna "${column.name}" no tiene referencia configurada`,
      );
    }

    const referencedTableName = column.references.table;
    const referencedColumnName = column.references.column;

    if (referencedTableName === currentTableName) {
      if (currentTableRows.length === 0) {
        if (column.isNullable) {
          return null;
        }

        throw new BadRequestException(
          `No se puede generar la FK obligatoria "${column.name}" porque es autorreferencial y la primera fila no tiene padre.`,
        );
      }

      const referencedRow = this.pick(currentTableRows);
      return referencedRow[referencedColumnName] ?? null;
    }

    const referencedRows = generatedRowsByTable.get(referencedTableName);

    if (!referencedRows || referencedRows.length === 0) {
      throw new BadRequestException(
        `No existen filas generadas para la tabla referenciada "${referencedTableName}"`,
      );
    }

    const referencedRow = this.pick(referencedRows);
    return referencedRow[referencedColumnName] ?? null;
  }

  private generatePrimaryKeyValue(
    table: DetectedTable,
    column: DetectedColumn,
    rowIndex: number,
  ): GeneratedValue {
    switch (column.normalizedType) {
      case 'UUID':
        return randomUUID();

      case 'STRING':
      case 'TEXT':
        return `${table.name.toUpperCase()}_${String(rowIndex).padStart(
          4,
          '0',
        )}`;

      default:
        return rowIndex;
    }
  }

  private sortTablesByDependencies(tables: DetectedTable[]): DetectedTable[] {
    const tableMap = new Map(tables.map((table) => [table.name, table]));
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const orderedTables: DetectedTable[] = [];

    const visit = (tableName: string) => {
      if (visited.has(tableName)) return;

      if (visiting.has(tableName)) {
        throw new BadRequestException(
          `Se detectó una dependencia cíclica entre tablas alrededor de "${tableName}"`,
        );
      }

      const table = tableMap.get(tableName);

      if (!table) {
        throw new BadRequestException(
          `La tabla "${tableName}" no existe dentro del esquema analizado`,
        );
      }

      visiting.add(tableName);

      for (const foreignKey of table.foreignKeys) {
        if (foreignKey.referencesTable === table.name) {
          continue;
        }

        if (!tableMap.has(foreignKey.referencesTable)) {
          throw new BadRequestException(
            `La tabla "${table.name}" referencia a "${foreignKey.referencesTable}", pero esa tabla no existe en el esquema.`,
          );
        }

        visit(foreignKey.referencesTable);
      }

      visiting.delete(tableName);
      visited.add(tableName);
      orderedTables.push(table);
    };

    for (const table of tables) {
      visit(table.name);
    }

    return orderedTables;
  }

  private buildSqlFile(
    orderedTables: DetectedTable[],
    rowsByTable: Map<string, GeneratedRow[]>,
  ): string {
    const header = [
      '-- Archivo generado por SynData',
      '-- Datos sintéticos para PostgreSQL',
      '',
    ].join('\n');

    const inserts = orderedTables
      .map((table) => {
        const rows = rowsByTable.get(table.name) ?? [];

        if (rows.length === 0) {
          return '';
        }

        const quotedColumns = table.columns
          .map((column) => this.quoteIdentifier(column.name))
          .join(', ');

        const values = rows
          .map((row) => {
            const rowValues = table.columns
              .map((column) => this.toSqlLiteral(row[column.name]))
              .join(', ');

            return `(${rowValues})`;
          })
          .join(',\n');

        return `INSERT INTO ${this.quoteIdentifier(
          table.name,
        )} (${quotedColumns}) VALUES\n${values};`;
      })
      .filter(Boolean)
      .join('\n\n');

    return `${header}${inserts}\n`;
  }

  private toSqlLiteral(value: GeneratedValue): string {
    if (value === null) return 'NULL';

    if (typeof value === 'number') return String(value);

    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';

    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private createPersonContext(): PersonContext {
    const firstName = this.pick(this.firstNames);
    const lastName = this.pick(this.lastNames);

    return {
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`,
    };
  }

  private buildEmail(person: PersonContext, rowIndex: number): string {
    const first = this.cleanText(person.firstName);
    const last = this.cleanText(person.lastName);

    return `${first}.${last}${rowIndex}@example.com`;
  }

  private buildBolivianPhone(): string {
    const prefix = this.pick(['6', '7']);
    let rest = '';

    for (let index = 0; index < 7; index++) {
      rest += String(this.randomInteger(0, 9));
    }

    return `${prefix}${rest}`;
  }

  private generateDateValue(columnName: string): string {
    if (columnName.includes('nacimiento')) {
      return this.randomDateBetween(
        new Date('1970-01-01'),
        new Date('2008-12-31'),
      );
    }

    return this.randomDateBetween(
      new Date('2023-01-01'),
      new Date('2026-05-09'),
    );
  }

  private generateDateTimeValue(): string {
    const date = this.randomDateObjectBetween(
      new Date('2023-01-01T00:00:00'),
      new Date('2026-05-09T23:59:59'),
    );

    return date.toISOString().slice(0, 19).replace('T', ' ');
  }

  private generateTimeValue(): string {
    const hour = String(this.randomInteger(0, 23)).padStart(2, '0');
    const minute = String(this.randomInteger(0, 59)).padStart(2, '0');
    const second = String(this.randomInteger(0, 59)).padStart(2, '0');

    return `${hour}:${minute}:${second}`;
  }

  private randomDateBetween(start: Date, end: Date): string {
    const date = this.randomDateObjectBetween(start, end);
    return date.toISOString().slice(0, 10);
  }

  private randomDateObjectBetween(start: Date, end: Date): Date {
    const startTime = start.getTime();
    const endTime = end.getTime();

    const randomTime =
      startTime + Math.random() * Math.max(endTime - startTime, 1);

    return new Date(randomTime);
  }

  private randomInteger(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private randomDecimal(min: number, max: number): number {
    return Number((Math.random() * (max - min) + min).toFixed(2));
  }

  private pick<T>(items: T[]): T {
    return items[this.randomInteger(0, items.length - 1)];
  }

  private cleanText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, '');
  }
}
