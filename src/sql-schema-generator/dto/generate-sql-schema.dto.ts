import { IsString, MinLength } from 'class-validator';

export class GenerateSqlSchemaDto {
  @IsString()
  @MinLength(10, {
    message: 'La descripción debe tener al menos 10 caracteres',
  })
  description!: string;
}