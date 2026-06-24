import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ClaudeProvider } from './claude.provider';
import { GeminiProvider } from './gemini.provider';
import { GroqProvider } from './groq.provider';
import { OllamaProvider } from './ollama.provider';
import { LlmProvider } from './llm-provider.interface';

/** Resultado de pedir JSON a la IA: el dato y quién lo generó realmente. */
export interface LlmGenerationResult<T> {
  data: T;
  /** Nombre del proveedor que respondió ("claude" | "gemini" | "groq" | "ollama"). */
  provider: string;
  /** true si respondió un modelo LOCAL (Ollama) en vez de un proveedor en la nube. */
  isLocal: boolean;
}

/**
 * Orquestador de IA.
 *
 * Elige el proveedor PRINCIPAL según `LLM_PROVIDER` (por defecto Claude) y, si
 * ese falla o no está configurado, hace FALLBACK automático al siguiente de la
 * cadena. Ollama (modelo local) siempre queda al final de la cadena como red de
 * seguridad: si Claude, Gemini y Groq fallan o no están configurados, la
 * generación de reglas sigue funcionando 100% local en vez de romperse. Si se
 * fija `LLM_PROVIDER=ollama` explícitamente, se usa como proveedor PRINCIPAL
 * (modo "todo local", para cuando el esquema no debe salir de la máquina).
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
    private readonly ollama: OllamaProvider,
  ) {
    const preferred = (
      this.configService.get<string>('LLM_PROVIDER') ?? 'claude'
    ).toLowerCase();

    if (preferred === 'ollama') {
      // Modo "todo local": ni siquiera se intenta la nube primero.
      this.providersChain = [this.ollama, this.claude, this.gemini, this.groq];
    } else if (preferred === 'groq') {
      this.providersChain = [this.groq, this.claude, this.gemini, this.ollama];
    } else if (preferred === 'gemini') {
      this.providersChain = [this.gemini, this.claude, this.groq, this.ollama];
    } else {
      this.providersChain = [this.claude, this.gemini, this.groq, this.ollama];
    }

    this.logger.log(
      `Proveedor IA principal: ${this.providersChain[0].name}`,
    );
  }

  /**
   * Pide JSON estructurado al proveedor principal; si no está configurado o
   * lanza error, reintenta con el siguiente de la cadena (terminando en el
   * modelo local Ollama si todo lo demás falla).
   */
  async generateJson<T = unknown>(
    prompt: string,
    jsonSchema: Record<string, unknown>,
    validator?: (data: unknown) => T,
  ): Promise<LlmGenerationResult<T>> {
    const chain = this.buildProviderChain();

    if (chain.length === 0) {
      throw new ServiceUnavailableException(
        'Ningún proveedor de IA está configurado (define ANTHROPIC_API_KEY, GEMINI_API_KEY o instala Ollama)',
      );
    }

    let lastError: unknown;

    for (const provider of chain) {
      try {
        const rawJson = await provider.generateJson(prompt, jsonSchema);
        const data = validator ? validator(rawJson) : (rawJson as T);
        return { data, provider: provider.name, isLocal: provider.isLocal };
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
