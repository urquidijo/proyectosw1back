import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';

import { LlmProvider } from './llm-provider.interface';

/**
 * Proveedor alternativo: Groq.
 *
 * Utiliza el SDK oficial de Groq. Para obtener JSON, le pasamos el JSON Schema
 * al modelo en el prompt y habilitamos el modo JSON.
 */
@Injectable()
export class GroqProvider implements LlmProvider {
  readonly name = 'groq';

  private readonly logger = new Logger(GroqProvider.name);
  private readonly client: Groq | null;
  private readonly model: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GROQ_API_KEY');
    this.model =
      this.configService.get<string>('GROQ_MODEL') ?? 'llama-3.3-70b-versatile';

    this.client = apiKey ? new Groq({ apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async generateJson(
    prompt: string,
    jsonSchema: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.client) {
      throw new Error('GROQ_API_KEY no está configurada');
    }

    const { $schema: _ignored, ...inputSchema } = jsonSchema as Record<
      string,
      unknown
    >;

    // Groq requiere que la palabra "JSON" esté en el prompt para usar el json_object format
    const promptWithSchema = `${prompt}

MUY IMPORTANTE: Responde ÚNICAMENTE con un objeto JSON válido que cumpla estrictamente con el siguiente JSON Schema. No incluyas texto antes ni después del JSON.
NO anides tu respuesta bajo una llave "properties" ni "schema". Devuelve directamente una instancia con los datos finales en la raíz.

JSON Schema esperado:
${JSON.stringify(inputSchema, null, 2)}
`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: promptWithSchema }],
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('Groq devolvió una respuesta vacía');
    }

    try {
      return JSON.parse(content);
    } catch (e) {
      this.logger.error('Error parseando JSON de Groq', content);
      throw new Error('Groq no devolvió un JSON válido');
    }
  }
}
