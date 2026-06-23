import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export const SQL_SCHEMA_GENERATOR_DIALECTS = ['POSTGRESQL', 'MYSQL'] as const;
export type SqlSchemaGeneratorDialectDto =
  (typeof SQL_SCHEMA_GENERATOR_DIALECTS)[number];

export class GenerateSqlSchemaDto {
  @IsString()
  @MinLength(10, {
    message: 'La descripción debe tener al menos 10 caracteres',
  })
  description!: string;

  /** Sintaxis del DDL a generar; debe coincidir con la base elegida al importar. */
  @IsIn(SQL_SCHEMA_GENERATOR_DIALECTS)
  @IsOptional()
  dialect?: SqlSchemaGeneratorDialectDto;
}