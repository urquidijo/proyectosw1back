import { IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export const SQL_IMPORT_ENGINES = ['POSTGRESQL', 'MONGODB'] as const;
export type SqlImportEngineDto = (typeof SQL_IMPORT_ENGINES)[number];

export const SQL_IMPORT_DIALECTS = ['POSTGRESQL', 'MYSQL'] as const;
export type SqlImportDialectDto = (typeof SQL_IMPORT_DIALECTS)[number];

export class CreateSqlImportDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  sql!: string;

  /**
   * Motor de base de datos sobre el que se generarán los datos de esta
   * importación. Se define aquí (junto al esquema y las reglas) porque es una
   * decisión estructural: toda generación posterior hereda este motor.
   */
  @IsIn(SQL_IMPORT_ENGINES)
  @IsOptional()
  engine?: SqlImportEngineDto;

  /** Sintaxis del script DDL pegado/subido. No confundir con `engine` (motor destino de los datos). */
  @IsIn(SQL_IMPORT_DIALECTS)
  @IsOptional()
  dialect?: SqlImportDialectDto;
}