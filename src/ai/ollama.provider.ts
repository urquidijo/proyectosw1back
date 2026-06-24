import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LlmProvider } from './llm-provider.interface';

/**
 * Proveedor LOCAL de último recurso: Ollama (http://localhost:11434).
 *
 * No depende de ninguna API key ni de internet: corre un modelo abierto
 * (por defecto qwen2.5:3b) en la propia máquina/servidor. Sirve como red de
 * seguridad cuando Claude, Gemini y Groq fallan o no están configurados
 * (cuota agotada, sin conexión, claves inválidas), para que la generación de
 * reglas nunca se quede completamente sin proveedor de IA.
 *
 * Estructura idéntica a los demás providers; la única diferencia real es que
 * usa `format` con el JSON Schema (salida estructurada nativa de Ollama, ver
 * https://ollama.com/blog/structured-outputs) en vez de un SDK de terceros.
 */
@Injectable()
export class OllamaProvider implements LlmProvider {
  readonly name = 'ollama';
  readonly isLocal = true;

  private readonly logger = new Logger(OllamaProvider.name);
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = (
      this.configService.get<string>('OLLAMA_BASE_URL') ??
      'http://localhost:11434'
    ).replace(/\/+$/, '');
    this.model = this.configService.get<string>('OLLAMA_MODEL') ?? 'qwen2.5:3b';
    // Un modelo local en CPU puede tardar bastante en esquemas grandes (en
    // pruebas, ~165s para un esquema de solo 2 tablas en qwen2.5:3b sin GPU);
    // el valor por defecto es generoso a propósito para no abortar de más.
    this.timeoutMs = Number(
      this.configService.get<string>('OLLAMA_TIMEOUT_MS') ?? '300000',
    );
  }

  /**
   * No requiere API key: se asume disponible salvo que se desactive
   * explícitamente. Si Ollama no está corriendo, `generateJson` fallará y
   * el orquestador (LlmService) lo reportará como cualquier otro proveedor
   * caído; al ser el último de la cadena, ahí sí se propaga el error final.
   */
  isConfigured(): boolean {
    return (
      (this.configService.get<string>('OLLAMA_ENABLED') ?? 'true').toLowerCase() !==
      'false'
    );
  }

  async generateJson(
    prompt: string,
    jsonSchema: Record<string, unknown>,
  ): Promise<unknown> {
    const { $schema: _ignored, ...format } = jsonSchema as Record<
      string,
      unknown
    >;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: [{ role: 'user', content: prompt }],
          format,
          options: { temperature: 0.2 },
        }),
      });
    } catch (error) {
      throw new Error(
        `No se pudo conectar con Ollama en ${this.baseUrl} (modelo ${this.model}). ` +
          `¿Está corriendo el servicio y se descargó el modelo con "ollama pull ${this.model}"? ` +
          `Detalle: ${error instanceof Error ? error.message : 'error desconocido'}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Ollama respondió ${response.status}: ${body || response.statusText}`,
      );
    }

    const payload = (await response.json()) as {
      message?: { content?: string };
    };
    const content = payload.message?.content;

    if (!content) {
      throw new Error('Ollama devolvió una respuesta vacía');
    }

    this.logger.warn(
      `Generando con modelo LOCAL Ollama (${this.model}) — los proveedores en la nube no respondieron`,
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('Ollama no devolvió un JSON válido');
    }

    return this.normalizeConfidenceValues(parsed);
  }

  /**
   * Modelos pequeños/cuantizados (ej. qwen2.5:1.5b) a veces devuelven
   * "confidence" como porcentaje (95) en vez de fracción (0.95), aunque el
   * JSON Schema declare maximum: 1. Eso rompe la validación Zod y tira todo
   * el plan a la basura. Como es un patrón de error consistente y acotado a
   * un solo campo, lo normalizamos en vez de fallar y caer a un proveedor en
   * la nube — el objetivo de Ollama es justo no depender de ellos.
   */
  private normalizeConfidenceValues(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeConfidenceValues(item));
    }
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).map(
        ([key, val]) => {
          if (key === 'confidence' && typeof val === 'number') {
            const normalized = val > 1 ? val / 100 : val;
            return [key, Math.min(1, Math.max(0, normalized))];
          }
          return [key, this.normalizeConfidenceValues(val)];
        },
      );
      return Object.fromEntries(entries);
    }
    return value;
  }
}
