import { Module } from '@nestjs/common';
import { GenerationsController } from './generations.controller';
import { GenerationsService } from './generations.service';
import { SyntheticDataGeneratorService } from './synthetic-data-generator.service';
import { GenerationPlanExecutorService } from './generation-plan-executor.service';
import { GenerationValidationService } from './generation-validation.service';
import { VolumeSuggestionService } from './volume-suggestion.service';
import { DeterministicCoherenceService } from './deterministic-coherence.service';

@Module({
  controllers: [GenerationsController],
  providers: [
    GenerationsService,
    SyntheticDataGeneratorService,
    GenerationPlanExecutorService,
    GenerationValidationService,
    VolumeSuggestionService,
    DeterministicCoherenceService,
  ],
  exports: [GenerationsService],
})
export class GenerationsModule { }