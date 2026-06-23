import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { GenerateSqlSchemaDto } from './dto/generate-sql-schema.dto';
import { SqlSchemaGeneratorService } from './sql-schema-generator.service';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/sql-schema-generator')
export class SqlSchemaGeneratorController {
  constructor(
    private readonly sqlSchemaGeneratorService: SqlSchemaGeneratorService,
  ) {}

  @Post('generate')
  generate(
    @Param('projectId') projectId: string,
    @Body() dto: GenerateSqlSchemaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sqlSchemaGeneratorService.generateFromNaturalLanguage(
      projectId,
      user.id,
      dto.description,
      dto.dialect,
    );
  }
}