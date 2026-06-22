import { IsIn, IsOptional, IsString } from 'class-validator';

export const EXPORT_FORMATS = ['sql', 'csv', 'json', 'xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export class ExportQueryDto {
  @IsIn(EXPORT_FORMATS)
  format!: ExportFormat;

  /** Si se indica, exporta solo esa tabla (no aplica al formato "sql"). */
  @IsString()
  @IsOptional()
  table?: string;
}
