import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ClaudeProvider } from './claude.provider';
import { GeminiProvider } from './gemini.provider';
import { LlmProvider } from './llm-provider.interface';

/**
 * Orquestador de IA.
 *
 * Elige el proveedor PRINCIPAL según `LLM_PROVIDER` (por defecto Claude) y, si
 * ese falla o no está configurado, hace FALLBACK automático al otro. Así nunca
 * dependemos de un solo proveedor durante la demo y protegemos la cuota.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly primary: LlmProvider;
  private readonly fallback: LlmProvider;

  constructor(
    private readonly configService: ConfigService,
    private readonly claude: ClaudeProvider,
    private readonly gemini: GeminiProvider,
  ) {
    const preferred = (
      this.configService.get<string>('LLM_PROVIDER') ?? 'claude'
    ).toLowerCase();

    if (preferred === 'gemini') {
      this.primary = this.gemini;
      this.fallback = this.claude;
    } else {
      this.primary = this.claude;
      this.fallback = this.gemini;
    }

    this.logger.log(
      `Proveedor IA principal: ${this.primary.name} (respaldo: ${this.fallback.name})`,
    );
  }

  /**
   * Pide JSON estructurado al proveedor principal; si no está configurado o
   * lanza error, reintenta con el de respaldo.
   */
  async generateJson(
    prompt: string,
    jsonSchema: Record<string, unknown>,
  ): Promise<unknown> {
    const chain = this.buildProviderChain();

    if (chain.length === 0) {
      throw new ServiceUnavailableException(
        'Ningún proveedor de IA está configurado (define ANTHROPIC_API_KEY o GEMINI_API_KEY)',
      );
    }

    let lastError: unknown;

    for (const provider of chain) {
      try {
        return await provider.generateJson(prompt, jsonSchema);
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `Proveedor ${provider.name} falló: ${
            error instanceof Error ? error.message : 'error desconocido'
          }. Intentando con el siguiente...`,
        );
      }
    }

    throw new ServiceUnavailableException(
      `Todos los proveedores de IA fallaron: ${
        lastError instanceof Error ? lastError.message : 'error desconocido'
      }`,
    );
  }

  /** Orden de intento: principal configurado primero, luego respaldo configurado. */
  private buildProviderChain(): LlmProvider[] {
    return [this.primary, this.fallback].filter((provider) =>
      provider.isConfigured(),
    );
  }
}
