import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DetectedColumn,
  DetectedSchema,
  DetectedTable,
} from '../sql-imports/types/detected-schema.type';
import { randomUUID } from 'crypto';
import { GenerationPlanExecutorService } from './generation-plan-executor.service';
import { GenerationPlanJson } from '../generation-plans/schemas/generation-plan.schema';
import {
  getFakerInstance,
  bolivianCities,
  isEnglishRegion,
} from './localization/locale-map';
import { Faker } from '@faker-js/faker';
import { enrichSchemaWithImplicitFks } from '../sql-imports/utils/schema-enricher';

type GeneratedValue = string | number | boolean | null;
type GeneratedRow = Record<string, GeneratedValue>;

type GenerationEngineResult = {
  orderedTables: string[];
  rowsByTable: Record<string, GeneratedRow[]>;
  preview: Record<string, GeneratedRow[]>;
  outputSql: string;
};

type PersonContext = {
  firstName: string;
  lastName: string;
  fullName: string;
};

/** Regla manual definida por el usuario para una columna (UI de "reglas configurables por columna"). */
export type ColumnOverrideRule = {
  type?: string;
  nullable?: boolean;
  unique?: boolean;
  min?: number | string;
  max?: number | string;
  values?: string[];
  nullRate?: number;
};

export type ColumnRulesInput = {
  tables: Record<
    string,
    {
      columns?: Record<string, ColumnOverrideRule>;
    }
  >;
};

/** Las reglas manuales tienen prioridad absoluta sobre el plan de IA y las heurísticas genéricas. */
const NO_RULE_OVERRIDE = Symbol('no-rule-override');

@Injectable()
export class SyntheticDataGeneratorService {
  constructor(
    private readonly generationPlanExecutor: GenerationPlanExecutorService,
  ) {}

  private readonly statuses = ['ACTIVO', 'INACTIVO', 'PENDIENTE', 'COMPLETADO'];
  private readonly statusesEn = ['ACTIVE', 'INACTIVE', 'PENDING', 'COMPLETED'];

  /** Estados por defecto según el idioma de la región. */
  private pickStatus(regionName?: string): string {
    return isEnglishRegion(regionName)
      ? this.pick(this.statusesEn)
      : this.pick(this.statuses);
  }

  generate(
    schema: DetectedSchema,
    rowConfig: Record<string, number>,
    plan?: GenerationPlanJson | null,
    region?: string,
    columnRules?: ColumnRulesInput | null,
  ): GenerationEngineResult {
    const enrichedSchema = enrichSchemaWithImplicitFks(schema);
    const { faker, regionName } = getFakerInstance(region);
    const orderedTableObjects = this.sortTablesByDependencies(enrichedSchema.tables);
    const rowsByTableMap = new Map<string, GeneratedRow[]>();

    for (const table of orderedTableObjects) {
      const count = rowConfig[table.name];
      const rows: GeneratedRow[] = [];

      const uniqueValuesByColumn = new Map<string, Set<any>>();
      for (const col of table.columns) {
        uniqueValuesByColumn.set(col.name, new Set<any>());
      }

      const generatedCompositeKeys = new Set<string>();

      // Las tablas puente (PK compuesta) necesitan FKs puramente aleatorias para
      // poder reintentar combinaciones hasta encontrar una tupla única; el resto
      // de tablas usa asignación con cobertura garantizada (ver buildForeignKeyAssignments).
      const isBridgeTable = !!(table.primaryKeys && table.primaryKeys.length > 1);
      const fkAssignments = isBridgeTable
        ? undefined
        : this.buildForeignKeyAssignments(table, count, rowsByTableMap);

      for (let index = 1; index <= count; index++) {
        let row = this.generateRow(
          table,
          index,
          rowsByTableMap,
          rows,
          plan,
          faker,
          regionName,
          uniqueValuesByColumn,
          fkAssignments,
          columnRules,
        );

        // Si tiene clave primaria compuesta, garantizar unicidad de la tupla
        if (table.primaryKeys && table.primaryKeys.length > 1) {
          let attempts = 0;
          let keyString = table.primaryKeys.map(k => String(row[k])).join('|');
          while (generatedCompositeKeys.has(keyString) && attempts < 50) {
            row = this.generateRow(
              table,
              index,
              rowsByTableMap,
              rows,
              plan,
              faker,
              regionName,
              uniqueValuesByColumn,
              fkAssignments,
              columnRules,
            );
            keyString = table.primaryKeys.map(k => String(row[k])).join('|');
            attempts++;
          }
          generatedCompositeKeys.add(keyString);
        }

        rows.push(row);
      }

      rowsByTableMap.set(table.name, rows);
    }

    this.generationPlanExecutor.applyPlan(enrichedSchema, rowsByTableMap, plan);

    // Aplicar heurísticas lógicas de negocio (precios, subtotales, totales agregados)
    this.applyBusinessHeuristics(enrichedSchema, rowsByTableMap);

    const rowsByTable = Object.fromEntries(rowsByTableMap.entries());

    const preview = Object.fromEntries(
      Object.entries(rowsByTable).map(([tableName, rows]) => [
        tableName,
        rows.slice(0, 5),
      ]),
    );

    const outputSql = this.buildSqlFile(orderedTableObjects, rowsByTableMap);

    return {
      orderedTables: orderedTableObjects.map((table) => table.name),
      rowsByTable,
      preview,
      outputSql,
    };
  }

