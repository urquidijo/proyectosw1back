import { BadRequestException, Injectable } from '@nestjs/common';
import archiver from 'archiver';
import { GenerationsService } from '../generations/generations.service';
import { ExportFormat } from './dto/export-query.dto';
import { rowsToCsv } from './formatters/csv.formatter';
import { buildXlsxWorkbook } from './formatters/xlsx.formatter';

type Row = Record<string, unknown>;

export type ExportResult = {
  filename: string;
  contentType: string;
  body: string | Buffer;
};

@Injectable()
export class ExportsService {
  constructor(private readonly generationsService: GenerationsService) {}

  async export(
    projectId: string,
    generationId: string,
    userId: string,
    format: ExportFormat,
    table?: string,
  ): Promise<ExportResult> {
    if (format === 'sql') {
      if (table) {
        throw new BadRequestException(
          'El formato SQL exporta siempre el dataset completo; no admite filtrar por tabla',
        );
      }

      const outputSql = await this.generationsService.getOutputSql(
        projectId,
        generationId,
        userId,
      );

      return {
        filename: `syndata-${generationId}.sql`,
        contentType: 'text/plain; charset=utf-8',
        body: outputSql,
      };
    }

    const { orderedTables, rowsByTable } =
      await this.generationsService.getFullData(projectId, generationId, userId);

    if (table && !orderedTables.includes(table)) {
      throw new BadRequestException(
        `La tabla "${table}" no existe en esta generación`,
      );
    }

    const tables = table ? [table] : orderedTables;

    switch (format) {
      case 'json':
        return this.buildJson(generationId, tables, rowsByTable, table);

      case 'csv':
        return this.buildCsv(generationId, tables, rowsByTable, table);

      case 'xlsx':
        return this.buildXlsx(generationId, tables, rowsByTable, table);
    }
  }

  private buildJson(
    generationId: string,
    tables: string[],
    rowsByTable: Record<string, Row[]>,
    singleTable?: string,
  ): ExportResult {
    const payload = singleTable
      ? rowsByTable[singleTable] ?? []
      : Object.fromEntries(tables.map((t) => [t, rowsByTable[t] ?? []]));

    return {
      filename: singleTable
        ? `syndata-${generationId}-${singleTable}.json`
        : `syndata-${generationId}.json`,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(payload, null, 2),
    };
  }

  private async buildCsv(
    generationId: string,
    tables: string[],
    rowsByTable: Record<string, Row[]>,
    singleTable?: string,
  ): Promise<ExportResult> {
    if (singleTable) {
      return {
        filename: `syndata-${generationId}-${singleTable}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: rowsToCsv(rowsByTable[singleTable] ?? []),
      };
    }

    // Varias tablas: CSV es inherentemente de una sola tabla, así que se
    // empaqueta un .csv por tabla dentro de un único .zip descargable.
    const zipBuffer = await this.zipCsvPerTable(tables, rowsByTable);

    return {
      filename: `syndata-${generationId}-csv.zip`,
      contentType: 'application/zip',
      body: zipBuffer,
    };
  }

  private async buildXlsx(
    generationId: string,
    tables: string[],
    rowsByTable: Record<string, Row[]>,
    singleTable?: string,
  ): Promise<ExportResult> {
    const buffer = await buildXlsxWorkbook(rowsByTable, tables);

    return {
      filename: singleTable
        ? `syndata-${generationId}-${singleTable}.xlsx`
        : `syndata-${generationId}.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: buffer,
    };
  }

  private async zipCsvPerTable(
    tables: string[],
    rowsByTable: Record<string, Row[]>,
  ): Promise<Buffer> {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));

    const finished = new Promise<void>((resolve, reject) => {
      archive.on('end', () => resolve());
      archive.on('error', (error) => reject(error));
    });

    for (const tableName of tables) {
      archive.append(rowsToCsv(rowsByTable[tableName] ?? []), {
        name: `${tableName}.csv`,
      });
    }

    await archive.finalize();
    await finished;

    return Buffer.concat(chunks);
  }
}
