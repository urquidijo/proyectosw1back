import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { ExportQueryDto } from './dto/export-query.dto';
import { ExportsService } from './exports.service';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/generations/:generationId/export')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get()
  async export(
    @Param('projectId') projectId: string,
    @Param('generationId') generationId: string,
    @Query() query: ExportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ) {
    const result = await this.exportsService.export(
      projectId,
      generationId,
      user.id,
      query.format,
      query.table,
    );

    // Se envía la respuesta manualmente (en vez de "return" + passthrough)
    // porque Nest serializa como JSON cualquier valor que no sea string,
    // lo que corrompía los binarios (.zip / .xlsx).
    response
      .status(200)
      .setHeader('Content-Type', result.contentType)
      .setHeader(
        'Content-Disposition',
        `attachment; filename="${result.filename}"`,
      )
      .send(result.body);
  }
}
