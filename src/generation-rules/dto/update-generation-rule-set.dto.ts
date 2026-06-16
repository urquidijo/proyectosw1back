import {
    IsBoolean,
    IsObject,
    IsOptional,
    IsString,
} from 'class-validator';

export class UpdateGenerationRuleSetDto {
    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsObject()
    @IsOptional()
    rulesJson?: Record<string, unknown>;

    @IsBoolean()
    @IsOptional()
    isDefault?: boolean;
}