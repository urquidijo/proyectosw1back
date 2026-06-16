import { Module } from '@nestjs/common';
import { GenerationPlansController } from './generation-plans.controller';
import { GenerationPlansService } from './generation-plans.service';
import { SemanticAnalyzerService } from './semantic-analyzer.service';
import { SemanticRuleCandidateService } from './semantic-rule-candidate.service';

@Module({
  controllers: [GenerationPlansController],
  providers: [
    GenerationPlansService,
    SemanticAnalyzerService,
    SemanticRuleCandidateService,
  ],
  exports: [GenerationPlansService],
})
export class GenerationPlansModule {}
