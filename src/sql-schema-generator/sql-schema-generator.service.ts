import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

import { PrismaService } from '../prisma/prisma.service';
import {
  generatedSqlSchema,
  GeneratedSqlSchemaResponse,
} from './schemas/generated-sql-schema.schema';

@Injectable()
export class SqlSchemaGeneratorService {
  private readonly ai: GoogleGenAI;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.getOrThrow<string>('GEMINI_API_KEY');

    this.model =
      this.configService.get<string>('GEMINI_MODEL') ??
      'gemini-2.5-flash-lite';

    this.ai = new GoogleGenAI({
      apiKey,
    });
  }

  async generateFromNaturalLanguage(
    projectId: string,
    userId: string,
    description: string,
    dialect: 'POSTGRESQL' | 'MYSQL' = 'POSTGRESQL',
  ): Promise<GeneratedSqlSchemaResponse> {
    await this.ensureProjectBelongsToUser(projectId, userId);

    if (!description.trim()) {
      throw new BadRequestException('La descripción no puede estar vacía');
    }

    const prompt = this.buildPrompt(description, dialect);

    try {
      const jsonSchema = z.toJSONSchema(generatedSqlSchema);
      const { $schema, ...responseJsonSchema } = jsonSchema;

      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema,
          temperature: 0.2,
        },
      });

      if (!response.text) {
        throw new Error('Gemini devolvió una respuesta vacía');
      }

      const parsed = JSON.parse(response.text);
      const result = generatedSqlSchema.parse(parsed);

      return {
        ...result,
        sql: this.cleanSql(result.sql),
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `No se pudo generar el esquema SQL: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }

  private buildPrompt(
    description: string,
    dialect: 'POSTGRESQL' | 'MYSQL',
  ): string {
    const isMysql = dialect === 'MYSQL';
    const dialectName = isMysql ? 'MySQL' : 'PostgreSQL';

    const primaryKeyRule = isMysql
      ? 'id INT NOT NULL AUTO_INCREMENT, definida luego como PRIMARY KEY (id)'
      : 'id SERIAL PRIMARY KEY';

    const typeRules = isMysql
      ? `   - VARCHAR(n) para textos cortos
   - TEXT para descripciones largas
   - INT para cantidades enteras
   - DECIMAL(10,2) o DECIMAL(12,2) para dinero
   - DATE para fechas
   - DATETIME para fecha y hora
   - TINYINT(1) para estados lógicos (booleanos)`
      : `   - VARCHAR(n) para textos cortos
   - TEXT para descripciones largas
   - INT para cantidades enteras
   - DECIMAL(10,2) o DECIMAL(12,2) para dinero
   - DATE para fechas
   - BOOLEAN para estados lógicos`;

    const executionRule = isMysql
      ? 'El SQL debe poder ejecutarse en MySQL 8 sin depender de extensiones externas.'
      : 'El SQL debe poder ejecutarse en PostgreSQL sin depender de extensiones externas.';

    return `
Eres un arquitecto experto en bases de datos ${dialectName}.

Tu tarea es convertir una descripción en lenguaje natural en un script DDL ${dialectName} completo, claro y utilizable.

Objetivo:
Generar un esquema relacional para ${dialectName} que pueda ser analizado después por un sistema de generación de datos sintéticos.

Reglas estrictas de salida:
1. Devuelve únicamente el JSON solicitado por el esquema de respuesta.
2. El campo "sql" debe contener solo SQL ${dialectName} válido${isMysql ? ' (no mezcles sintaxis de PostgreSQL como SERIAL, RETURNING o ::cast)' : ''}.
3. No uses Markdown, no uses bloques de código, no uses explicaciones dentro de "sql".
4. No generes INSERT, UPDATE, DELETE, DROP, ALTER, VIEW, FUNCTION, PROCEDURE ni TRIGGER.
5. Usa solo sentencias CREATE TABLE.
6. Usa nombres en snake_case y en español si la descripción está en español.
7. Evita palabras reservadas como user, order, group, table, etc.
8. Crea primero las tablas padre y luego las tablas hijas.
9. Cada tabla debe tener una clave primaria.
10. Usa preferentemente:
   ${primaryKeyRule}
11. Toda relación relevante debe tener FOREIGN KEY mediante:
   columna_id INT NOT NULL REFERENCES tabla_padre(id)
12. Usa NOT NULL cuando el dato sea claramente obligatorio.
13. Usa UNIQUE cuando sea razonable:
   - email
   - placa
   - codigo
   - numero_documento
   - campos que representen identificadores naturales únicos
14. Usa CHECK simples cuando aporten integridad:
   - montos >= 0
   - precios >= 0
   - cantidades >= 0
   - porcentajes entre 0 y 100
   - fechas no requieren CHECK por ahora si dependen de otra columna
15. Usa tipos ${dialectName} apropiados:
${typeRules}
16. El esquema debe ser suficientemente rico para representar bien el dominio, pero no excesivamente grande.
17. Si la descripción implica cabecera/detalle, modela ambas tablas.
18. Si la descripción implica pagos, movimientos, productos, servicios, préstamos, citas, etc., crea las relaciones necesarias.
19. No inventes datos; solo estructura.
20. ${executionRule}

Criterios de calidad:
- El diseño debe tener sentido lógico.
- Las relaciones deben ser coherentes.
- Las tablas deben tener nombres claros.
- Las FK deben apuntar a tablas existentes.
- El esquema debe estar listo para que luego se puedan generar datos sintéticos coherentes.

Debes devolver:
- title: nombre breve del dominio de la base
- summary: resumen breve de lo que modela el esquema
- sql: script ${dialectName} completo
- assumptions: supuestos que tomaste al diseñar el esquema

Descripción del usuario:
${description}
`;
  }

  private cleanSql(sql: string): string {
    return sql
      .replace(/^```sql\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();
  }

  private async ensureProjectBelongsToUser(
    projectId: string,
    userId: string,
  ) {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        ownerId: userId,
      },
    });

    if (!project) {
      throw new NotFoundException('Proyecto no encontrado');
    }

    return project;
  }
}