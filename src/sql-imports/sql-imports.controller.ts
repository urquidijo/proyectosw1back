import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateSqlImportDto } from './dto/create-sql-import.dto';
import { SqlImportsService } from './sql-imports.service';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/sql-imports')
export class SqlImportsController {
  constructor(private readonly sqlImportsService: SqlImportsService) {}

  @Post()
  createFromText(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() createSqlImportDto: CreateSqlImportDto,
  ) {
    return this.sqlImportsService.createFromText(
      projectId,
      user.id,
      createSqlImportDto,
    );
  }

  @Get()
  findAllByProject(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sqlImportsService.findAllByProject(projectId, user.id);
  }

  @Get(':importId')
  findOne(
    @Param('projectId') projectId: string,
    @Param('importId') importId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sqlImportsService.findOne(projectId, importId, user.id);
  }

  @Delete(':importId')
  remove(
    @Param('projectId') projectId: string,
    @Param('importId') importId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sqlImportsService.remove(projectId, importId, user.id);
  }
}