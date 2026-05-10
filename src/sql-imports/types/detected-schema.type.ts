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
  dialect: 'postgresql';
  tables: DetectedTable[];
};

export type SchemaAnalysisResult = {
  valid: boolean;
  schema: DetectedSchema | null;
  errors: string[];
};