  private generateRow(
    table: DetectedTable,
    rowIndex: number,
    generatedRowsByTable: Map<string, GeneratedRow[]>,
    currentTableRows: GeneratedRow[],
    plan?: GenerationPlanJson | null,
    faker?: Faker,
    regionName?: string,
    uniqueValuesByColumn?: Map<string, Set<any>>,
    fkAssignments?: Map<string, GeneratedValue[]>,
    columnRules?: ColumnRulesInput | null,
  ): GeneratedRow {
    const activeFaker = faker || getFakerInstance().faker;
    const activeRegion = regionName || 'GENERIC';

    const row: GeneratedRow = {};
    const person = this.createPersonContext(activeFaker);

    // Identity Pooling para usuarios enlazados
    let linkedPersonRow: any = null;
    let linkedPersonRole: string | null = null;
    const tableNameLower = table.name.toLowerCase();

    if (tableNameLower === 'usuarios' || tableNameLower === 'users') {
      const students = generatedRowsByTable.get('estudiantes') || generatedRowsByTable.get('estudiante') || [];
      const teachers = generatedRowsByTable.get('profesores') || generatedRowsByTable.get('profesor') || [];
      const totalPeople = students.length + teachers.length;
      if (totalPeople > 0) {
        const index = (rowIndex - 1) % totalPeople;
        if (index < students.length) {
          linkedPersonRow = students[index];
          linkedPersonRole = 'estudiante';
        } else {
          linkedPersonRow = teachers[index - students.length];
          linkedPersonRole = 'profesor';
        }
      }
    }

    for (const column of table.columns) {
      row[column.name] = this.generateColumnValue(
        table,
        column,
        rowIndex,
        person,
        generatedRowsByTable,
        currentTableRows,
        plan,
        activeFaker,
        activeRegion,
        uniqueValuesByColumn,
        linkedPersonRow,
        linkedPersonRole,
        fkAssignments,
        columnRules,
      );
    }

    return row;
  }

  private generateColumnValue(
    table: DetectedTable,
    column: DetectedColumn,
    rowIndex: number,
    person: PersonContext,
    generatedRowsByTable: Map<string, GeneratedRow[]>,
    currentTableRows: GeneratedRow[],
    plan?: GenerationPlanJson | null,
    faker?: Faker,
    regionName?: string,
    uniqueValuesByColumn?: Map<string, Set<any>>,
    linkedPersonRow?: any,
    linkedPersonRole?: string | null,
    fkAssignments?: Map<string, GeneratedValue[]>,
    columnRules?: ColumnRulesInput | null,
  ): GeneratedValue {
    const activeFaker = faker || getFakerInstance().faker;
    const activeRegion = regionName || 'GENERIC';

    let value = this.generateBaseColumnValue(
      table,
      column,
      rowIndex,
      person,
      generatedRowsByTable,
      currentTableRows,
      plan,
      activeFaker,
      activeRegion,
      linkedPersonRow,
      linkedPersonRole,
      fkAssignments,
      columnRules,
    );

    const columnRule = this.getColumnRule(table, column, columnRules);

    // Nulos forzados por regla manual. Antes de la unicidad porque NULL nunca
    // necesita pasar por el ciclo de deduplicación.
    if (
      columnRule?.nullable &&
      column.isNullable &&
      value !== null &&
      Math.random() < this.resolveNullRate(columnRule.nullRate)
    ) {
      value = null;
    }

    // Forzar unicidad en columnas que lo requieren, en CUALQUIER tabla:
    //  - columnas marcadas UNIQUE en el DDL (ci, email, placa, username, ...)
    //  - claves primarias
    //  - heurística de nombre para tablas de parametrización (REFERENCE)
    //  - "Único" marcado manualmente en la regla de columna
    const isReferenceTable =
      plan?.tables.find((t) => t.table === table.name)?.role === 'REFERENCE';
    const columnName = column.name.toLowerCase();
    const isReferenceNameCandidate =
      isReferenceTable &&
      (columnName === 'nombre' ||
        columnName === 'name' ||
        columnName === 'codigo' ||
        columnName === 'code' ||
        columnName === 'sigla' ||
        columnName === 'key');

    const mustBeUnique =
      column.isUnique ||
      column.isPrimaryKey ||
      isReferenceNameCandidate ||
      Boolean(columnRule?.unique);

    // En PostgreSQL múltiples NULL NO violan UNIQUE, así que solo deduplicamos no-nulos.
    if (mustBeUnique && uniqueValuesByColumn && value !== null) {
      const usedSet = uniqueValuesByColumn.get(column.name);
      if (usedSet) {
        let uniqueVal: GeneratedValue = value;
        let attempts = 0;

        // 1) Intentar regenerar un valor distinto.
        while (usedSet.has(uniqueVal) && attempts < 30) {
          uniqueVal = this.generateBaseColumnValue(
            table,
            column,
            rowIndex,
            person,
            generatedRowsByTable,
            currentTableRows,
            plan,
            activeFaker,
            activeRegion,
            linkedPersonRow,
            linkedPersonRole,
            fkAssignments,
            columnRules,
          );
          attempts++;
        }

        // 2) Si sigue colisionando (ej. sampleValues con pocos valores), forzar
        //    unicidad con un sufijo/incremento garantizado.
        if (usedSet.has(uniqueVal)) {
          uniqueVal = this.forceUniqueValue(uniqueVal, value, usedSet, rowIndex);
        }

        usedSet.add(uniqueVal);
        value = uniqueVal;
      }
    }

    return value;
  }

  private getColumnRule(
    table: DetectedTable,
    column: DetectedColumn,
    columnRules?: ColumnRulesInput | null,
  ): ColumnOverrideRule | undefined {
    return columnRules?.tables?.[table.name]?.columns?.[column.name];
  }

  /** nullRate llega como porcentaje (0-100) desde el frontend; 10% por defecto si no se especifica. */
  private resolveNullRate(nullRate: number | undefined): number {
    if (nullRate === undefined || !Number.isFinite(nullRate)) return 0.1;
    return Math.min(1, Math.max(0, nullRate / 100));
  }

