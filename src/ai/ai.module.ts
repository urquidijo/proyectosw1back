import { Global, Module } from '@nestjs/common';

import { ClaudeProvider } from './claude.provider';
import { GeminiProvider } from './gemini.provider';
import { LlmService } from './llm.service';

/**
 * Módulo de IA. Es @Global para que cualquier módulo (generation-plans,
 * generations, ...) pueda inyectar LlmService sin reimportarlo.
 */
@Global()
@Module({
  providers: [ClaudeProvider, GeminiProvider, LlmService],
  exports: [LlmService],
})
export class AiModule {}
