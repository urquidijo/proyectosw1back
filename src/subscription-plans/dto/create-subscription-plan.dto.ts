import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PlanType } from '../../generated/prisma/client';

export class CreateSubscriptionPlanDto {
  @IsString()
  name: string;

  @IsEnum(PlanType)
  @IsOptional()
  type?: PlanType;

  @IsNumber()
  @Min(0)
  @IsOptional()
  price?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxWorkspaces?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxProjects?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxUsersPerWorkspace?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxGenerationsPerMonth?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  apiCostPer1kRows?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
