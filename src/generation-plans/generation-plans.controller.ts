import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { GenerationPlansService } from './generation-plans.service';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/sql-imports/:importId/generation-plan')
export class GenerationPlansController {
  constructor(
    private readonly generationPlansService: GenerationPlansService,
  ) {}

  @Post('analyze')
  analyze(
    @Param('projectId') projectId: string,
    @Param('importId') importId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.generationPlansService.analyze(
      projectId,
      importId,
      user.id,
    );
  }

  @Get()
  findOne(
    @Param('projectId') projectId: string,
    @Param('importId') importId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.generationPlansService.findOne(
      projectId,
      importId,
      user.id,
    );
  }
}