  /** Garantiza un valor único cuando la regeneración no alcanza (pool pequeño). */
  private forceUniqueValue(
    current: GeneratedValue,
    original: GeneratedValue,
    usedSet: Set<GeneratedValue>,
    rowIndex: number,
  ): GeneratedValue {
    if (typeof current === 'number') {
      let candidate = current;
      while (usedSet.has(candidate)) candidate += 1;
      return candidate;
    }

    const base = String(original ?? current ?? 'val');

    // Si el valor termina en un número (ej. "FAC-2024-002"), incrementamos ESE
    // número preservando el ancho de relleno en vez de concatenar el rowIndex
    // crudo al final (lo que producía códigos corruptos como "FAC-2024-00410").
    const trailingDigitsMatch = base.match(/^(.*?)(\d+)$/);
    if (trailingDigitsMatch) {
      const [, prefix, digits] = trailingDigitsMatch;
      const width = digits.length;
      let counter = parseInt(digits, 10) + 1;
      let candidate = `${prefix}${String(counter).padStart(width, '0')}`;
      while (usedSet.has(candidate)) {
        counter += 1;
        candidate = `${prefix}${String(counter).padStart(width, '0')}`;
      }
      return candidate;
    }

    let counter = rowIndex;
    let candidate = `${base}-${counter}`;
    while (usedSet.has(candidate)) {
      counter += 1;
      candidate = `${base}-${counter}`;
    }
    return candidate;
  }

