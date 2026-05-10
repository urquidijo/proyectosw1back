import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateSqlImportDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  sql!: string;
}