import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

import { DetectedSchema } from '../sql-imports/types/detected-schema.type';
import {
  generationPlanSchema,
  GenerationPlanJson,
} from './schemas/generation-plan.schema';
import { SemanticRuleCandidateService } from './semantic-rule-candidate.service';
import { SemanticRuleCandidate } from './types/semantic-rule-candidate.type';

@Injectable()
export class GeminiSemanticAnalyzerService {
  private readonly ai: GoogleGenAI;
  private readonly model: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly semanticRuleCandidateService: SemanticRuleCandidateService,
  ) {
    const apiKey = this.configService.getOrThrow<string>('GEMINI_API_KEY');

    this.model =
      this.configService.get<string>('GEMINI_MODEL') ?? 'gemini-2.5-flash-lite';

    this.ai = new GoogleGenAI({
      apiKey,
    });
  }

  async analyzeSchema(schema: DetectedSchema): Promise<GenerationPlanJson> {
    const candidates = this.semanticRuleCandidateService.generate(schema);
    const prompt = this.buildPrompt(schema, candidates);

    try {
      const jsonSchema = z.toJSONSchema(generationPlanSchema);

      // Gemini acepta un subconjunto de JSON Schema.
      // Zod agrega "$schema", pero no la necesitamos para la petición.
      const { $schema, ...responseJsonSchema } = jsonSchema;

      const response = await this.ai.models.generateContent({
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

      const parsed = JSON.parse(response.text);

      return generationPlanSchema.parse(parsed);
    } catch (error) {
      throw new InternalServerErrorException(
        `No se pudo analizar la coherencia semántica con Gemini: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }

  private buildPrompt(
    schema: DetectedSchema,
    candidates: SemanticRuleCandidate[],
  ): string {
    return `
Eres un analista experto de esquemas PostgreSQL para generación de datos sintéticos.

Tu tarea es interpretar la semántica del esquema y producir un PLAN DE GENERACIÓN, no datos.

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
6. No devuelvas texto libre fuera del JSON solicitado.
7. Busca cadenas completas de reglas derivadas, no solo reglas aisladas.
8. Si una columna derivada alimenta otra columna derivada, debes devolver todas las reglas necesarias para mantener la cadena completa de coherencia.
9. No limites tu respuesta únicamente a los candidatos heurísticos.
10. Si detectas una regla importante que no aparece en los candidatos, debes incluirla igualmente en "rules".
11. Si un candidato contradice una interpretación más correcta del dominio, debes ignorarlo.
12. No dejes en "warnings" una regla fuerte y habitual del dominio si puede expresarse con una regla formal soportada.

Reglas estrictas sobre candidatos heurísticos:
- Si un candidato es coherente y común para el dominio, conviértelo en una regla formal dentro de "rules".
- Si un candidato es claramente incorrecto, ignóralo.
- Si un candidato propone copiar una columna agregada del padre hacia una columna individual del detalle, normalmente debes rechazarlo.
- Ejemplo incorrecto:
  detalle.descuento = cabecera.total_descuentos
- En esos casos suele ser más correcto:
  cabecera.total_descuentos = SUM(detalle.descuento)
- Si detectas una regla mejor que un candidato, prioriza la regla correcta.
- Si hay varios candidatos para la misma columna destino, elige solo el más semánticamente correcto.
- Si hay varios candidatos de fecha para el mismo campo, prioriza la fecha final del proceso si existe:
  cierre, vencimiento, fin o equivalente suelen ser más correctos que inicio.
- Si una tabla hija representa pagos y la tabla padre tiene una fecha de cierre, vencimiento o evento final, normalmente la fecha de pago debe ser igual o posterior a esa fecha final, no solo posterior a una fecha inicial.

Además de clasificar tablas y columnas:
- Para columnas textuales de dominio, cuando sea razonable, devuelve sampleValues realistas.
- Usa sampleValues para cosas como nombres de productos, tipos de cuenta, categorías, servicios, estados, tipos de documento, cargos, etc.
- No uses sampleValues para nombres de personas, correos, teléfonos ni identificadores.
- Para columnas numéricas, cuando sea razonable, devuelve numericMin y numericMax plausibles.
- Ejemplos:
  - cantidad de productos comprados: 1 a 5
  - stock: 10 a 100
  - notas académicas: 0 a 100
  - porcentajes: 0 a 100
  - horas trabajadas: acorde al máximo mensual si existe
- No inventes rangos extremos sin evidencia.
- Si no puedes inferir un rango con confianza, usa null en numericMin y numericMax.

Tipos de reglas permitidas:

A) COPY_FROM_REFERENCE
Sirve cuando una columna debe copiar su valor desde una tabla referenciada directamente por FK.
Ejemplos:
- detalle.precio_unitario toma producto.precio mediante producto_id
- detalle_nomina.tarifa_hora_aplicada toma empleados.tarifa_hora mediante empleado_id
- pagos_nomina.monto_pagado toma nominas.total_neto mediante nomina_id

Campos requeridos:
- targetTable
- targetColumn
- sourceTable
- sourceColumn
- viaForeignKey

B) BINARY_OPERATION
Sirve cuando una columna se obtiene de dos columnas de la misma fila.
Ejemplos:
- subtotal = cantidad * precio_unitario
- saldo = monto_original - total_pagado
- total_pago = capital_pagado + interes_pagado
- salario_bruto = horas_trabajadas * tarifa_hora_aplicada
- salario_neto = salario_bruto - descuento
- total_neto = total_bruto - total_descuentos

Campos requeridos:
- targetTable
- targetColumn
- leftColumn
- rightColumn
- operator

C) AGGREGATE_CHILDREN
Sirve cuando una columna de una tabla padre se calcula agregando valores de una tabla hija.
Ejemplos:
- factura.total = SUM(detalle.subtotal)
- prestamo.total_pagado = SUM(pagos.total_pago)
- nomina.total_bruto = SUM(detalle_nomina.salario_bruto)
- nomina.total_descuentos = SUM(detalle_nomina.descuento)
- pedido.cantidad_items = COUNT(detalle.id)

Campos requeridos:
- targetTable
- targetColumn
- childTable
- childForeignKey
- childColumn
- aggregate

D) DATE_RELATION
Sirve cuando una fecha depende de otra fecha dentro de la misma fila.
Ejemplos:
- fecha_vencimiento > fecha_desembolso
- fecha_cierre >= fecha_inicio
- fecha_fin > fecha_inicio

Campos requeridos:
- targetTable
- targetColumn
- referenceColumn
- dateRelation

E) REFERENCE_DATE_RELATION
Sirve cuando una fecha en una tabla hija debe depender de una fecha de una tabla padre referenciada por FK.
Ejemplos:
- pago.fecha_pago >= prestamo.fecha_desembolso mediante prestamo_id
- pagos_nomina.fecha_pago >= nominas.fecha_cierre mediante nomina_id
- entrega.fecha_entrega >= pedido.fecha_pedido mediante pedido_id

