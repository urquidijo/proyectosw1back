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
  analyze(sql: string): SchemaAnalysisResult {
    const errors: string[] = [];

    const cleanedSql = this.removeComments(sql);

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

    const tables = this.extractTables(cleanedSql);

    if (tables.length === 0) {
      errors.push(
        'No se pudieron detectar tablas. Verifica que el SQL sea compatible con PostgreSQL.',
      );
    }

    this.applyAlterTableConstraints(cleanedSql, tables);

    for (const table of tables) {
      if (table.columns.length === 0) {
        errors.push(`La tabla "${table.name}" no tiene columnas detectables`);
      }
    }

    const schema: DetectedSchema = {
      dialect: 'postgresql',
      tables,
    };

    return {
      valid: errors.length === 0,
      schema,
      errors,
    };
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
      /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."']+)\s*\(([\s\S]*?)\)\s*;/gi;

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
        continue;
      }

      const column = this.parseColumn(part);

      if (column) {
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

    const finalColumns = columns.map((column) => ({
      ...column,
      isPrimaryKey: primaryKeys.has(column.name) || column.isPrimaryKey,
      isNullable: primaryKeys.has(column.name) ? false : column.isNullable,
    }));

    return {
      name: tableName,
      columns: finalColumns,
      primaryKeys: Array.from(primaryKeys),
      foreignKeys,
    };
  }

  private applyAlterTableConstraints(
    sql: string,
    tables: DetectedTable[],
  ): void {
    const tableMap = new Map(tables.map((table) => [table.name, table]));

    const primaryKeyRegex =
      /alter\s+table\s+(?:only\s+)?([a-zA-Z0-9_."']+)\s+add\s+(?:constraint\s+[a-zA-Z0-9_."']+\s+)?primary\s+key\s*\(([^)]+)\)\s*;/gi;

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
      /alter\s+table\s+(?:only\s+)?([a-zA-Z0-9_."']+)\s+add\s+(?:constraint\s+[a-zA-Z0-9_."']+\s+)?foreign\s+key\s*\(\s*([a-zA-Z0-9_."']+)\s*\)\s+references\s+([a-zA-Z0-9_."']+)\s*\(\s*([a-zA-Z0-9_."']+)\s*\)\s*;/gi;

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
      /\breferences\s+([a-zA-Z0-9_."']+)\s*\(\s*([a-zA-Z0-9_."']+)\s*\)/i,
    );

    const references = inlineReferenceMatch
      ? {
          table: this.normalizeIdentifier(inlineReferenceMatch[1]),
          column: this.normalizeIdentifier(inlineReferenceMatch[2]),
        }
      : null;

    return {
      name: columnName,
      rawType,
      normalizedType: this.normalizeSqlType(rawType, columnName),
      isPrimaryKey,
      isNullable,
      isUnique,
      defaultValue,
      references,
    };
  }

  private parseTableForeignKey(part: string): DetectedForeignKey | null {
    const match = part.match(
      /foreign\s+key\s*\(\s*([a-zA-Z0-9_."']+)\s*\)\s+references\s+([a-zA-Z0-9_."']+)\s*\(\s*([a-zA-Z0-9_."']+)\s*\)/i,
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
    return /^(constraint|unique|check|exclude)/i.test(part);
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
    const cleaned = identifier.replace(/["']/g, '').trim();

    const parts = cleaned.split('.');

    return parts[parts.length - 1];
  }

  private normalizeSqlType(rawType: string, columnName: string): string {
    const type = rawType.toLowerCase();
    const name = columnName.toLowerCase();

    if (type.includes('bigserial')) return 'SERIAL';
    if (type.includes('serial')) return 'SERIAL';
    if (type.includes('uuid')) return 'UUID';
    if (type.includes('int')) return 'INTEGER';
    if (type.includes('decimal')) return 'DECIMAL';
    if (type.includes('numeric')) return 'DECIMAL';
    if (type.includes('double')) return 'DECIMAL';
    if (type.includes('real')) return 'DECIMAL';
    if (type.includes('bool')) return 'BOOLEAN';
    if (type.includes('date') && !type.includes('timestamp')) return 'DATE';
    if (type.includes('timestamp')) return 'DATETIME';
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