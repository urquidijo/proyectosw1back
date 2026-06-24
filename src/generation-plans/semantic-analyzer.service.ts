import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { z } from 'zod';

import { LlmService } from '../ai/llm.service';
import { DetectedSchema } from '../sql-imports/types/detected-schema.type';
import {
  generationPlanSchema,
  GenerationPlanJson,
} from './schemas/generation-plan.schema';
import { SemanticRuleCandidateService } from './semantic-rule-candidate.service';
import { SemanticRuleCandidate } from './types/semantic-rule-candidate.type';

export type PlanLanguage = 'es' | 'en';

/**
 * Prefijo estable (no traducible, no depende de la redacción) que el
 * frontend usa para detectar y resaltar de forma distinta la advertencia de
 * "este plan se generó con IA local" en vez de tratarla como una advertencia
 * cualquiera. Si cambias el texto humano, NO cambies este prefijo.
 */
export const LOCAL_AI_WARNING_PREFIX = '[LOCAL_AI]';

/**
 * Analizador semántico del esquema. Es agnóstico del proveedor de IA: pide el
 * plan de generación a `LlmService`, que usa Claude (principal) o Gemini (respaldo).
 *
 * Además de clasificar tablas/columnas y detectar reglas, produce los "pools" de
 * valores de dominio (sampleValues) en el idioma elegido. Esos pools son la clave
 * del realismo a gran escala: la IA se llama UNA vez por esquema, y el motor local
 * muestrea los pools para llenar miles de filas sin volver a llamar a la IA.
 */
@Injectable()
export class SemanticAnalyzerService {
  constructor(
    private readonly llmService: LlmService,
    private readonly semanticRuleCandidateService: SemanticRuleCandidateService,
  ) {}

