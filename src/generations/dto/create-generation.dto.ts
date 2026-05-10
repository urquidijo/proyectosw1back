import { IsNotEmpty, IsNotEmptyObject, IsObject, IsString } from 'class-validator';

export class CreateGenerationDto {
  @IsString()
  @IsNotEmpty()
  sqlImportId!: string;

  @IsObject()
  @IsNotEmptyObject()
  rowConfig!: Record<string, number>;
}