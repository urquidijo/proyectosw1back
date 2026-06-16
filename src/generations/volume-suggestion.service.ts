import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DetectedSchema,
  DetectedTable,
} from '../sql-imports/types/detected-schema.type';
import { GenerationPlanJson } from '../generation-plans/schemas/generation-plan.schema';
import { enrichSchemaWithImplicitFks } from '../sql-imports/utils/schema-enricher';

/** Roles efectivos usados para decidir el volumen sugerido. */
type EffectiveRole =
  | 'REFERENCE'
  | 'MASTER'
  | 'TRANSACTION_HEADER'
  | 'TRANSACTION_DETAIL'
  | 'LEDGER'
  | 'BRIDGE'
  | 'EVENT'
  | 'UNKNOWN';

/** Volumen base por rol (luego se ajusta por proporciones de FK). */
const BASE_VOLUME_BY_ROLE: Record<EffectiveRole, number> = {
  REFERENCE: 10, // Catálogos pequeños (categorías, tipos, estados)
  MASTER: 150, // Maestras (clientes, productos, empleados)
  TRANSACTION_HEADER: 1000, // Cabeceras de transacción (ventas, pedidos)
  TRANSACTION_DETAIL: 3000, // Detalles (~3:1 respecto a la cabecera)
  LEDGER: 1000, // Registros históricos contables
  BRIDGE: 500, // Tablas puente (muchos a muchos)
  EVENT: 1000, // Eventos o logs de dominio
  UNKNOWN: 100, // Valor neutro por defecto
};

const CATALOG_KEYWORDS = [
  'categoria', 'categoría', 'tipo', 'type', 'estado', 'status', 'rol', 'role',
  'genero', 'género', 'gender', 'pais', 'país', 'country', 'ciudad', 'city',
  'departamento', 'marca', 'brand', 'nivel', 'grado', 'moneda', 'currency',
  'unidad', 'metodo_pago', 'forma_pago', 'especialidad',
];

const DETAIL_KEYWORDS = [
  'detalle', 'detail', 'linea', 'línea', 'line', 'item', 'renglon', 'renglón',
];

const TRANSACTION_KEYWORDS = [
  'venta', 'sale', 'pedido', 'order', 'factura', 'invoice', 'compra',
  'purchase', 'pago', 'payment', 'reserva', 'booking', 'movimiento',
  'transaccion', 'transacción', 'transaction', 'cita', 'inscripcion',
  'inscripción', 'matricula', 'matrícula',
];

const MASTER_KEYWORDS = [
  'usuario', 'user', 'cliente', 'customer', 'producto', 'product', 'empleado',
  'employee', 'proveedor', 'supplier', 'persona', 'person', 'articulo',
  'artículo', 'alumno', 'estudiante', 'student', 'profesor', 'teacher',
  'paciente', 'patient', 'cuenta', 'account',
];

@Injectable()
export class VolumeSuggestionService {
  constructor(private readonly prisma: PrismaService) {}

