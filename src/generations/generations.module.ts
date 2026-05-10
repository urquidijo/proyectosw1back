import { Module } from '@nestjs/common';
import { GenerationsController } from './generations.controller';
import { GenerationsService } from './generations.service';
import { SyntheticDataGeneratorService } from './synthetic-data-generator.service';
import { GenerationPlanExecutorService } from './generation-plan-executor.service';
import { GenerationValidationService } from './generation-validation.service';

@Module({
  controllers: [GenerationsController],
  providers: [
    GenerationsService,
    SyntheticDataGeneratorService,
    GenerationPlanExecutorService,
    GenerationValidationService,
  ],
})
export class GenerationsModule {}