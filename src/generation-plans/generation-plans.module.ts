    import { Module } from '@nestjs/common';
import { GenerationPlansController } from './generation-plans.controller';
import { GenerationPlansService } from './generation-plans.service';
import { GeminiSemanticAnalyzerService } from './gemini-semantic-analyzer.service';
import { SemanticRuleCandidateService } from './semantic-rule-candidate.service';

@Module({
  controllers: [GenerationPlansController],
  providers: [
    GenerationPlansService,
    GeminiSemanticAnalyzerService,
    SemanticRuleCandidateService,
  ],
  exports: [GenerationPlansService],
})
export class GenerationPlansModule {}