  private generateBaseColumnValue(
    table: DetectedTable,
    column: DetectedColumn,
    rowIndex: number,
    person: PersonContext,
    generatedRowsByTable: Map<string, GeneratedRow[]>,
    currentTableRows: GeneratedRow[],
    plan?: GenerationPlanJson | null,
    faker?: Faker,
    regionName?: string,
    linkedPersonRow?: any,
    linkedPersonRole?: string | null,
    fkAssignments?: Map<string, GeneratedValue[]>,
    columnRules?: ColumnRulesInput | null,
  ): GeneratedValue {
    const activeFaker = faker || getFakerInstance().faker;
    const activeRegion = regionName || 'GENERIC';

    if (column.references) {
      return this.generateForeignKeyValue(
        table.name,
        column,
        rowIndex,
        generatedRowsByTable,
        currentTableRows,
        fkAssignments,
      );
    }

    // Las FK implícitas ahora se resuelven antes de la generación y se manejan como FK normales

    const tableNameLower = table.name.toLowerCase();
    const columnName = column.name.toLowerCase();

    // Detección de primer nombre vs apellido.
    // "nombre" a secas solo se interpreta como "primer nombre" si la tabla
    // tiene una columna hermana de apellido; si no existe, "nombre" es el
    // nombre completo (caso típico de clientes/usuarios con un solo campo).
    const hasLastNameSiblingColumn = table.columns.some((c) => {
      const siblingName = c.name.toLowerCase();
      return (
        siblingName === 'apellido' ||
        siblingName === 'apellidos' ||
        siblingName === 'last_name' ||
        siblingName === 'lastname' ||
        siblingName === 'paterno' ||
        siblingName === 'materno'
      );
    });

    const isFirstName =
      (columnName === 'nombre' && hasLastNameSiblingColumn) ||
      columnName === 'primer_nombre' ||
      columnName === 'firstname' ||
      columnName === 'first_name' ||
      columnName === 'nombres';

    const isLastName =
      columnName === 'apellido' ||
      columnName === 'apellidos' ||
      columnName === 'last_name' ||
      columnName === 'lastname' ||
      columnName === 'paterno' ||
      columnName === 'materno';

    // 0. Reglas manuales configuradas por el usuario para esta columna: tienen
    //    prioridad absoluta sobre el plan de IA y cualquier heurística genérica
    //    (excepto en claves primarias, que deben conservar su estrategia de
    //    generación para no romper la unicidad/orden de inserción).
    if (!column.isPrimaryKey) {
      const columnRule = this.getColumnRule(table, column, columnRules);

      if (columnRule?.type) {
        const overrideValue = this.applyColumnRuleType(
          columnRule,
          rowIndex,
          isFirstName,
          isLastName,
          person,
          activeFaker,
          activeRegion,
        );

        if (overrideValue !== NO_RULE_OVERRIDE) {
          return overrideValue;
        }
      }
    }

    // A. Identidad Vinculada para Usuarios
    if (linkedPersonRow) {
      if (columnName.includes('nombre_usuario') || columnName === 'username' || columnName === 'usuario') {
        const cleanNombres = this.cleanText(linkedPersonRow.nombres || linkedPersonRow.nombre || '');
        const cleanApellidos = this.cleanText(linkedPersonRow.apellidos || linkedPersonRow.apellido || '');
        return cleanNombres && cleanApellidos ? `${cleanNombres}.${cleanApellidos}` : `user_${rowIndex}`;
      }
      if (columnName.includes('rol') || columnName === 'role' || columnName === 'tipo_usuario') {
        return linkedPersonRole || 'estudiante';
      }
      if (columnName.includes('email') || columnName.includes('correo')) {
        return linkedPersonRow.email || linkedPersonRow.correo || `user_${rowIndex}@example.com`;
      }
      if (columnName === 'id_estudiante' || columnName === 'estudiante_id') {
        if (linkedPersonRole === 'estudiante') {
          return linkedPersonRow.id || linkedPersonRow.id_estudiante || linkedPersonRow.id_usuario || rowIndex;
        }
      }
      if (columnName === 'id_profesor' || columnName === 'profesor_id') {
        if (linkedPersonRole === 'profesor') {
          return linkedPersonRow.id || linkedPersonRow.id_profesor || linkedPersonRow.id_usuario || rowIndex;
        }
      }
    }

    // B. Diccionarios de dominio en español para Materias, Cursos y Aulas.
    //    Solo se aplican cuando el idioma es español; en inglés (u otros) se deja
    //    que tomen el control los sampleValues del plan de IA o Faker.
    const useSpanishDictionaries = !isEnglishRegion(activeRegion);

    if (useSpanishDictionaries && (tableNameLower.includes('materia') || tableNameLower.includes('asignatura') || tableNameLower.includes('subject'))) {
      if (columnName.includes('nombre') || columnName === 'materia' || columnName === 'name') {
        const subjects = [
          'Matemáticas', 'Física', 'Química', 'Biología', 'Lenguaje y Literatura',
          'Historia', 'Geografía', 'Educación Cívica', 'Filosofía', 'Psicología',
          'Artes Plásticas', 'Música', 'Educación Física', 'Computación e Informática',
          'Inglés', 'Religión y Ética'
        ];
        return subjects[(rowIndex - 1) % subjects.length];
      }
      if (columnName.includes('descrip') || columnName.includes('detail')) {
        const descriptions = [
          'Estudio de conceptos fundamentales, teoría y resolución de problemas.',
          'Desarrollo de habilidades prácticas, analíticas y de pensamiento crítico.',
          'Exploración de la historia, evolución y aplicaciones contemporáneas.',
          'Comprensión del entorno, leyes naturales y método científico.',
          'Expresión, análisis de textos y técnicas de comunicación de ideas.'
        ];
        return descriptions[(rowIndex - 1) % descriptions.length];
      }
    }

    if (useSpanishDictionaries && (tableNameLower.includes('curso') || tableNameLower.includes('grade') || tableNameLower.includes('aula') || tableNameLower.includes('class'))) {
      if (tableNameLower.includes('curso') || tableNameLower.includes('grade')) {
        if (columnName.includes('nombre') || columnName === 'curso' || columnName === 'name') {
          const cursos = [
            '1ro de Primaria A', '1ro de Primaria B',
            '2do de Primaria A', '2do de Primaria B',
            '3ro de Primaria A', '3ro de Primaria B',
            '4to de Primaria A', '4to de Primaria B',
            '5to de Primaria A', '5to de Primaria B',
            '6to de Primaria A', '6to de Primaria B',
            '1ro de Secundaria A', '1ro de Secundaria B',
            '2do de Secundaria A', '2do de Secundaria B',
            '3ro de Secundaria A', '3ro de Secundaria B',
            '4to de Secundaria A', '4to de Secundaria B',
            '5to de Secundaria A', '5to de Secundaria B',
            '6to de Secundaria A', '6to de Secundaria B'
          ];
          return cursos[(rowIndex - 1) % cursos.length];
        }
        if (columnName.includes('nivel') || columnName.includes('level')) {
          return rowIndex <= 12 ? 'Primaria' : 'Secundaria';
        }
        if (columnName.includes('gestion') || columnName.includes('year') || columnName.includes('periodo')) {
          return 2026;
        }
      }
      if (tableNameLower.includes('aula') || tableNameLower.includes('classroom')) {
        if (columnName.includes('nombre') || columnName === 'aula' || columnName === 'name') {
          return `Aula ${100 + rowIndex}`;
        }
        if (columnName.includes('capacidad') || columnName.includes('capacity')) {
          return this.pick([25, 30, 35, 40]);
        }
      }
    }

    if (column.isPrimaryKey) {
      return this.generatePrimaryKeyValue(table, column, rowIndex);
    }

    const semanticHint = plan?.columns.find(
      (item) =>
        item.table === table.name &&
        item.column === column.name &&
        item.confidence >= 0.7,
    );

    if (semanticHint) {
      // Los campos de identidad/contacto SIEMPRE se generan desde el contexto
      // de persona/Faker, sin importar qué generatorHint haya propuesto la IA.
      // Esto evita que un "sampleValues" mal etiquetado (p. ej. nombres o
      // direcciones de ejemplo) desacople el nombre, el email, el teléfono o
      // la dirección de una misma fila.
      switch (semanticHint.semanticType) {
        case 'PERSON_NAME':
          if (isFirstName) return person.firstName;
          if (isLastName) return person.lastName;
          return person.fullName;

        case 'EMAIL':
          return this.buildEmail(person, rowIndex);

        case 'PHONE':
          return this.buildPhoneForRegion(activeRegion, activeFaker);

        case 'ADDRESS':
          return activeFaker.location.streetAddress();

        case 'CITY':
          return this.generateCityForRegion(activeRegion, activeFaker);
      }

      if (semanticHint.sampleValues.length > 0) {
        return this.resolveSampleValue(
          table,
          column,
          rowIndex,
          plan,
          semanticHint.sampleValues,
        );
      }

      const hasNumericRange =
        semanticHint.numericMin !== null && semanticHint.numericMax !== null;

      switch (semanticHint.generatorHint) {
        case 'NAME':
          if (isFirstName) return person.firstName;
          if (isLastName) return person.lastName;
          return person.fullName;

        case 'SAMPLE_VALUES':
          return `valor_${rowIndex}`;

        case 'EMAIL':
          return this.buildEmail(person, rowIndex);

        case 'PHONE':
          return this.buildPhoneForRegion(activeRegion, activeFaker);

        case 'CITY':
          return this.generateCityForRegion(activeRegion, activeFaker);

        case 'ADDRESS':
          return activeFaker.location.streetAddress();

        case 'MONEY':
          return hasNumericRange
            ? this.randomDecimal(
                semanticHint.numericMin!,
                semanticHint.numericMax!,
              )
            : this.randomDecimal(10, 5000);

        case 'INTEGER':
          return hasNumericRange
            ? this.randomInteger(
                Math.ceil(semanticHint.numericMin!),
                Math.floor(semanticHint.numericMax!),
              )
            : this.randomInteger(1, 100);

        case 'DECIMAL':
          return hasNumericRange
            ? this.randomDecimal(
                semanticHint.numericMin!,
                semanticHint.numericMax!,
              )
            : this.randomDecimal(1, 9999);

        case 'STATUS':
          return this.pickStatus(activeRegion);

        case 'DATE':
          return this.generateDateValue(column.name.toLowerCase());

        case 'DATETIME':
          return this.generateDateTimeValue();

        case 'BOOLEAN':
          return Math.random() >= 0.5;

        case 'TEXT':
          if (columnName.includes('descrip') || columnName.includes('detail') || columnName.includes('nota') || columnName.includes('observaci')) {
            if (table.name.toLowerCase().includes('product') || table.name.toLowerCase().includes('artic') || table.name.toLowerCase().includes('item')) {
              return activeFaker.commerce.productDescription();
            }
            return activeFaker.lorem.sentence();
          }
          return 'Dato sintético generado por SynData';

        case 'STRING':
          if (columnName.includes('categoria') || columnName.includes('category') || columnName.includes('departamento') || columnName.includes('dep')) {
            return activeFaker.commerce.department();
          }
          return `valor_${rowIndex}`;
      }
    }

    if (columnName.includes('email') || columnName.includes('correo')) {
      return this.buildEmail(person, rowIndex);
    }

    if (
      columnName.includes('telefono') ||
      columnName.includes('celular') ||
      columnName.includes('phone')
    ) {
      return this.buildPhoneForRegion(activeRegion, activeFaker);
    }

    if (columnName.includes('ciudad') || columnName.includes('city')) {
      return this.generateCityForRegion(activeRegion, activeFaker);
    }

    if (
      columnName.includes('direccion') ||
      columnName.includes('dirección') ||
      columnName.includes('address')
    ) {
      return activeFaker.location.streetAddress();
    }

    if (isFirstName) {
      return person.firstName;
    }

    if (isLastName) {
      return person.lastName;
    }

    if (columnName.includes('nombre') || columnName.includes('name')) {
      return person.fullName;
    }

    if (columnName.includes('estado') || columnName.includes('status')) {
      return this.pickStatus(activeRegion);
    }

    if (
      columnName.includes('monto') ||
      columnName.includes('total') ||
      columnName.includes('precio') ||
      columnName.includes('saldo')
    ) {
      return this.randomDecimal(10, 5000);
    }

    if (columnName.includes('cantidad')) {
      // Cantidad de línea de un detalle/pedido: rangos pequeños son más realistas
      // que hasta 100 unidades por línea.
      return this.randomInteger(1, 10);
    }

    if (columnName.includes('stock')) {
      return this.randomInteger(10, 200);
    }

    switch (column.normalizedType) {
      case 'SERIAL':
      case 'INTEGER':
        return this.randomInteger(1, 1000);

      case 'DECIMAL':
        return this.randomDecimal(1, 9999);

      case 'BOOLEAN':
        return Math.random() >= 0.5;

      case 'DATE':
        return this.generateDateValue(columnName);

      case 'DATETIME':
        return this.generateDateTimeValue();

      case 'TIME':
        return this.generateTimeValue();

      case 'UUID':
        return randomUUID();

      case 'TEXT':
        if (columnName.includes('descrip')) {
          if (table.name.toLowerCase().includes('product') || table.name.toLowerCase().includes('artic') || table.name.toLowerCase().includes('item')) {
            return activeFaker.commerce.productDescription();
          }
          return activeFaker.lorem.sentence();
        }
        return 'Dato sintético generado por SynData';

      case 'STRING':
      default:
        if (columnName.includes('categoria') || columnName.includes('category')) {
          return activeFaker.commerce.department();
        }
        return `valor_${rowIndex}`;
    }
  }

