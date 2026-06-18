import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ClaudeProvider } from './claude.provider';
import { GeminiProvider } from './gemini.provider';
import { GroqProvider } from './groq.provider';
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
  private readonly providersChain: LlmProvider[];

  constructor(
    private readonly configService: ConfigService,
    private readonly claude: ClaudeProvider,
    private readonly gemini: GeminiProvider,
    private readonly groq: GroqProvider,
  ) {
    const preferred = (
      this.configService.get<string>('LLM_PROVIDER') ?? 'claude'
    ).toLowerCase();

    // Ordenamos la cadena según preferencia
    if (preferred === 'groq') {
      this.providersChain = [this.groq, this.claude, this.gemini];
    } else if (preferred === 'gemini') {
      this.providersChain = [this.gemini, this.claude, this.groq];
    } else {
      this.providersChain = [this.claude, this.gemini, this.groq];
    }

    this.logger.log(
      `Proveedor IA principal: ${this.providersChain[0].name}`,
    );
  }

  /**
   * Pide JSON estructurado al proveedor principal; si no está configurado o
   * lanza error, reintenta con el de respaldo.
   */
  async generateJson<T = unknown>(
    prompt: string,
    jsonSchema: Record<string, unknown>,
    validator?: (data: unknown) => T,
  ): Promise<T> {
    const chain = this.buildProviderChain();

    if (chain.length === 0) {
      throw new ServiceUnavailableException(
        'Ningún proveedor de IA está configurado (define ANTHROPIC_API_KEY o GEMINI_API_KEY)',
      );
    }

    let lastError: unknown;

    for (const provider of chain) {
      try {
        const rawJson = await provider.generateJson(prompt, jsonSchema);
        if (validator) {
          return validator(rawJson);
        }
        return rawJson as T;
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

  /** Orden de intento: principal configurado primero, luego los respaldos configurados. */
  private buildProviderChain(): LlmProvider[] {
    return this.providersChain.filter((provider) => provider.isConfigured());
  }
}
