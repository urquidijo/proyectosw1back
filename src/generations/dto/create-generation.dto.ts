import {
  IsNotEmpty,
  IsNotEmptyObject,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateGenerationDto {
  @IsString()
  @IsNotEmpty()
  sqlImportId!: string;

  @IsObject()
  @IsOptional()
  rowConfig?: Record<string, number>;

  @IsString()
  @IsOptional()
  ruleSetId?: string;

  @IsObject()
  @IsOptional()
  rules?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  region?: string;
}