  /**
   * Resuelve el valor de una columna según el "type" elegido manualmente por
   * el usuario en el panel de reglas. Devuelve NO_RULE_OVERRIDE cuando el tipo
   * no aplica (ej. ENUM sin valores cargados) para que el resto del pipeline
   * de generación siga su curso normal.
   */
  private applyColumnRuleType(
    rule: ColumnOverrideRule,
    rowIndex: number,
    isFirstName: boolean,
    isLastName: boolean,
    person: PersonContext,
    faker: Faker,
    regionName: string,
  ): GeneratedValue | typeof NO_RULE_OVERRIDE {
    switch (rule.type?.toUpperCase()) {
      case 'PERSON_NAME':
        if (isFirstName) return person.firstName;
        if (isLastName) return person.lastName;
        return person.fullName;

      case 'EMAIL':
        return this.buildEmail(person, rowIndex);

      case 'PHONE':
        return this.buildPhoneForRegion(regionName, faker);

      case 'CITY':
        return this.generateCityForRegion(regionName, faker);

      case 'STATUS':
        return rule.values && rule.values.length > 0
          ? this.pick(rule.values)
          : this.pickStatus(regionName);

      case 'ENUM':
        return rule.values && rule.values.length > 0
          ? this.pick(rule.values)
          : NO_RULE_OVERRIDE;

      case 'INTEGER': {
        const min = this.parseRuleNumber(rule.min, 1);
        const max = this.parseRuleNumber(rule.max, 1000);
        return this.randomInteger(Math.min(min, max), Math.max(min, max));
      }

      case 'DECIMAL':
      case 'MONEY': {
        const min = this.parseRuleNumber(rule.min, 10);
        const max = this.parseRuleNumber(rule.max, 5000);
        return this.randomDecimal(Math.min(min, max), Math.max(min, max));
      }

      case 'DATE': {
        const start = this.parseRuleDate(rule.min) ?? new Date('2023-01-01');
        const end = this.parseRuleDate(rule.max) ?? new Date('2026-05-09');
        return this.randomDateBetween(start, end);
      }

      case 'DATETIME': {
        const start =
          this.parseRuleDate(rule.min) ?? new Date('2023-01-01T00:00:00');
        const end =
          this.parseRuleDate(rule.max) ?? new Date('2026-05-09T23:59:59');
        return this.randomDateObjectBetween(start, end)
          .toISOString()
          .slice(0, 19)
          .replace('T', ' ');
      }

      case 'BOOLEAN':
        return Math.random() >= 0.5;

      case 'UUID':
        return randomUUID();

      case 'TEXT':
      case 'STRING':
        return rule.values && rule.values.length > 0
          ? this.pick(rule.values)
          : NO_RULE_OVERRIDE;

      default:
        return NO_RULE_OVERRIDE;
    }
  }

