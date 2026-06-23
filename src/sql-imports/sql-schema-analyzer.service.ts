import { Injectable } from '@nestjs/common';
import {
  DetectedColumn,
  DetectedForeignKey,
  DetectedSchema,
  DetectedTable,
  SchemaAnalysisResult,
} from './types/detected-schema.type';

@Injectable()
export class SqlSchemaAnalyzerService {
  analyze(
    sql: string,
    dialect: 'postgresql' | 'mysql' = 'postgresql',
  ): SchemaAnalysisResult {
    const errors: string[] = [];

    const cleanedSql = this.stripMySqlTableOptions(this.removeComments(sql));

    if (!cleanedSql.trim()) {
      return {
        valid: false,
        schema: null,
        errors: ['El script SQL está vacío'],
      };
    }

    if (!/create\s+table/i.test(cleanedSql)) {
      return {
        valid: false,
        schema: null,
        errors: ['El script debe contener al menos una sentencia CREATE TABLE'],
      };
    }

    const dialectMismatch = this.detectDialectMismatch(cleanedSql, dialect);
    if (dialectMismatch) {
      errors.push(dialectMismatch);
    }

    const tables = this.extractTables(cleanedSql);

    if (tables.length === 0) {
      errors.push(
        'No se pudieron detectar tablas. Verifica que el SQL sea compatible con PostgreSQL o MySQL.',
      );
    }

    this.applyAlterTableConstraints(cleanedSql, tables);

    for (const table of tables) {
      if (table.columns.length === 0) {
        errors.push(`La tabla "${table.name}" no tiene columnas detectables`);
      }
    }

    const schema: DetectedSchema = {
      dialect,
      tables,
    };

    return {
      valid: errors.length === 0,
      schema,
      errors,
    };
  }

  /**
   * Detecta si el script usa marcadores sintácticos exclusivos del OTRO
   * dialecto al que el usuario declaró (ej. eligió MySQL pero el script usa
   * `SERIAL`/`RETURNING`, propios de PostgreSQL). Evita que se analice un
   * script con el dialecto equivocado, lo que produciría tipos/columnas mal
   * detectados de forma silenciosa.
   */
  private detectDialectMismatch(
    sql: string,
    dialect: 'postgresql' | 'mysql',
  ): string | null {
    const mysqlMarkers = [
      /`[a-zA-Z0-9_]+`/, // identificadores con backtick
      /\bauto_increment\b/i,
      /\bengine\s*=\s*\w+/i,
      /\bunsigned\b/i,
      /\btinyint\b/i,
    ];

    const postgresMarkers = [
      /\b(big)?serial\b/i,
      /\bgenerated\s+(always|by\s+default)\s+as\s+identity\b/i,
      /::\s*[a-zA-Z][\w[\]]*/, // cast estilo Postgres, ej. precio::numeric
      /\breturning\b/i,
    ];

    const hasMysqlMarker = mysqlMarkers.some((pattern) => pattern.test(sql));
    const hasPostgresMarker = postgresMarkers.some((pattern) =>
      pattern.test(sql),
    );

    if (dialect === 'mysql' && hasPostgresMarker) {
      return 'El script parece usar sintaxis PostgreSQL (SERIAL, RETURNING, ::cast o GENERATED ... AS IDENTITY), pero seleccionaste MySQL. Cambia la base de datos seleccionada o revisa el script.';
    }

    if (dialect === 'postgresql' && hasMysqlMarker) {
      return 'El script parece usar sintaxis MySQL (identificadores con backtick, AUTO_INCREMENT, ENGINE=..., UNSIGNED o TINYINT), pero seleccionaste PostgreSQL. Cambia la base de datos seleccionada o revisa el script.';
    }

    return null;
  }