  async suggest(
    projectId: string,
    importId: string,
    userId: string,
  ): Promise<Record<string, number>> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, ownerId: userId },
    });

    if (!project) {
      throw new NotFoundException('Proyecto no encontrado');
    }

    const sqlImport = await this.prisma.sqlImport.findFirst({
      where: { id: importId, projectId },
    });

    if (!sqlImport || !sqlImport.schemaJson) {
      throw new NotFoundException('Importación SQL o esquema no detectado');
    }

    const schema = enrichSchemaWithImplicitFks(
      sqlImport.schemaJson as unknown as DetectedSchema,
    );

    // Roles del plan de IA (si se analizó). Pueden faltar o venir como UNKNOWN.
    const generationPlan = await this.prisma.generationPlan.findFirst({
      where: { sqlImportId: importId, projectId },
    });

    const plan = generationPlan?.planJson as unknown as
      | GenerationPlanJson
      | undefined;

    const planRoles: Record<string, string> = {};
    if (plan?.tables) {
      for (const t of plan.tables) {
        planRoles[t.table] = t.role;
      }
    }

    // Cuántas veces cada tabla es referenciada por una FK (para inferir catálogos).
    const referencedByCount = this.countReferences(schema);

    // 1. Rol efectivo: el del plan si es útil, si no, inferido por nombre + estructura.
    //    Luego se corrigen errores OBVIOS del plan con señales estructurales seguras
    //    (importante con modelos económicos como Haiku, que a veces clasifican mal).
    const effectiveRoles: Record<string, EffectiveRole> = {};
    for (const table of schema.tables) {
      const planRole = planRoles[table.name];
      const refBy = referencedByCount[table.name] ?? 0;

      const baseRole: EffectiveRole =
        planRole && planRole !== 'UNKNOWN'
          ? (planRole as EffectiveRole)
          : this.inferRole(table, refBy);

      effectiveRoles[table.name] = this.correctObviousRole(
        baseRole,
        table,
        refBy,
      );
    }

    // 2. Volumen base por rol efectivo.
    const suggestions: Record<string, number> = {};
    for (const table of schema.tables) {
      suggestions[table.name] = BASE_VOLUME_BY_ROLE[effectiveRoles[table.name]];
    }

    // 3. Ajuste proporcional de detalles y puentes según su tabla padre.
    for (const table of schema.tables) {
      const role = effectiveRoles[table.name];

      if (role !== 'TRANSACTION_DETAIL' && role !== 'BRIDGE') {
        continue;
      }

      const parentFk =
        table.foreignKeys.find(
          (fk) => effectiveRoles[fk.referencesTable] === 'TRANSACTION_HEADER',
        ) ??
        table.foreignKeys.find(
          (fk) => effectiveRoles[fk.referencesTable] === 'MASTER',
        );

      if (!parentFk) {
        continue;
      }

      const parentCount = suggestions[parentFk.referencesTable] ?? 100;

      suggestions[table.name] =
        role === 'TRANSACTION_DETAIL'
          ? parentCount * 3 // ~3 líneas por cabecera
          : Math.min(parentCount * 2, 2000); // puente acotado
    }

    // 4. Respetar el tope del sistema (10.000 filas por tabla).
    for (const name of Object.keys(suggestions)) {
      suggestions[name] = Math.min(Math.max(suggestions[name], 1), 10000);
    }

    return suggestions;
  }

  /** Cuenta cuántas FK de otras tablas apuntan a cada tabla. */
  private countReferences(schema: DetectedSchema): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const table of schema.tables) {
      for (const fk of table.foreignKeys) {
        counts[fk.referencesTable] = (counts[fk.referencesTable] ?? 0) + 1;
      }
    }

    return counts;
  }

  /**
   * Infiere el rol de una tabla cuando el plan de IA no lo aporta, combinando
   * el nombre de la tabla con su estructura (FKs, PK compuesta, referencias).
   */
  private inferRole(
    table: DetectedTable,
    referencedByCount: number,
  ): EffectiveRole {
    const name = table.name.toLowerCase();
    const fkCount = table.foreignKeys.length;
    const pkCount = table.primaryKeys.length;
    const columnCount = table.columns.length;

    const matches = (keywords: string[]) => keywords.some((k) => name.includes(k));

    // Catálogo por nombre (categorías, tipos, estados...).
    if (matches(CATALOG_KEYWORDS)) {
      return 'REFERENCE';
    }

    // Detalle de transacción (nombre de detalle/línea y al menos una FK).
    // Se evalúa antes que BRIDGE: un "detalle_ventas" con PK compuesta es detalle, no puente.
    if (matches(DETAIL_KEYWORDS) && fkCount >= 1) {
      return 'TRANSACTION_DETAIL';
    }

    // Tabla puente: PK compuesta apoyada en varias FK (ej. profesor_materia).
    if (pkCount >= 2 && fkCount >= 2) {
      return 'BRIDGE';
    }

    // Cabecera de transacción por nombre.
    if (matches(TRANSACTION_KEYWORDS)) {
      return 'TRANSACTION_HEADER';
    }

    // Maestra por nombre (se evalúa antes que la regla estructural de catálogo,
    // para que "clientes" o "productos" no se confundan con un catálogo pequeño).
    if (matches(MASTER_KEYWORDS)) {
      return 'MASTER';
    }

    // Sin FK, pequeña y referenciada por otras → catálogo.
    if (fkCount === 0 && referencedByCount > 0 && columnCount <= 5) {
      return 'REFERENCE';
    }

    // Heurística estructural final: con FKs parece transaccional; sin FKs, maestra.
    return fkCount >= 1 ? 'TRANSACTION_HEADER' : 'MASTER';
  }

  /**
   * Corrige errores OBVIOS de clasificación usando solo señales estructurales
   * casi seguras. No reinterpreta el dominio (eso lo deja al plan); únicamente
   * descarta roles imposibles o contradictorios. Pensado para blindar la
   * sugerencia cuando el plan viene de un modelo económico.
   */
  private correctObviousRole(
    role: EffectiveRole,
    table: DetectedTable,
    referencedByCount: number,
  ): EffectiveRole {
    const name = table.name.toLowerCase();
    const fkColumns = new Set(table.foreignKeys.map((fk) => fk.column));
    const fkCount = table.foreignKeys.length;
    const pkCount = table.primaryKeys.length;
    const columnCount = table.columns.length;
    const matches = (keywords: string[]) =>
      keywords.some((k) => name.includes(k));

    // 1. Puente seguro: PK compuesta donde TODAS las columnas PK son FKs y
    //    SIN payload (casi sin columnas extra). Si tiene columnas adicionales
    //    (cantidad, subtotal...), es un detalle de transacción, no un puente.
    const pkAllAreFks =
      pkCount >= 2 && table.primaryKeys.every((pk) => fkColumns.has(pk));
    const hasNoPayload = columnCount <= fkCount + 1;
    if (pkAllAreFks && fkCount >= 2 && hasNoPayload) {
      return 'BRIDGE';
    }

    // 2. Nombre de detalle/línea + FK: nunca es catálogo ni maestra.
    if (
      matches(DETAIL_KEYWORDS) &&
      fkCount >= 1 &&
      (role === 'REFERENCE' || role === 'MASTER')
    ) {
      return 'TRANSACTION_DETAIL';
    }

    // 3. Nombre de catálogo y SIN FKs salientes: es un catálogo, diga lo que diga
    //    el plan (ej. "categorias" marcada como MASTER por error).
    if (matches(CATALOG_KEYWORDS) && fkCount === 0) {
      return 'REFERENCE';
    }

    // 4. Marcada como transaccional/evento pero SIN ninguna FK: imposible, no
    //    tiene tabla padre a la cual referirse. Se degrada a catálogo o maestra.
    const isTransactional =
      role === 'TRANSACTION_HEADER' ||
      role === 'TRANSACTION_DETAIL' ||
      role === 'LEDGER' ||
      role === 'EVENT';
    if (isTransactional && fkCount === 0) {
      return referencedByCount > 0 && columnCount <= 6 ? 'REFERENCE' : 'MASTER';
    }

    return role;
  }
}