  async analyzeSchema(
    schema: DetectedSchema,
    language: PlanLanguage = 'es',
  ): Promise<GenerationPlanJson> {
    const candidates = this.semanticRuleCandidateService.generate(schema);
    const prompt = this.buildPrompt(schema, candidates, language);

    try {
      const jsonSchema = z.toJSONSchema(generationPlanSchema) as Record<
        string,
        unknown
      >;

      const result = await this.llmService.generateJson(
        prompt,
        jsonSchema,
        (data) => generationPlanSchema.parse(data),
      );

      if (result.isLocal) {
        // El usuario debe saber que este plan no lo generó Claude/Gemini,
        // sino un modelo local (Ollama) por respaldo. Se inserta como
        // advertencia porque es exactamente el mecanismo que ya existe en la
        // UI ("Coherencia IA") para avisar cosas a revisar antes de generar.
        return {
          ...result.data,
          warnings: [
            `${LOCAL_AI_WARNING_PREFIX} Este plan se generó con un modelo de IA LOCAL ("${result.provider}") porque los proveedores en la nube no estaban disponibles o no respondieron. La calidad de las reglas puede variar respecto a Claude/Gemini.`,
            ...result.data.warnings,
          ],
        };
      }

      return result.data;
    } catch (error) {
      throw new InternalServerErrorException(
        `No se pudo analizar la coherencia semántica: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }

  private buildPrompt(
    schema: DetectedSchema,
    candidates: SemanticRuleCandidate[],
    language: PlanLanguage,
  ): string {
    const languageInstruction =
      language === 'en'
        ? `IDIOMA DE LOS DATOS: INGLÉS (en).
- Todos los valores textuales que propongas en "sampleValues" deben estar en INGLÉS.
- domainSummary y notes pueden seguir en español (son metadatos internos), pero los
  sampleValues de nombres de productos, categorías, estados, tipos, etc. van en INGLÉS.`
        : `IDIOMA DE LOS DATOS: ESPAÑOL (es).
- Todos los valores textuales en "sampleValues" deben estar en ESPAÑOL de Latinoamérica.`;

    return `
Eres un analista experto de esquemas PostgreSQL para generación de datos sintéticos.

Tu tarea es interpretar la semántica del esquema y producir un PLAN DE GENERACIÓN, no datos.

${languageInstruction}

DETECCIÓN DE DOMINIO (importante):
- Identifica el dominio del negocio y decláralo al inicio de "domainSummary" con una etiqueta
  entre corchetes, por ejemplo: "[RETAIL]", "[HEALTH]", "[EDUCATION]", "[BANKING]",
  "[HOSPITALITY]", "[LOGISTICS]", "[HR]", "[GENERIC]".
- Usa ese dominio para que los sampleValues sean realistas para ESE rubro (no genéricos).

Los candidatos heurísticos son sugerencias adicionales, no sustituyen tu análisis propio del esquema.

Debes hacer dos cosas al mismo tiempo:
1. Detectar por tu cuenta todas las reglas semánticas que se desprendan del esquema.
2. Evaluar los candidatos heurísticos entregados por el sistema y aceptar solo los que sean coherentes.

Reglas estrictas:
1. Usa únicamente tablas y columnas que existan en el esquema entregado.
2. No inventes tablas, columnas ni relaciones.
3. Solo propón reglas si tienen confianza alta.
4. Si no estás seguro, deja la regla fuera y agrega una advertencia.
5. Las reglas deben ser genéricas y ejecutables por software.
5b. Todo campo "confidence" es una FRACCIÓN decimal entre 0 y 1 (ej: 0.95). NUNCA un porcentaje (95) ni un entero mayor a 1.
6. No devuelvas texto libre fuera del JSON solicitado.
7. Busca cadenas completas de reglas derivadas, no solo reglas aisladas.
8. Si una columna derivada alimenta otra columna derivada, devuelve todas las reglas necesarias para mantener la cadena completa de coherencia.
9. No limites tu respuesta únicamente a los candidatos heurísticos.
10. Si detectas una regla importante que no aparece en los candidatos, inclúyela igualmente en "rules".
11. Si un candidato contradice una interpretación más correcta del dominio, ignóralo.
12. No dejes en "warnings" una regla fuerte y habitual del dominio si puede expresarse con una regla formal soportada.

Reglas estrictas sobre candidatos heurísticos:
- Si un candidato es coherente y común para el dominio, conviértelo en una regla formal dentro de "rules".
- Si un candidato es claramente incorrecto, ignóralo.
- Si un candidato propone copiar una columna agregada del padre hacia una columna individual del detalle, normalmente debes rechazarlo.
- Ejemplo incorrecto: detalle.descuento = cabecera.total_descuentos
- En esos casos suele ser más correcto: cabecera.total_descuentos = SUM(detalle.descuento)
- Si hay varios candidatos para la misma columna destino, elige solo el más semánticamente correcto.
- Si hay varios candidatos de fecha para el mismo campo, prioriza la fecha final del proceso (cierre, vencimiento, fin) sobre la inicial.

POOLS DE VALORES DE DOMINIO (clave para el realismo):
- Para columnas textuales de dominio, devuelve sampleValues realistas y propios del rubro detectado.
- Usa sampleValues para: nombres de productos, categorías, tipos de cuenta, servicios, estados,
  tipos de documento, cargos, especialidades, departamentos, marcas, etc.
- Devuelve entre 6 y 12 sampleValues VARIADOS por columna categórica/de dominio, coherentes con el
  dominio y en el idioma indicado. No hace falta más: el motor los muestrea y recombina.
- NO uses sampleValues para nombres de personas, correos, teléfonos ni identificadores (esos los
  genera Faker localmente).
- Para columnas numéricas, cuando sea razonable, devuelve numericMin y numericMax plausibles.
  Ejemplos: cantidad comprada 1 a 5; stock 10 a 100; notas 0 a 100; porcentajes 0 a 100.
- No inventes rangos extremos sin evidencia; si no puedes inferir, usa null.

Tipos de reglas permitidas:

A) COPY_FROM_REFERENCE — una columna copia su valor desde una tabla referenciada por FK.
   Requeridos: targetTable, targetColumn, sourceTable, sourceColumn, viaForeignKey.

B) BINARY_OPERATION — una columna se obtiene de dos columnas de la misma fila (subtotal = cantidad * precio).
   Requeridos: targetTable, targetColumn, leftColumn, rightColumn, operator.

C) AGGREGATE_CHILDREN — columna del padre = agregación de una hija (factura.total = SUM(detalle.subtotal)).
   Requeridos: targetTable, targetColumn, childTable, childForeignKey, childColumn, aggregate.

D) DATE_RELATION — una fecha depende de otra fecha en la misma fila (fecha_fin > fecha_inicio).
   Requeridos: targetTable, targetColumn, referenceColumn, dateRelation.

E) REFERENCE_DATE_RELATION — una fecha de la hija depende de una fecha del padre por FK.
   Requeridos: targetTable, targetColumn, sourceTable, sourceColumn, viaForeignKey, dateRelation.

F) REFERENCE_BOUND — una columna numérica respeta el límite de una columna de la tabla referenciada
   (detalle.cantidad <= producto.stock).
   Requeridos: targetTable, targetColumn, sourceTable, sourceColumn, viaForeignKey, boundOperator.

Además:
- Clasifica cada tabla con un rol aproximado.
- Clasifica cada columna con un tipo semántico y un generador sugerido.
- Si una columna parece nombre de entidad de dominio, usa semanticType ENTITY_NAME y generatorHint SAMPLE_VALUES.
- Si una columna representa categoría o tipo, usa semanticType CATEGORY y generatorHint SAMPLE_VALUES.
- Revisa columnas como total, saldo, subtotal, importe, monto, descuento, salario, fecha_pago,
  fecha_vencimiento o similares, porque suelen formar cadenas de coherencia.

Esquema detectado:
${JSON.stringify(schema, null, 2)}

Candidatos heurísticos de reglas:
${JSON.stringify(candidates, null, 2)}
`;
  }
}
