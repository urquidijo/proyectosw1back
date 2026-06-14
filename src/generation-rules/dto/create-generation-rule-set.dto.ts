import {
    IsBoolean,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
} from 'class-validator';

export class CreateGenerationRuleSetDto {
    @IsString()
    @IsNotEmpty()
    sqlImportId!: string;

    @IsString()
    @IsNotEmpty()
    name!: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsObject()
    rulesJson!: Record<string, unknown>;

    @IsBoolean()
    @IsOptional()
    isDefault?: boolean;
}