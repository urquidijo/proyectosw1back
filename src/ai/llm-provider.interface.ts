/**
 * Contrato común para cualquier proveedor de IA (Claude, Gemini, ...).
 *
 * El motor de SynData NUNCA habla con un SDK concreto: pide JSON estructurado
 * a través de esta interfaz. Así se puede cambiar de proveedor o hacer fallback
 * sin tocar la lógica de generación.
 */
export interface LlmProvider {
  /** Nombre legible del proveedor, para logs ("claude" | "gemini" | "ollama"). */
  readonly name: string;

  /**
   * true si corre en la propia máquina/servidor (sin API key ni internet,
   * ej. Ollama). LlmService usa esto para avisar al usuario cuando el
   * resultado vino de un modelo local en vez de un proveedor en la nube.
   */
  readonly isLocal: boolean;

  /** Indica si el proveedor está configurado (tiene API key, o está habilitado). */
  isConfigured(): boolean;

  /**
   * Pide al modelo una respuesta que cumpla un JSON Schema dado.
   * @param prompt       Instrucción completa para el modelo.
   * @param jsonSchema   JSON Schema (derivado de Zod) que debe cumplir la salida.
   * @returns            El objeto JSON ya parseado (sin validar contra Zod todavía).
   */
  generateJson(prompt: string, jsonSchema: Record<string, unknown>): Promise<unknown>;
}
