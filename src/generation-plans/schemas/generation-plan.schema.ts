import { z } from 'zod';

export const tableRoleSchema = z.enum([
  'MASTER',
  'REFERENCE',
  'TRANSACTION_HEADER',
  'TRANSACTION_DETAIL',
  'LEDGER',
  'BRIDGE',
  'EVENT',
  'UNKNOWN',
]);

export const semanticTypeSchema = z.enum([
  'PERSON_NAME',
  'ENTITY_NAME',
  'EMAIL',
  'PHONE',
  'CITY',
  'ADDRESS',
  'MONEY',
  'QUANTITY',
  'STATUS',
  'CATEGORY',
  'DATE',
  'DATETIME',
  'IDENTIFIER',
  'CODE',
  'DESCRIPTION',
  'BOOLEAN',
  'TEXT',
  'UNKNOWN',
]);

export const generatorHintSchema = z.enum([
  'NAME',
  'SAMPLE_VALUES',
  'EMAIL',
  'PHONE',
  'CITY',
  'ADDRESS',
  'MONEY',
  'INTEGER',
  'DECIMAL',
  'STATUS',
  'DATE',
  'DATETIME',
  'BOOLEAN',
  'TEXT',
  'STRING',
  'UNKNOWN',
]);

export const ruleTypeSchema = z.enum([
  'COPY_FROM_REFERENCE',
  'BINARY_OPERATION',
  'AGGREGATE_CHILDREN',
  'DATE_RELATION',
  'REFERENCE_DATE_RELATION',
  'REFERENCE_BOUND',
]);

export const planRuleSchema = z.object({
  type: ruleTypeSchema,

  targetTable: z.string(),
  targetColumn: z.string(),

  description: z.string(),
  confidence: z.number().min(0).max(1),

  sourceTable: z.string().nullable(),
  sourceColumn: z.string().nullable(),
  viaForeignKey: z.string().nullable(),

  leftColumn: z.string().nullable(),
  rightColumn: z.string().nullable(),
  operator: z.enum(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE']).nullable(),

  childTable: z.string().nullable(),
  childForeignKey: z.string().nullable(),
  childColumn: z.string().nullable(),
  aggregate: z.enum(['SUM', 'COUNT', 'AVG']).nullable(),

  referenceColumn: z.string().nullable(),
  dateRelation: z
    .enum(['AFTER', 'BEFORE', 'ON_OR_AFTER', 'ON_OR_BEFORE'])
    .nullable(),

  boundOperator: z.enum(['LTE', 'GTE']).nullable(),
});

export const generationPlanSchema = z.object({
  domainSummary: z.string(),

  tables: z.array(
    z.object({
      table: z.string(),
      role: tableRoleSchema,
      confidence: z.number().min(0).max(1),
      notes: z.string(),
    }),
  ),

  columns: z.array(
    z.object({
      table: z.string(),
      column: z.string(),
      semanticType: semanticTypeSchema,
      generatorHint: generatorHintSchema,
      confidence: z.number().min(0).max(1),
      notes: z.string(),

      sampleValues: z.array(z.string()),
      numericMin: z.number().nullable(),
      numericMax: z.number().nullable(),
    }),
  ),

  rules: z.array(planRuleSchema),

  warnings: z.array(z.string()),
});

export type GenerationPlanJson = z.infer<typeof generationPlanSchema>;
export type PlanRule = z.infer<typeof planRuleSchema>;