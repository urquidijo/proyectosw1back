import { z } from 'zod';

export const generatedSqlSchema = z.object({
  title: z.string(),
  summary: z.string(),
  sql: z.string(),
  assumptions: z.array(z.string()),
});

export type GeneratedSqlSchemaResponse = z.infer<
  typeof generatedSqlSchema
>;