  /**
   * Quita cláusulas de opciones de tabla exclusivas de MySQL (ENGINE=InnoDB,
   * DEFAULT CHARSET=..., COLLATE=..., AUTO_INCREMENT=N, ROW_FORMAT=...,
   * COMMENT='...') que MySQL permite escribir entre el ")" de cierre y el ";"
   * final de un CREATE TABLE. El resto del parser asume que justo después del
   * paréntesis de cierre viene el ";", así que las removemos antes de extraer
   * tablas. Es un no-op para scripts PostgreSQL (esas cláusulas no existen ahí).
   */
  private stripMySqlTableOptions(sql: string): string {
    return sql.replace(
      /\)(?:\s*(?:ENGINE\s*=\s*\w+|DEFAULT\s+CHARSET\s*=\s*\w+|CHARSET\s*=\s*\w+|COLLATE\s*=\s*[\w-]+|AUTO_INCREMENT\s*=\s*\d+|ROW_FORMAT\s*=\s*\w+|COMMENT\s*=\s*'[^']*'))*\s*;/gi,
      ');',
    );
  }

  private removeComments(sql: string): string {
    return sql
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
  }

  private extractTables(sql: string): DetectedTable[] {
    const tables: DetectedTable[] = [];

    const regex =
      /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."'`]+)\s*\(([\s\S]*?)\)\s*;/gi;

    let match: RegExpExecArray | null;

    while ((match = regex.exec(sql)) !== null) {
      const tableName = this.normalizeIdentifier(match[1]);
      const body = match[2];

      const table = this.parseTableBody(tableName, body);
      tables.push(table);
    }

    return tables;
  }

  private parseTableBody(tableName: string, body: string): DetectedTable {
    const parts = this.splitTopLevelCommas(body);

    const columns: DetectedColumn[] = [];
    const primaryKeys = new Set<string>();
    const foreignKeys: DetectedForeignKey[] = [];
    const checkBoundsByColumn = new Map<
      string,
      { min?: number; max?: number }
    >();

    for (const rawPart of parts) {
      const part = rawPart.trim();

      if (!part) continue;

      if (this.isTablePrimaryKeyConstraint(part)) {
        const keys = this.extractColumnsInsideParentheses(part);
        keys.forEach((key) => primaryKeys.add(key));
        continue;
      }

      if (this.isTableForeignKeyConstraint(part)) {
        const foreignKey = this.parseTableForeignKey(part);

        if (foreignKey) {
          foreignKeys.push(foreignKey);
        }

        continue;
      }

      if (this.isOtherTableConstraint(part)) {
        // Restricción CHECK a nivel de tabla (ej. `CHECK (monto >= 0)` o
        // `CONSTRAINT chk_monto CHECK (monto >= 0)`): no representa una
        // columna, pero sus límites numéricos sí se usan luego para acotar
        // los valores generados de esa columna.
        this.mergeCheckBounds(
          checkBoundsByColumn,
          this.extractCheckBoundsFromText(part),
        );
        continue;
      }

      const column = this.parseColumn(part);

      if (column) {
        // CHECK inline dentro de la propia definición de columna
        // (ej. `monto DECIMAL(10,2) CHECK (monto >= 0)`).
        this.mergeCheckBounds(
          checkBoundsByColumn,
          this.extractCheckBoundsFromText(part),
        );

        if (column.isPrimaryKey) {
          primaryKeys.add(column.name);
        }

        if (column.references) {
          foreignKeys.push({
            column: column.name,
            referencesTable: column.references.table,
            referencesColumn: column.references.column,
          });
        }

        columns.push(column);
      }
    }

    const finalColumns = columns.map((column) => {
      const fk = foreignKeys.find((f) => f.column === column.name);
      const bounds = checkBoundsByColumn.get(column.name);
      return {
        ...column,
        isPrimaryKey: primaryKeys.has(column.name) || column.isPrimaryKey,
        isNullable: primaryKeys.has(column.name) ? false : column.isNullable,
        references: fk
          ? { table: fk.referencesTable, column: fk.referencesColumn }
          : column.references,
        checkMin: bounds?.min ?? column.checkMin ?? null,
        checkMax: bounds?.max ?? column.checkMax ?? null,
      };
    });

    return {
      name: tableName,
      columns: finalColumns,
      primaryKeys: Array.from(primaryKeys),
      foreignKeys,
    };
  }

