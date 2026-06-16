import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateGenerationDto } from './dto/create-generation.dto';
import { GenerationsService } from './generations.service';
import { VolumeSuggestionService } from './volume-suggestion.service';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/generations')
export class GenerationsController {
  constructor(
    private readonly generationsService: GenerationsService,
    private readonly volumeSuggestionService: VolumeSuggestionService,
  ) {}

  @Post()
  create(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() createGenerationDto: CreateGenerationDto,
  ) {
    return this.generationsService.create(
      projectId,
      user.id,
      createGenerationDto,
    );
  }

  @Get()
  findAllByProject(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.generationsService.findAllByProject(projectId, user.id);
  }

  @Get(':generationId')
  findOne(
    @Param('projectId') projectId: string,
    @Param('generationId') generationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.generationsService.findOne(projectId, generationId, user.id);
  }

  @Get(':generationId/status')
  getStatus(
    @Param('projectId') projectId: string,
    @Param('generationId') generationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.generationsService.getStatus(projectId, generationId, user.id);
  }

  @Get(':generationId/download')
  async download(
    @Param('projectId') projectId: string,
    @Param('generationId') generationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const outputSql = await this.generationsService.getOutputSql(
      projectId,
      generationId,
      user.id,
    );

    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="syndata-${generationId}.sql"`,
    );

    return outputSql;
  }

  @Get('suggest-volumes/:importId')
  suggestVolumes(
    @Param('projectId') projectId: string,
    @Param('importId') importId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.volumeSuggestionService.suggest(projectId, importId, user.id);
  }
}