  private parseRuleNumber(
    value: number | string | undefined,
    fallback: number,
  ): number {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private parseRuleDate(value: number | string | undefined): Date | null {
    if (value === undefined || value === '') return null;
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private generateForeignKeyValue(
    currentTableName: string,
    column: DetectedColumn,
    rowIndex: number,
    generatedRowsByTable: Map<string, GeneratedRow[]>,
    currentTableRows: GeneratedRow[],
    fkAssignments?: Map<string, GeneratedValue[]>,
  ): GeneratedValue {
    if (!column.references) {
      throw new BadRequestException(
        `La columna "${column.name}" no tiene referencia configurada`,
      );
    }

    const referencedTableName = column.references.table;
    const referencedColumnName = column.references.column;

    if (referencedTableName === currentTableName) {
      if (currentTableRows.length === 0) {
        if (column.isNullable) {
          return null;
        }

        throw new BadRequestException(
          `No se puede generar la FK obligatoria "${column.name}" porque es autorreferencial y la primera fila no tiene padre.`,
        );
      }

      const referencedRow = this.pick(currentTableRows);
      return referencedRow[referencedColumnName] ?? null;
    }

    // Asignación precomputada con cobertura garantizada (evita cabeceras sin
    // ningún hijo, ej. facturas sin detalle_factura por puro azar).
    const precomputed = fkAssignments?.get(column.name);
    if (precomputed && rowIndex - 1 < precomputed.length) {
      return precomputed[rowIndex - 1];
    }

    const referencedRows = generatedRowsByTable.get(referencedTableName);

    if (!referencedRows || referencedRows.length === 0) {
      throw new BadRequestException(
        `No existen filas generadas para la tabla referenciada "${referencedTableName}"`,
      );
    }

    const referencedRow = this.pick(referencedRows);
    return referencedRow[referencedColumnName] ?? null;
  }

  /**
   * Precalcula, por columna FK, una lista de valores de longitud `count` que:
   *  1) Garantiza que cada fila padre referenciada sea usada al menos una vez
   *     (si count >= número de padres), evitando cabeceras huérfanas.
   *  2) Reparte el resto de filas de forma aleatoria entre los padres.
   *  3) Mezcla el orden final para que la cobertura no quede agrupada al inicio.
   */
  private buildForeignKeyAssignments(
    table: DetectedTable,
    count: number,
    rowsByTableMap: Map<string, GeneratedRow[]>,
  ): Map<string, GeneratedValue[]> {
    const assignments = new Map<string, GeneratedValue[]>();

    for (const column of table.columns) {
      if (!column.references) continue;

      const referencedTableName = column.references.table;
      if (referencedTableName === table.name) continue; // autorreferencial: manejo dinámico

      const referencedRows = rowsByTableMap.get(referencedTableName);
      if (!referencedRows || referencedRows.length === 0) continue;

      const referencedColumnName = column.references.column;
      const parentValues = referencedRows.map(
        (row) => row[referencedColumnName] ?? null,
      );

      const shuffledParents = this.shuffle(parentValues);
      const values: GeneratedValue[] = [];

      for (let index = 0; index < count; index++) {
        values.push(
          index < shuffledParents.length
            ? shuffledParents[index]
            : this.pick(parentValues),
        );
      }

      assignments.set(column.name, this.shuffle(values));
    }

    return assignments;
  }

  private shuffle<T>(items: T[]): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) {
      const swapIndex = this.randomInteger(0, index);
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }

  private generatePrimaryKeyValue(
    table: DetectedTable,
    column: DetectedColumn,
    rowIndex: number,
  ): GeneratedValue {
    switch (column.normalizedType) {
      case 'UUID':
        return randomUUID();

      case 'STRING':
      case 'TEXT':
        return `${table.name.toUpperCase()}_${String(rowIndex).padStart(
          4,
          '0',
        )}`;

      default:
        return rowIndex;
    }
  }

  private sortTablesByDependencies(tables: DetectedTable[]): DetectedTable[] {
    const tableMap = new Map(tables.map((table) => [table.name, table]));
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const orderedTables: DetectedTable[] = [];

    const visit = (tableName: string) => {
      if (visited.has(tableName)) return;

      if (visiting.has(tableName)) {
        throw new BadRequestException(
          `Se detectó una dependencia cíclica entre tablas alrededor de "${tableName}"`,
        );
      }

      const table = tableMap.get(tableName);

      if (!table) {
        throw new BadRequestException(
          `La tabla "${tableName}" no existe dentro del esquema analizado`,
        );
      }

      visiting.add(tableName);

      for (const foreignKey of table.foreignKeys) {
        if (foreignKey.referencesTable === table.name) {
          continue;
        }

        if (!tableMap.has(foreignKey.referencesTable)) {
          throw new BadRequestException(
            `La tabla "${table.name}" referencia a "${foreignKey.referencesTable}", pero esa tabla no existe en el esquema.`,
          );
        }

        visit(foreignKey.referencesTable);
      }

      visiting.delete(tableName);
      visited.add(tableName);
      orderedTables.push(table);
    };

    for (const table of tables) {
      visit(table.name);
    }

    return orderedTables;
  }

  private buildSqlFile(
    orderedTables: DetectedTable[],
    rowsByTable: Map<string, GeneratedRow[]>,
  ): string {
    const header = [
      '-- Archivo generado por SynData',
      '-- Datos sintéticos para PostgreSQL',
      '',
    ].join('\n');

    const inserts = orderedTables
      .map((table) => {
        const rows = rowsByTable.get(table.name) ?? [];

        if (rows.length === 0) {
          return '';
        }

        const quotedColumns = table.columns
          .map((column) => this.quoteIdentifier(column.name))
          .join(', ');

        const values = rows
          .map((row) => {
            const rowValues = table.columns
              .map((column) => this.toSqlLiteral(row[column.name]))
              .join(', ');

            return `(${rowValues})`;
          })
          .join(',\n');

        return `INSERT INTO ${this.quoteIdentifier(
          table.name,
        )} (${quotedColumns}) VALUES\n${values};`;
      })
      .filter(Boolean)
      .join('\n\n');

    return `${header}${inserts}\n`;
  }

  private toSqlLiteral(value: GeneratedValue): string {
    if (value === null) return 'NULL';

    if (typeof value === 'number') return String(value);

    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';

    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private createPersonContext(faker: Faker): PersonContext {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();

    return {
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`,
    };
  }

  private buildEmail(person: PersonContext, rowIndex: number): string {
    const first = this.cleanText(person.firstName);
    const last = this.cleanText(person.lastName);

    return `${first}.${last}${rowIndex}@example.com`;
  }

  private buildPhoneForRegion(regionName: string, faker: Faker): string {
    switch (regionName) {
      case 'BOLIVIA': {
        const prefix = this.pick(['6', '7']);
        let rest = '';
        for (let index = 0; index < 7; index++) {
          rest += String(this.randomInteger(0, 9));
        }
        return `${prefix}${rest}`;
      }
      case 'COLOMBIA':
        return faker.helpers.replaceSymbols('3#########');
      case 'ARGENTINA':
        return faker.helpers.replaceSymbols('11########');
      case 'CHILE':
        return faker.helpers.replaceSymbols('9########');
      case 'MEXICO':
        return faker.helpers.replaceSymbols('55########');
      case 'ESPAÑA': {
        const prefix = this.pick(['6', '7']);
        return faker.helpers.replaceSymbols(`${prefix}########`);
      }
      default:
        return faker.phone.number();
    }
  }

  private generateCityForRegion(regionName: string, faker: Faker): string {
    if (regionName === 'BOLIVIA') {
      return this.pick(bolivianCities);
    }
    return faker.location.city();
  }

  private generateDateValue(columnName: string): string {
    if (columnName.includes('nacimiento')) {
      return this.randomDateBetween(
        new Date('1970-01-01'),
        new Date('2008-12-31'),
      );
    }

    return this.randomDateBetween(
      new Date('2023-01-01'),
      new Date('2026-05-09'),
    );
  }

  private generateDateTimeValue(): string {
    const date = this.randomDateObjectBetween(
      new Date('2023-01-01T00:00:00'),
      new Date('2026-05-09T23:59:59'),
    );

    return date.toISOString().slice(0, 19).replace('T', ' ');
  }

  private generateTimeValue(): string {
    const hour = String(this.randomInteger(0, 23)).padStart(2, '0');
    const minute = String(this.randomInteger(0, 59)).padStart(2, '0');
    const second = String(this.randomInteger(0, 59)).padStart(2, '0');

    return `${hour}:${minute}:${second}`;
  }

  private randomDateBetween(start: Date, end: Date): string {
    const date = this.randomDateObjectBetween(start, end);
    return date.toISOString().slice(0, 10);
  }

  private randomDateObjectBetween(start: Date, end: Date): Date {
    const startTime = start.getTime();
    const endTime = end.getTime();

    const randomTime =
      startTime + Math.random() * Math.max(endTime - startTime, 1);

    return new Date(randomTime);
  }

  private randomInteger(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private randomDecimal(min: number, max: number): number {
    return Number((Math.random() * (max - min) + min).toFixed(2));
  }

  private pick<T>(items: T[]): T {
    return items[this.randomInteger(0, items.length - 1)];
  }

  private cleanText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, '');
  }