Campos requeridos:
- targetTable
- targetColumn
- sourceTable
- sourceColumn
- viaForeignKey
- dateRelation

F) REFERENCE_BOUND
Sirve cuando una columna numérica de una tabla debe respetar el límite de una columna numérica de una tabla referenciada.
Ejemplos:
- detalle.cantidad <= producto.stock mediante producto_id
- detalle_nomina.horas_trabajadas <= empleados.horas_maximas_mes mediante empleado_id

Campos requeridos:
- targetTable
- targetColumn
- sourceTable
- sourceColumn
- viaForeignKey
- boundOperator

Además:
- Clasifica cada tabla con un rol aproximado.
- Clasifica cada columna con un tipo semántico y un generador sugerido.
- Si una base parece contable, bancaria, académica, comercial, clínica, laboral, etc., descríbelo en domainSummary.
- No fuerces reglas de negocio si el esquema no ofrece evidencia suficiente.
- No uses reglas que dependan de valores categóricos desconocidos si no hay evidencia en el esquema.
- Si propones sampleValues, procura entre 5 y 12 valores realistas.
- Si una columna parece nombre de entidad de dominio, usa semanticType ENTITY_NAME y generatorHint SAMPLE_VALUES.
- Si una columna representa una categoría o tipo, usa semanticType CATEGORY y generatorHint SAMPLE_VALUES.
- Revisa especialmente si existen columnas como total, total_pagado, saldo, subtotal, importe, monto, descuento, salario, fecha_pago, fecha_vencimiento, fecha_cierre o similares, porque suelen formar cadenas de coherencia.

Esquema detectado:
${JSON.stringify(schema, null, 2)}

Candidatos heurísticos de reglas:
${JSON.stringify(candidates, null, 2)}
`;
  }
}
