import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

import { LlmProvider } from './llm-provider.interface';

/**
 * Proveedor PRINCIPAL: Claude (Anthropic).
 *
 * Para obtener JSON 100% estructurado usamos "tool use" forzado: declaramos una
 * herramienta cuyo input_schema es el JSON Schema esperado y obligamos al modelo
 * a llamarla. Claude devuelve entonces el objeto en `tool_use.input`, sin texto
 * libre que haya que sanear.
 */
@Injectable()
export class ClaudeProvider implements LlmProvider {
  readonly name = 'claude';

  private readonly logger = new Logger(ClaudeProvider.name);
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    this.model =
      this.configService.get<string>('CLAUDE_MODEL') ?? 'claude-haiku-4-5';
    this.maxTokens = Number(
      this.configService.get<string>('CLAUDE_MAX_TOKENS') ?? '16000',
    );

    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async generateJson(
    prompt: string,
    jsonSchema: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.client) {
      throw new Error('ANTHROPIC_API_KEY no está configurada');
    }

    // input_schema de la tool debe ser un JSON Schema de tipo objeto.
    // Quitamos "$schema" que Zod agrega y que la API no necesita.
    const { $schema: _ignored, ...inputSchema } = jsonSchema as Record<
      string,
      unknown
    >;

    // Streaming: evita timeouts del SDK en respuestas largas (planes grandes).
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: 0.2,
      tools: [
        {
          name: 'emit_result',
          description:
            'Devuelve el resultado estructurado solicitado. Úsala siempre.',
          input_schema: inputSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: 'emit_result' },
      messages: [{ role: 'user', content: prompt }],
    });

    const response = await stream.finalMessage();

    this.logger.debug(
      `Claude (${this.model}) tokens in/out: ${response.usage.input_tokens}/${response.usage.output_tokens} (stop: ${response.stop_reason})`,
    );

    // Si la respuesta se cortó por límite de tokens, el JSON queda incompleto.
    // Lanzamos error para que el orquestador haga fallback (Gemini) en vez de
    // devolver un plan truncado e inválido.
    if (response.stop_reason === 'max_tokens') {
      throw new Error(
        `Respuesta truncada por max_tokens (${this.maxTokens}); el esquema es demasiado grande. Aumenta CLAUDE_MAX_TOKENS o reduce el esquema.`,
      );
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (!toolUse) {
      throw new Error('Claude no devolvió un bloque tool_use con el resultado');
    }

    return toolUse.input;
  }
}
