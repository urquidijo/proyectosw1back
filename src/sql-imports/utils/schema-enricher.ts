import { DetectedSchema } from '../types/detected-schema.type';

export function getImplicitReferencesTable(
  columnName: string,
  schemaTables: string[],
): string | null {
  const name = columnName.toLowerCase();

  if (!name.includes('id') && !name.includes('cod')) {
    return null;
  }

  const cleanName = name
    .replace(/_id$/, '')
    .replace(/^id_/, '')
    .replace(/^id/, '')
    .replace(/_cod$/, '')
    .replace(/^cod_/, '')
    .replace(/^cod/, '')
    .trim();

  if (!cleanName) return null;

  const candidates = [
    cleanName,
    cleanName + 's',
    cleanName + 'es',
    cleanName.replace(/s$/, ''),
    cleanName.replace(/es$/, ''),
  ];

  for (const cand of candidates) {
    const matched = schemaTables.find(t => t.toLowerCase() === cand.toLowerCase());
    if (matched) {
      return matched;
    }
  }

  return null;
}

export function enrichSchemaWithImplicitFks(schema: DetectedSchema): DetectedSchema {
  const cloned: DetectedSchema = JSON.parse(JSON.stringify(schema));
  const tableNames = cloned.tables.map(t => t.name);

  for (const table of cloned.tables) {
    for (const column of table.columns) {
      if (!column.isPrimaryKey && (!column.references || !column.references.table)) {
        const implicitTable = getImplicitReferencesTable(column.name, tableNames);
        if (implicitTable && implicitTable !== table.name) {
          const targetTable = cloned.tables.find(t => t.name === implicitTable);
          if (targetTable) {
            const targetColName = targetTable.primaryKeys[0] ||
              targetTable.columns.find(c => c.isPrimaryKey)?.name ||
              targetTable.columns[0]?.name;

            if (targetColName) {
              column.references = {
                table: implicitTable,
                column: targetColName,
              };

              const exists = table.foreignKeys.some(
                fk =>
                  fk.column === column.name &&
                  fk.referencesTable === implicitTable &&
                  fk.referencesColumn === targetColName,
              );

              if (!exists) {
                table.foreignKeys.push({
                  column: column.name,
                  referencesTable: implicitTable,
                  referencesColumn: targetColName,
                });
              }
            }
          }
        }
      }
    }
  }

  return cloned;
}