  /**
   * Extrae límites numéricos de cualquier CHECK presente en un fragmento de
   * DDL (puede haber más de uno, ej. `CHECK (cant > 0) CHECK (cant < 1000)`
   * aunque eso es inusual). Solo entiende patrones simples de un solo lado o
   * de rango (BETWEEN o dos comparaciones unidas con AND); cualquier otra
   * expresión (funciones, comparaciones entre columnas, etc.) se ignora en
   * vez de fallar, ya que es mejor no acotar que acotar mal.
   */
  private extractCheckBoundsFromText(
    text: string,
  ): { column: string; min?: number; max?: number }[] {
    const results: { column: string; min?: number; max?: number }[] = [];
    const checkRegex = /check\s*\(([^)]*)\)/gi;

    let match: RegExpExecArray | null;
    while ((match = checkRegex.exec(text)) !== null) {
      const parsed = this.parseCheckExpression(match[1]);

      if (parsed) {
        results.push(parsed);
      }
    }

    return results;
  }

  private parseCheckExpression(
    expression: string,
  ): { column: string; min?: number; max?: number } | null {
    const expr = expression.trim();
    const num = '-?\\d+(?:\\.\\d+)?';
    const id = "[a-zA-Z0-9_.\"'`]+";

    const between = expr.match(
      new RegExp(`^(${id})\\s+between\\s+(${num})\\s+and\\s+(${num})$`, 'i'),
    );
    if (between) {
      return {
        column: this.normalizeIdentifier(between[1]),
        min: Number(between[2]),
        max: Number(between[3]),
      };
    }

    const lowerThenUpper = expr.match(
      new RegExp(
        `^(${id})\\s*(>=|>)\\s*(${num})\\s+and\\s+\\1\\s*(<=|<)\\s*(${num})$`,
        'i',
      ),
    );
    if (lowerThenUpper) {
      return {
        column: this.normalizeIdentifier(lowerThenUpper[1]),
        min: Number(lowerThenUpper[3]),
        max: Number(lowerThenUpper[5]),
      };
    }

    const upperThenLower = expr.match(
      new RegExp(
        `^(${id})\\s*(<=|<)\\s*(${num})\\s+and\\s+\\1\\s*(>=|>)\\s*(${num})$`,
        'i',
      ),
    );
    if (upperThenLower) {
      return {
        column: this.normalizeIdentifier(upperThenLower[1]),
        min: Number(upperThenLower[5]),
        max: Number(upperThenLower[3]),
      };
    }

    const single = expr.match(
      new RegExp(`^(${id})\\s*(>=|>|<=|<)\\s*(${num})$`, 'i'),
    );
    if (single) {
      const column = this.normalizeIdentifier(single[1]);
      const operator = single[2];
      const value = Number(single[3]);

      return operator === '>=' || operator === '>'
        ? { column, min: value }
        : { column, max: value };
    }

    return null;
  }

  private mergeCheckBounds(
    target: Map<string, { min?: number; max?: number }>,
    updates: { column: string; min?: number; max?: number }[],
  ): void {
    for (const update of updates) {
      const current = target.get(update.column) ?? {};

      target.set(update.column, {
        min:
          update.min === undefined
            ? current.min
            : current.min === undefined
              ? update.min
              : Math.max(current.min, update.min),
        max:
          update.max === undefined
            ? current.max
            : current.max === undefined
              ? update.max
              : Math.min(current.max, update.max),
      });
    }
  }

  private applyAlterTableConstraints(
    sql: string,
    tables: DetectedTable[],
  ): void {
    const tableMap = new Map(tables.map((table) => [table.name, table]));

    const primaryKeyRegex =
      /alter\s+table\s+(?:only\s+)?([a-zA-Z0-9_."'`]+)\s+add\s+(?:constraint\s+[a-zA-Z0-9_."'`]+\s+)?primary\s+key\s*\(([^)]+)\)\s*;/gi;

    let primaryKeyMatch: RegExpExecArray | null;

    while ((primaryKeyMatch = primaryKeyRegex.exec(sql)) !== null) {
      const tableName = this.normalizeIdentifier(primaryKeyMatch[1]);
      const table = tableMap.get(tableName);

      if (!table) continue;

      const keys = primaryKeyMatch[2]
        .split(',')
        .map((column) => this.normalizeIdentifier(column.trim()))
        .filter(Boolean);

      for (const key of keys) {
        if (!table.primaryKeys.includes(key)) {
          table.primaryKeys.push(key);
        }

        const column = table.columns.find((item) => item.name === key);

        if (column) {
          column.isPrimaryKey = true;
          column.isNullable = false;
          column.isUnique = true;
        }
      }
    }

    const foreignKeyRegex =
      /alter\s+table\s+(?:only\s+)?([a-zA-Z0-9_."'`]+)\s+add\s+(?:constraint\s+[a-zA-Z0-9_."'`]+\s+)?foreign\s+key\s*\(\s*([a-zA-Z0-9_."'`]+)\s*\)\s+references\s+([a-zA-Z0-9_."'`]+)\s*\(\s*([a-zA-Z0-9_."'`]+)\s*\)\s*;/gi;

    let foreignKeyMatch: RegExpExecArray | null;

    while ((foreignKeyMatch = foreignKeyRegex.exec(sql)) !== null) {
      const tableName = this.normalizeIdentifier(foreignKeyMatch[1]);
      const columnName = this.normalizeIdentifier(foreignKeyMatch[2]);
      const referencesTable = this.normalizeIdentifier(foreignKeyMatch[3]);
      const referencesColumn = this.normalizeIdentifier(foreignKeyMatch[4]);

      const table = tableMap.get(tableName);

      if (!table) continue;

      const alreadyExists = table.foreignKeys.some(
        (foreignKey) =>
          foreignKey.column === columnName &&
          foreignKey.referencesTable === referencesTable &&
          foreignKey.referencesColumn === referencesColumn,
      );

      if (!alreadyExists) {
        table.foreignKeys.push({
          column: columnName,
          referencesTable,
          referencesColumn,
        });
      }

      const column = table.columns.find((item) => item.name === columnName);

      if (column) {
        column.references = {
          table: referencesTable,
          column: referencesColumn,
        };
      }
    }
  }

  private parseColumn(part: string): DetectedColumn | null {
    const tokens = part.trim().split(/\s+/);

    if (tokens.length < 2) {
      return null;
    }

    const columnName = this.normalizeIdentifier(tokens[0]);

    const constraintIndex = tokens.findIndex((token) =>
      /^(primary|references|not|null|unique|default|check|constraint)$/i.test(
        token,
      ),
    );

    const typeTokens =
      constraintIndex === -1 ? tokens.slice(1) : tokens.slice(1, constraintIndex);

    const rawType = typeTokens.join(' ');

    const isPrimaryKey = /primary\s+key/i.test(part);
    const isNullable = !/not\s+null/i.test(part) && !isPrimaryKey;
    const isUnique = /\bunique\b/i.test(part) || isPrimaryKey;

    const defaultValueMatch = part.match(/\bdefault\s+([^,\s]+)/i);
    const defaultValue = defaultValueMatch ? defaultValueMatch[1] : null;

    const inlineReferenceMatch = part.match(
      /\breferences\s+([a-zA-Z0-9_."'`]+)\s*\(\s*([a-zA-Z0-9_."'`]+)\s*\)/i,
    );

    const references = inlineReferenceMatch
      ? {
          table: this.normalizeIdentifier(inlineReferenceMatch[1]),
          column: this.normalizeIdentifier(inlineReferenceMatch[2]),
        }
      : null;

    // AUTO_INCREMENT (MySQL) puede aparecer después de NOT NULL/UNSIGNED, fuera
    // de los `typeTokens` recortados por constraintIndex; se busca en `part`
    // completo para no perderlo según el orden en que el usuario lo escribió.
    const normalizedType = /auto_increment/i.test(part)
      ? 'SERIAL'
      : this.normalizeSqlType(rawType, columnName);

    return {
      name: columnName,
      rawType,
      normalizedType,
      isPrimaryKey,
      isNullable,
      isUnique,
      defaultValue,
      references,
    };
  }

  private parseTableForeignKey(part: string): DetectedForeignKey | null {
    const match = part.match(
      /foreign\s+key\s*\(\s*([a-zA-Z0-9_."'`]+)\s*\)\s+references\s+([a-zA-Z0-9_."'`]+)\s*\(\s*([a-zA-Z0-9_."'`]+)\s*\)/i,
    );

    if (!match) {
      return null;
    }

    return {
      column: this.normalizeIdentifier(match[1]),
      referencesTable: this.normalizeIdentifier(match[2]),
      referencesColumn: this.normalizeIdentifier(match[3]),
    };
  }

  private isTablePrimaryKeyConstraint(part: string): boolean {
    return /^primary\s+key/i.test(part);
  }

  private isTableForeignKeyConstraint(part: string): boolean {
    return /foreign\s+key/i.test(part) && /references/i.test(part);
  }

  private isOtherTableConstraint(part: string): boolean {
    // "key"/"index"/"fulltext"/"spatial" cubren los índices sueltos típicos de
    // MySQL (ej. `KEY idx_nombre (nombre)`, `FULLTEXT idx (texto)`), que no
    // representan una columna ni deben interpretarse como tal.
    return /^(constraint|unique|check|exclude|key|index|fulltext|spatial)\b/i.test(
      part,
    );
  }

  private extractColumnsInsideParentheses(part: string): string[] {
    const match = part.match(/\(([^)]+)\)/);

    if (!match) return [];

    return match[1]
      .split(',')
      .map((column) => this.normalizeIdentifier(column.trim()))
      .filter(Boolean);
  }

  private splitTopLevelCommas(input: string): string[] {
    const result: string[] = [];

    let current = '';
    let depth = 0;

    for (const char of input) {
      if (char === '(') depth++;
      if (char === ')') depth--;

      if (char === ',' && depth === 0) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      result.push(current);
    }

    return result;
  }

  private normalizeIdentifier(identifier: string): string {
    const cleaned = identifier.replace(/["'`]/g, '').trim();

    const parts = cleaned.split('.');

    return parts[parts.length - 1];
  }

  private normalizeSqlType(rawType: string, columnName: string): string {
    const type = rawType.toLowerCase();
    const name = columnName.toLowerCase();

    if (type.includes('bigserial')) return 'SERIAL';
    if (type.includes('serial')) return 'SERIAL';
    if (type.includes('uuid')) return 'UUID';
    // TINYINT(1) es el idioma estándar de MySQL para booleanos; debe resolverse
    // antes que el check genérico de "int" (que de otro modo lo tomaría como INTEGER).
    if (type.includes('tinyint')) return 'BOOLEAN';
    if (type.includes('int')) return 'INTEGER';
    if (type.includes('decimal')) return 'DECIMAL';
    if (type.includes('numeric')) return 'DECIMAL';
    if (type.includes('double')) return 'DECIMAL';
    if (type.includes('float')) return 'DECIMAL';
    if (type.includes('real')) return 'DECIMAL';
    if (type.includes('bool')) return 'BOOLEAN';
    if (type.includes('enum')) return 'STRING';
    // "datetime" y "timestamp" deben resolverse antes que "date" a secas: ambos
    // contienen la subcadena "date"/se relacionan, y MySQL usa DATETIME como su
    // tipo estándar de fecha+hora (donde Postgres suele usar TIMESTAMP).
    if (type.includes('datetime')) return 'DATETIME';
    if (type.includes('timestamp')) return 'DATETIME';
    if (type.includes('date')) return 'DATE';
    if (type.includes('time')) return 'TIME';
    if (type.includes('text')) return 'TEXT';

    if (type.includes('char')) {
      if (name.includes('email') || name.includes('correo')) return 'EMAIL';
      if (
        name.includes('phone') ||
        name.includes('telefono') ||
        name.includes('celular')
      ) {
        return 'PHONE';
      }
      if (name.includes('ciudad') || name.includes('city')) return 'CITY';
      if (name.includes('nombre') || name.includes('name')) return 'NAME';
      return 'STRING';
    }

    return 'STRING';
  }
}