import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { CreateGenerationDto } from '../generations/dto/create-generation.dto';
import { ExternalApiService } from './external-api.service';

@Controller('v1')
export class ExternalApiController {
  constructor(private readonly externalApiService: ExternalApiService) {}

  @UseGuards(ApiKeyGuard)
  @Post('projects/:projectId/generate')
  generate(
    @Param('projectId') projectId: string,
    @Request() req: any,
    @Body() dto: CreateGenerationDto,
  ) {
    return this.externalApiService.generate(req.user.id, projectId, dto);
  }

  @UseGuards(ApiKeyGuard)
  @Get('projects')
  listProjects(@Request() req: any) {
    return this.externalApiService.listProjects(req.user.id);
  }

  @UseGuards(ApiKeyGuard)
  @Get('projects/:projectId/imports')
  listImports(@Param('projectId') projectId: string, @Request() req: any) {
    return this.externalApiService.listImports(req.user.id, projectId);
  }
  @UseGuards(ApiKeyGuard)
  @Get('generations/:generationId')
  getGeneration(@Param('generationId') generationId: string, @Request() req: any) {
    return this.externalApiService.getGenerationStatus(req.user.id, generationId);
  }
}
