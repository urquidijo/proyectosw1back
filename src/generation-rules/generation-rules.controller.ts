import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateGenerationRuleSetDto } from './dto/create-generation-rule-set.dto';
import { UpdateGenerationRuleSetDto } from './dto/update-generation-rule-set.dto';
import { GenerationRulesService } from './generation-rules.service';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/generation-rules')
export class GenerationRulesController {
    constructor(
        private readonly generationRulesService: GenerationRulesService,
    ) { }

    @Post()
    create(
        @Param('projectId') projectId: string,
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: CreateGenerationRuleSetDto,
    ) {
        return this.generationRulesService.create(projectId, user.id, dto);
    }

    @Get()
    findAll(
        @Param('projectId') projectId: string,
        @CurrentUser() user: AuthenticatedUser,
        @Query('sqlImportId') sqlImportId?: string,
    ) {
        if (sqlImportId) {
            return this.generationRulesService.findAllBySqlImport(
                projectId,
                sqlImportId,
                user.id,
            );
        }

        return this.generationRulesService.findAllByProject(projectId, user.id);
    }

    @Get(':ruleSetId')
    findOne(
        @Param('projectId') projectId: string,
        @Param('ruleSetId') ruleSetId: string,
        @CurrentUser() user: AuthenticatedUser,
    ) {
        return this.generationRulesService.findOne(
            projectId,
            ruleSetId,
            user.id,
        );
    }

    @Patch(':ruleSetId')
    update(
        @Param('projectId') projectId: string,
        @Param('ruleSetId') ruleSetId: string,
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: UpdateGenerationRuleSetDto,
    ) {
        return this.generationRulesService.update(
            projectId,
            ruleSetId,
            user.id,
            dto,
        );
    }

    @Delete(':ruleSetId')
    remove(
        @Param('projectId') projectId: string,
        @Param('ruleSetId') ruleSetId: string,
        @CurrentUser() user: AuthenticatedUser,
    ) {
        return this.generationRulesService.remove(
            projectId,
            ruleSetId,
            user.id,
        );
    }
}