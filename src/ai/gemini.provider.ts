import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

import { LlmProvider } from './llm-provider.interface';

/**
 * Proveedor de RESPALDO: Gemini (Google).
 *
 * Usa `responseJsonSchema` para forzar salida JSON. Es el comportamiento que ya
 * existía en el Sprint 1; ahora vive detrás de la interfaz común.
 */
@Injectable()
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  readonly isLocal = false;

  private readonly logger = new Logger(GeminiProvider.name);
  private readonly client: GoogleGenAI | null;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    this.model =
      this.configService.get<string>('GEMINI_MODEL') ?? 'gemini-2.5-flash-lite';

    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async generateJson(
    prompt: string,
    jsonSchema: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.client) {
      throw new Error('GEMINI_API_KEY no está configurada');
    }

    // Gemini acepta un subconjunto de JSON Schema; "$schema" no es necesario.
    const { $schema: _ignored, ...responseJsonSchema } = jsonSchema as Record<
      string,
      unknown
    >;

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema,
        temperature: 0.1,
      },
    });

    if (!response.text) {
      throw new Error('Gemini devolvió una respuesta vacía');
    }

    this.logger.debug(`Gemini (${this.model}) respondió correctamente`);

    return JSON.parse(response.text);
  }
}