  /**
   * Resuelve un valor proveniente de `sampleValues` aplicando coherencia de
   * catálogo (mismo "slot" de entidad para columnas relacionadas de la misma
   * tabla) y conversión numérica cuando la columna destino no es texto.
   */
  private resolveSampleValue(
    table: DetectedTable,
    column: DetectedColumn,
    rowIndex: number,
    plan: GenerationPlanJson | null | undefined,
    sampleValues: string[],
  ): GeneratedValue {
    const raw = this.pickCorrelatedSampleValue(
      table,
      column,
      rowIndex,
      plan,
      sampleValues,
    );
    return this.coerceSampleValue(column, raw);
  }

  /**
   * Si la tabla tiene varias columnas de dominio con sampleValues (p. ej.
   * productos.nombre + productos.descripcion + productos.precio_unitario),
   * usa el mismo "slot" derivado de rowIndex en todas ellas para que la fila
   * represente UNA entidad coherente, en vez de combinar nombre/descripción/
   * precio de forma independiente y sin relación entre sí.
   */
  private pickCorrelatedSampleValue(
    table: DetectedTable,
    column: DetectedColumn,
    rowIndex: number,
    plan: GenerationPlanJson | null | undefined,
    sampleValues: string[],
  ): string {
    if (!plan || column.isUnique || column.isPrimaryKey) {
      return this.pick(sampleValues);
    }

    const domainColumns = plan.columns.filter((item) => {
      if (item.table !== table.name || item.sampleValues.length < 2) {
        return false;
      }
      const matchingColumn = table.columns.find((c) => c.name === item.column);
      return !matchingColumn?.isUnique && !matchingColumn?.isPrimaryKey;
    });

    if (domainColumns.length < 2) {
      return this.pick(sampleValues);
    }

    const entitySlotSize = Math.max(
      ...domainColumns.map((item) => item.sampleValues.length),
    );
    const entitySlot = (rowIndex - 1) % entitySlotSize;

    return sampleValues[entitySlot % sampleValues.length];
  }

