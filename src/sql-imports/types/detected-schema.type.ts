export type DetectedColumn = {
  name: string;
  rawType: string;
  normalizedType: string;
  isPrimaryKey: boolean;
  isNullable: boolean;
  isUnique: boolean;
  defaultValue?: string | null;
  references?: {
    table: string;
    column: string;
  } | null;
  /** Límites numéricos detectados en restricciones CHECK simples (ej. CHECK (monto >= 0)). */
  checkMin?: number | null;
  checkMax?: number | null;
};

export type DetectedForeignKey = {
  column: string;
  referencesTable: string;
  referencesColumn: string;
};

export type DetectedTable = {
  name: string;
  columns: DetectedColumn[];
  primaryKeys: string[];
  foreignKeys: DetectedForeignKey[];
};

export type DetectedSchema = {
  dialect: 'postgresql' | 'mysql';
  tables: DetectedTable[];
};

export type SchemaAnalysisResult = {
  valid: boolean;
  schema: DetectedSchema | null;
  errors: string[];
};