  /** sampleValues siempre llega como string[]; lo convertimos si la columna es numérica. */
  private coerceSampleValue(
    column: DetectedColumn,
    raw: string,
  ): GeneratedValue {
    if (column.normalizedType === 'DECIMAL') {
      const parsed = Number(raw.replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : raw;
    }

    if (column.normalizedType === 'INTEGER' || column.normalizedType === 'SERIAL') {
      const parsed = parseInt(raw, 10);
      return Number.isFinite(parsed) ? parsed : raw;
    }

    return raw;
  }

  // getImplicitReferencesTable removido porque fue trasladado a schema-enricher.ts

  private applyBusinessHeuristics(
    schema: DetectedSchema,
    rowsByTableMap: Map<string, GeneratedRow[]>,
  ): void {
    // 1. Identificar tablas de tipo "detalle" e inyectar precios de maestros
    for (const table of schema.tables) {
      const rows = rowsByTableMap.get(table.name) || [];
      if (rows.length === 0) continue;

      const cantCol = table.columns.find(c => {
        const n = c.name.toLowerCase();
        return n.includes('cant') || n.includes('qty') || n.includes('units') || n.includes('cantidad');
      });
      const priceCol = table.columns.find(c => {
        const n = c.name.toLowerCase();
        return n.includes('prec') || n.includes('cost') || n.includes('unit') || n.includes('valor');
      });
      const subtotalCol = table.columns.find(c => {
        const n = c.name.toLowerCase();
        return n.includes('subtotal') || n.includes('total_lin') || n.includes('importe') || n.includes('total_det');
      });

      if (priceCol) {
        const productFk = table.foreignKeys.find(fk => {
          const t = fk.referencesTable.toLowerCase();
          return t.includes('product') || t.includes('artic') || t.includes('serv') || t.includes('item');
        });

        if (productFk) {
          const parentRows = rowsByTableMap.get(productFk.referencesTable) || [];
          if (parentRows.length > 0) {
            const parentTableObj = schema.tables.find(t => t.name === productFk.referencesTable);
            const parentPriceCol = parentTableObj?.columns.find(c => {
              const n = c.name.toLowerCase();
              return n.includes('prec') || n.includes('cost') || n.includes('valor');
            });

            if (parentPriceCol) {
              for (const row of rows) {
                const parentId = row[productFk.column];
                const parentRow = parentRows.find(pr => pr[productFk.referencesColumn] === parentId);
                if (parentRow) {
                  row[priceCol.name] = Number(parentRow[parentPriceCol.name]) || 10.0;
                }
              }
            }
          }
        }
      }

      // 2. Calcular subtotal = cantidad * precio
      if (cantCol && priceCol && subtotalCol) {
        for (const row of rows) {
          const cant = Number(row[cantCol.name]) || 1;
          const price = Number(row[priceCol.name]) || 0;
          row[subtotalCol.name] = Number((cant * price).toFixed(2));
        }
      }
    }

    // 3. Sumar subtotales para inyectar en el total de la cabecera
    for (const table of schema.tables) {
      const rows = rowsByTableMap.get(table.name) || [];
      if (rows.length === 0) continue;

      const totalCol = table.columns.find(c => {
        const n = c.name.toLowerCase();
        return (n === 'total' || n === 'monto_total' || n === 'importe_total' || n === 'total_pagar') && !n.includes('sub');
      });

      if (totalCol) {
        for (const childTable of schema.tables) {
          if (childTable.name === table.name) continue;

          const childFk = childTable.foreignKeys.find(fk => fk.referencesTable === table.name);
          if (childFk) {
            const childSubtotalCol = childTable.columns.find(c => {
              const n = c.name.toLowerCase();
              return n.includes('subtotal') || n.includes('total_lin') || n.includes('importe') || n.includes('total_det');
            });

            if (childSubtotalCol) {
              const childRows = rowsByTableMap.get(childTable.name) || [];
              for (const parentRow of rows) {
                const parentId = parentRow[childFk.referencesColumn];
                const matchingChildren = childRows.filter(cr => cr[childFk.column] === parentId);
                const sum = matchingChildren.reduce((acc, child) => {
                  const val = Number(child[childSubtotalCol.name]);
                  return Number.isFinite(val) ? acc + val : acc;
                }, 0);

                parentRow[totalCol.name] = Number(sum.toFixed(2));
              }
            }
          }
        }
      }
    }
  }
}
